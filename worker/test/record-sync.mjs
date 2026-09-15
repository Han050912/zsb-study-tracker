/**
 * 记录级增量同步（POST /api/data/push + POST /api/data/pull）集成测试。
 *
 * 覆盖设计 §8.2 用例 1–8、12、13（单表数组域部分）：
 * 首推插入 / 同时间戳重放幂等 / 旧值被拒 / 新值覆盖 / 删除墓碑与 deletedAt 判负 / 复活 /
 * 增量游标 / 用户隔离 / 多域单请求原子性 / gamification 拒绝客户端写入。
 * 另有修复轮用例 14–19：其余单表域（problemSessions/errorQuestions/exams/notes/materials）往返与增量、
 * 同域并发 push 的序号原子分配、pull 空 body、输入上限（单字段 1MB / 单域 10000 条）、
 * 同请求内重复 key 去重与 upsert+delete 冲突、updatedAt 时钟钳制。
 *
 * 用例 20–27：复杂域（设计 §3.3 键空间）——subjects 子树往返与 id 稳定、habits 打卡 map、
 * pomodoro 三键空间（含 itr 整体替换与 rec 墓碑）、english 四键前缀落表、summaries 键 = date、
 * settings 单记录 LWW 与 maimemoToken「undefined 不覆盖」、full/增量响应形状一致、复杂域非法键 → 400。
 *
 * 修复轮 T3b 新增：
 * - 用例 28：english 四表 NOT NULL 必填字段缺失 → 400（而非 SQLite 约束冒到 500）。
 * - 用例 29：跨记录隔离护栏——推送 hb1 不改动 hb2 的打卡行；删除科目 A 不改动科目 B 的 chapters/topics。
 * - 用例 30：游标契约——changes[domain].seq = 本次实际返回的最大 server_seq，客户端取它而非 versions；
 *   并模拟「版本号已可见、业务行未提交」的空洞窗口，断言取实际 seq 的游标仍能拉到随后提交的行。
 *
 * T4 新增（积分事件化 + 权威派生量 + 删除驱动的孤儿清理，设计 §5/§6.4，用例 31–37）：
 * - 用例 31：今日学习满 60 分钟 → +3（`srv:study-minutes:<today>`），再推一条/重放均不重复发放。
 * - 用例 32：连续 7 天 → `streak === 7`、`srv:streak:7`、`streak_7` 徽章，且徽章与积分同批提交（无中间态）。
 * - 用例 33：客户端 revoke 事件（refId 精确 / refPrefix 前缀）→ 流水删除且 points 按 SUM 重算；
 *   同批内「撤销 + 发放同一 refId」以本次发放为准。
 * - 用例 34：记录删除被接受 → 自动撤销关联流水（records → `<key>`，errorQuestions → `error:<key>`）。
 * - 用例 35：删除 notes → `pdf_chunks` 分片清空；删除 errorQuestions → `error_images` 行 + R2 对象清空
 *   （读取 404），重复删除幂等；同一内容寻址对象仍被其它错题引用时不误删。
 * - 用例 36：points 事件字段非法（未知 op / 非正点数 / 缺 refId 与 refPrefix / revoke 同时给两者）→ 400。
 * - 用例 37：不变式 `gamification.points === SUM(points_log.points)`。
 * 用户 B 用于积分用例：其学习日期集合完全可控（A 的记录日期为固定造数日期）。
 *
 * T4b 新增（成就列表由服务端并集维护，设计 §5.1/§5.2，用例 38）：
 * - 用例 38：`achievements` 推送字段与 `gamification.achievements` 做**只增不减**的集合并集——
 *   推两个 id → 快照含两者；重复推送同一批（含重复项）→ 集合不变、不重复；再推新 id → 追加且旧的不丢；
 *   与记录变更同批提交；非法（非数组 / 元素非字符串 / 空字符串 / 去重后超 200）→ 400 且不改动已有列表。
 *
 * 前置：npx wrangler d1 execute zsb-study-db --local --file=./schema.sql && npx wrangler dev --port 8787
 * 运行：SMOKE_DESKTOP_TOKEN=<DESKTOP_TOKEN> node test/record-sync.mjs [baseURL]（默认 http://localhost:8787）
 * 注意：/api/auth/register 限流 3 次/分钟，本测试只注册 2 个用户。
 */
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// 请求重试统一走 ./fetch-retry.mjs
import { fetchRetry } from './fetch-retry.mjs'

const BASE = process.argv[2] || 'http://localhost:8787'
const ORIGIN = 'http://localhost:5173'
const WORKER_DIR = fileURLToPath(new URL('..', import.meta.url))
const DESKTOP_TOKEN = process.env.SMOKE_DESKTOP_TOKEN || 'zsb-desktop-v2'

function d1(sql) {
  return execSync(`npx wrangler d1 execute zsb-study-db --local --json --command "${sql}"`, {
    cwd: WORKER_DIR
  }).toString()
}

/** 取 D1 查询结果行数组 */
function d1Rows(sql) {
  const out = d1(sql)
  return JSON.parse(out.slice(out.indexOf('[')))?.[0]?.results ?? []
}

/** 取首行（无行返回 null） */
function rowOf(sql) {
  return d1Rows(sql)[0] ?? null
}

let passed = 0
let failed = 0
function check(name, cond, extra = '') {
  if (cond) {
    passed++
    console.log(`  ✓ ${name}`)
  } else {
    failed++
    console.error(`  ✗ ${name}${extra ? ' — ' + extra : ''}`)
  }
}

async function api(path, { method = 'GET', token, body } = {}) {
  const headers = { 'Content-Type': 'application/json', Origin: ORIGIN, 'X-Desktop-Token': DESKTOP_TOKEN }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetchRetry(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  let data = null
  try {
    data = await res.json()
  } catch {
    /* 无 JSON 响应体 */
  }
  return { status: res.status, data }
}

/** 推送若干域的变更（extra 用于 points 事件等附加字段） */
function push(token, domains, extra = {}) {
  return api('/api/data/push', { method: 'POST', token, body: { domains, ...extra } })
}

/** 拉取（full 或增量游标） */
function pull(token, body) {
  return api('/api/data/pull', { method: 'POST', token, body })
}

/** 裸二进制请求（PDF 上传等；与前端 authFetch 一致，不经 JSON 序列化） */
async function rawRequest(path, { method = 'GET', token, bytes, contentType } = {}) {
  const headers = { Origin: ORIGIN, 'X-Desktop-Token': DESKTOP_TOKEN }
  if (contentType) headers['Content-Type'] = contentType
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetchRetry(`${BASE}${path}`, { method, headers, body: bytes })
  let data = null
  try {
    data = await res.json()
  } catch {
    /* 二进制或空响应体 */
  }
  return { status: res.status, data }
}

/** 某用户 points_log 中该 ref_id 的流水行数 */
const logCount = (userId, refId) =>
  rowOf(`SELECT COUNT(*) AS n FROM points_log WHERE user_id = '${userId}' AND ref_id = '${refId}'`)?.n ?? -1

/** 权威投影不变式：gamification.points 必须等于 SUM(points_log.points) */
function pointsConsistent(userId) {
  const g = rowOf(`SELECT points FROM gamification WHERE user_id = '${userId}'`)?.points ?? 0
  const s = rowOf(`SELECT COALESCE(SUM(points), 0) AS s FROM points_log WHERE user_id = '${userId}'`)?.s ?? 0
  return { g, s, ok: g === s }
}

/** 某用户 error_images 归属行数 */
const imgRowCount = (userId) => rowOf(`SELECT COUNT(*) AS n FROM error_images WHERE user_id = '${userId}'`)?.n ?? -1

/** 记录级 upsert 项（records 域所需字段齐全） */
function record(id, minutes, updatedAt) {
  return { id, subjectId: 'math', date: '2026-09-12', minutes, createdAt: 1, updatedAt }
}

/** 记录级 upsert 项（todos 域所需字段齐全） */
function todo(id, updatedAt, text = '待办') {
  return { id, date: '2026-09-12', text, done: false, order: 0, updatedAt }
}

/** 记录级 upsert 项（problemSessions 域所需字段齐全） */
function problemSession(id, updatedAt) {
  return { id, subjectId: 'math', date: '2026-09-12', total: 10, correct: 8, types: { 单选: 10 }, updatedAt }
}

/** 记录级 upsert 项（errorQuestions 域所需字段齐全） */
function errorQuestion(id, updatedAt) {
  return {
    id,
    subjectId: 'math',
    date: '2026-09-12',
    type: '单选',
    content: '题干',
    answer: 'B',
    reviewCount: 2,
    mastered: false,
    updatedAt
  }
}

/** 记录级 upsert 项（exams 域所需字段齐全） */
function exam(id, updatedAt) {
  return {
    id,
    subjectId: 'math',
    date: '2026-09-12',
    title: '一模',
    score: 120,
    totalScore: 150,
    minutes: 90,
    parts: [{ name: '选择', score: 40 }],
    updatedAt
  }
}

/** 记录级 upsert 项（notes 域仅含元数据；正文走 /api/note-bodies） */
function note(id, updatedAt, title = '笔记') {
  return { id, subjectId: 'math', title, tags: ['tag1'], updatedAt, bodyUpdatedAt: updatedAt }
}

/** 记录级 upsert 项（materials 域所需字段齐全） */
function material(id, updatedAt, title = '资料') {
  return { id, title, type: 'book', priority: '高', totalPages: 100, readPages: 3, updatedAt }
}

/** 复杂域 upsert 项：外层 `{ key, value, updatedAt }` 包装（多集合域由键前缀定位落库位置） */
const wrap = (key, value, updatedAt) => ({ key, value, updatedAt })

/** 从 pull 结果中按 key 找复杂域的包装项 */
function wrappedOf(res, domain, key) {
  return (res.data?.changes?.[domain]?.upserts ?? []).find((u) => u.key === key)
}

/** 从 pull 结果中按记录 id 找单表数组域记录 */
function recordOf(res, domain, id) {
  return (res.data?.changes?.[domain]?.upserts ?? []).find((r) => r.id === id)
}

/** 记录级同步域全清单（不含 gamification：它只回传权威快照，不进 changes） */
const SYNCED_DOMAINS = [
  'subjects',
  'records',
  'problemSessions',
  'errorQuestions',
  'exams',
  'notes',
  'materials',
  'todos',
  'habits',
  'summaries',
  'pomodoro',
  'settings',
  'english'
]

const uniq = Date.now().toString(36)
const userA = { username: `recsync_a_${uniq}`, password: 'password123' }
const userB = { username: `recsync_b_${uniq}`, password: 'password123' }

async function main() {
  console.log(`目标: ${BASE}\n`)

  const regA = await api('/api/auth/register', { method: 'POST', body: userA })
  check('注册用户 A', regA.status === 201 && !!regA.data?.token, JSON.stringify(regA.data))
  const regB = await api('/api/auth/register', { method: 'POST', body: userB })
  check('注册用户 B', regB.status === 201 && !!regB.data?.token, JSON.stringify(regB.data))
  const tokenA = regA.data?.token
  const tokenB = regB.data?.token
  const uidA = regA.data?.user?.id
  const uidB = regB.data?.user?.id

  const recRow = (id) =>
    rowOf(`SELECT minutes, updated_at, server_seq FROM study_records WHERE user_id = '${uidA}' AND id = '${id}'`)
  const recCount = (id) =>
    rowOf(`SELECT COUNT(*) AS n FROM study_records WHERE user_id = '${uidA}' AND id = '${id}'`)?.n ?? -1
  const tombOf = (id) =>
    rowOf(
      `SELECT deleted_at, seq FROM sync_deletions WHERE user_id = '${uidA}' AND domain = 'records' AND record_key = '${id}'`
    )

  console.log('[校验：认证与形状（全部先于数据库访问）]')
  check('未认证 push 返回 401', (await push(null, { records: { upserts: [], deletes: [] } })).status === 401)
  check('未认证 pull 返回 401', (await pull(null, { full: true })).status === 401)
  check('未知域返回 400', (await push(tokenA, { hacker: { upserts: [], deletes: [] } })).status === 400, '未知域应拒绝')
  check(
    'domains 与 points 同时为空返回 400',
    (await api('/api/data/push', { method: 'POST', token: tokenA, body: {} })).status === 400
  )
  check('域值不是对象返回 400', (await push(tokenA, { records: [] })).status === 400, '数组载荷应拒绝')
  check('upserts 不是数组返回 400', (await push(tokenA, { records: { upserts: 'x', deletes: [] } })).status === 400)
  check(
    'delete 项缺 deletedAt 返回 400',
    (await push(tokenA, { records: { upserts: [], deletes: [{ key: 'r1' }] } })).status === 400
  )
  check(
    'upsert 项 updatedAt 非正整数返回 400',
    (await push(tokenA, { records: { upserts: [{ id: 'r1', updatedAt: -1 }], deletes: [] } })).status === 400
  )
  const badPrefix = await push(tokenA, {
    pomodoro: { upserts: [{ key: 'week:2026-09-10', value: {}, updatedAt: Date.now() }], deletes: [] }
  })
  check(
    '复杂域未知键前缀返回 400 中文提示（校验先于数据库访问）',
    badPrefix.status === 400 && /day:\/itr:\/rec:/.test(badPrefix.data?.message ?? ''),
    JSON.stringify(badPrefix.data)
  )
  check('points 非数组返回 400', (await push(tokenA, {}, { points: 'x' })).status === 400)
  check('points 含非法条目返回 400', (await push(tokenA, {}, { points: ['x'] })).status === 400)
  check('cursors 未知域返回 400', (await pull(tokenA, { cursors: { hacker: 1 } })).status === 400)
  check('cursors 负值返回 400', (await pull(tokenA, { cursors: { records: -1 } })).status === 400)
  check('cursors 小数返回 400', (await pull(tokenA, { cursors: { records: 1.5 } })).status === 400)

  // 用例 13：gamification 域由客户端推送 → 400（服务端权威）
  const gamPush = await push(tokenA, { gamification: { upserts: [], deletes: [] } })
  check(
    '用例13 gamification 被客户端推送返回 400 且提示积分由服务端维护',
    gamPush.status === 400 && /积分由服务端维护/.test(gamPush.data?.message ?? ''),
    JSON.stringify(gamPush.data)
  )

  // points 事件落账（T4 / 设计 §5.1）：按 refId 幂等插入流水，并回传「本次实际发放」条目与权威快照
  const pPoints = await push(
    tokenA,
    {},
    { points: [{ op: 'award', refId: 't1', points: 6, reason: '测试发放', date: '2026-09-12' }] }
  )
  check(
    'points 事件且无 domains → 200（applied/versions 为空）',
    pPoints.status === 200 &&
      pPoints.data?.ok === true &&
      Object.keys(pPoints.data?.applied ?? {}).length === 0 &&
      Object.keys(pPoints.data?.versions ?? {}).length === 0,
    JSON.stringify(pPoints.data)
  )
  check('award 事件落账（points_log 出现该 ref_id）', logCount(uidA, 't1') === 1, `实际 ${logCount(uidA, 't1')}`)
  check(
    '响应 awarded 含本次实际发放条目',
    JSON.stringify(pPoints.data?.awarded) === JSON.stringify([{ points: 6, reason: '测试发放' }]),
    JSON.stringify(pPoints.data?.awarded)
  )
  check('points = SUM(points_log.points)', pointsConsistent(uidA).ok, JSON.stringify(pointsConsistent(uidA)))
  const pPoints2 = await push(
    tokenA,
    {},
    { points: [{ op: 'award', refId: 't1', points: 6, reason: '测试发放', date: '2026-09-12' }] }
  )
  check(
    '重复 award 同 refId → 幂等跳过（awarded 为空、流水仍 1 行）',
    (pPoints2.data?.awarded ?? []).length === 0 && logCount(uidA, 't1') === 1,
    JSON.stringify(pPoints2.data?.awarded)
  )

  // 时间基准：所有 LWW 断言使用显式毫秒，与客户端时钟无关
  const T = Date.now()
  const at = (n) => T + n

  console.log('[用例 1：首推插入 → 序号自增、applied 正确]')
  const p1 = await push(tokenA, { records: { upserts: [record('r1', 30, at(2))], deletes: [] } })
  check('首推返回 200 + ok', p1.status === 200 && p1.data?.ok === true, JSON.stringify(p1.data))
  check('versions.records 自增为 1', p1.data?.versions?.records === 1, JSON.stringify(p1.data?.versions))
  check('applied.records === 1', p1.data?.applied?.records === 1, JSON.stringify(p1.data?.applied))
  check('rejected 为空', Array.isArray(p1.data?.rejected) && p1.data.rejected.length === 0)
  check('响应带 gamification 快照', typeof p1.data?.gamification?.points === 'number')
  const r1 = recRow('r1')
  check(
    '落库 updated_at = 传入值、server_seq = 1',
    r1?.updated_at === at(2) && r1?.server_seq === 1,
    JSON.stringify(r1)
  )

  const p1b = await push(tokenA, { records: { upserts: [record('r2', 12, at(4))], deletes: [] } })
  check('同域第二次推送序号自增为 2', p1b.data?.versions?.records === 2, JSON.stringify(p1b.data?.versions))

  console.log('[用例 2：同 updatedAt 重放 → 判负且数据不变（幂等）]')
  const p2 = await push(tokenA, { records: { upserts: [record('r1', 999, at(2))], deletes: [] } })
  check(
    '重放被判负（reason=older）',
    p2.status === 200 &&
      (p2.data?.rejected ?? []).some((x) => x.domain === 'records' && x.key === 'r1' && x.reason === 'older'),
    JSON.stringify(p2.data?.rejected)
  )
  const applied2 = p2.data?.applied ?? {}
  check(
    '无生效条数（applied 无 records 键或该值为 0）',
    !('records' in applied2) || applied2.records === 0,
    JSON.stringify(applied2)
  )
  check('序号未推进（versions 不含 records）', !('records' in (p2.data?.versions ?? {})))
  check('服务端数据未被重放覆盖', recRow('r1')?.minutes === 30, JSON.stringify(recRow('r1')))

  console.log('[用例 3：旧 updatedAt 覆盖新值 → 被拒，服务端保留新值]')
  const p3 = await push(tokenA, { records: { upserts: [record('r1', 55, at(1))], deletes: [] } })
  check(
    '旧 updatedAt 被判负（older）',
    (p3.data?.rejected ?? []).some((x) => x.key === 'r1' && x.reason === 'older'),
    JSON.stringify(p3.data?.rejected)
  )
  check(
    '服务端保留新值（minutes=30 / updated_at 未回退）',
    recRow('r1')?.minutes === 30 && recRow('r1')?.updated_at === at(2),
    JSON.stringify(recRow('r1'))
  )

  console.log('[用例 4：新 updatedAt 覆盖旧值 → 生效]')
  const p4 = await push(tokenA, { records: { upserts: [record('r1', 45, at(5))], deletes: [] } })
  check('applied.records === 1', p4.data?.applied?.records === 1, JSON.stringify(p4.data?.applied))
  check('序号推进为 3', p4.data?.versions?.records === 3, JSON.stringify(p4.data?.versions))
  const r1b = recRow('r1')
  check(
    '覆盖生效（minutes=45 / updated_at=新值 / server_seq=3）',
    r1b?.minutes === 45 && r1b?.updated_at === at(5) && r1b?.server_seq === 3,
    JSON.stringify(r1b)
  )

  console.log('[用例 5：删除产生墓碑 → full pull 不再返回；deletedAt 晚于编辑的 upsert 被拒]')
  const tDel = at(6)
  const p5 = await push(tokenA, { records: { upserts: [], deletes: [{ key: 'r2', deletedAt: tDel }] } })
  check('删除生效 deletes.records === 1', p5.data?.deletes?.records === 1, JSON.stringify(p5.data?.deletes))
  check('序号推进为 4', p5.data?.versions?.records === 4, JSON.stringify(p5.data?.versions))
  check(
    '墓碑写入 deleted_at/seq',
    tombOf('r2')?.deleted_at === tDel && tombOf('r2')?.seq === 4,
    JSON.stringify(tombOf('r2'))
  )
  check('业务行已删除', recCount('r2') === 0, `实际 ${recCount('r2')}`)
  const f5 = await pull(tokenA, { full: true })
  check(
    'full pull 不再返回已删记录',
    (f5.data?.changes?.records?.upserts ?? []).every((r) => r.id !== 'r2'),
    JSON.stringify(f5.data?.changes?.records?.upserts)
  )
  check(
    'full pull 返回墓碑',
    (f5.data?.changes?.records?.deletes ?? []).some((d) => d.key === 'r2' && d.deletedAt === tDel),
    JSON.stringify(f5.data?.changes?.records?.deletes)
  )
  check(
    'full pull 记录带 updatedAt',
    (f5.data?.changes?.records?.upserts ?? []).every((r) => typeof r.updatedAt === 'number') &&
      (f5.data?.changes?.records?.upserts ?? []).some((r) => r.updatedAt === at(5))
  )
  const p5b = await push(tokenA, { records: { upserts: [record('r2', 7, tDel - 10)], deletes: [] } })
  check(
    '本地编辑早于 deletedAt 的 upsert 被拒（reason=deleted）',
    (p5b.data?.rejected ?? []).some((x) => x.key === 'r2' && x.reason === 'deleted'),
    JSON.stringify(p5b.data?.rejected)
  )
  check('记录未复活', recCount('r2') === 0, `实际 ${recCount('r2')}`)

  console.log('[用例 6：复活（updatedAt > deletedAt）→ 记录回归且墓碑清除]')
  const p6 = await push(tokenA, { records: { upserts: [record('r2', 20, tDel + 10)], deletes: [] } })
  check('复活生效 applied.records === 1', p6.data?.applied?.records === 1, JSON.stringify(p6.data?.applied))
  check('序号推进为 5', p6.data?.versions?.records === 5, JSON.stringify(p6.data?.versions))
  check('墓碑被清除', tombOf('r2') === null, JSON.stringify(tombOf('r2')))
  const r2 = recRow('r2')
  check(
    '记录回归（minutes=20 / updated_at / server_seq=5）',
    r2?.minutes === 20 && r2?.updated_at === tDel + 10 && r2?.server_seq === 5,
    JSON.stringify(r2)
  )
  const f6 = await pull(tokenA, { full: true })
  check(
    'full pull：记录回归且无墓碑',
    (f6.data?.changes?.records?.upserts ?? []).some((r) => r.id === 'r2') &&
      (f6.data?.changes?.records?.deletes ?? []).length === 0
  )

  console.log('[用例 7：增量 pull 只返回 server_seq > cursor 的行与墓碑]')
  const recCursor = f6.data?.versions?.records
  check('full pull 的 versions.records === 5', recCursor === 5, JSON.stringify(f6.data?.versions))
  const i0 = await pull(tokenA, { cursors: { records: recCursor } })
  check('增量返回 full=false', i0.status === 200 && i0.data?.full === false, JSON.stringify(i0.data?.full))
  check('无变更域不出现在 changes', !('records' in (i0.data?.changes ?? {})), JSON.stringify(i0.data?.changes))
  check(
    'versions 始终含全部域（未同步域为 0）',
    Object.keys(i0.data?.versions ?? {}).length === 14 && i0.data?.versions?.todos === 0,
    JSON.stringify(i0.data?.versions)
  )
  const p7 = await push(tokenA, { todos: { upserts: [todo('td1', at(20))], deletes: [] } })
  check('todos 域序号为 1', p7.data?.versions?.todos === 1, JSON.stringify(p7.data?.versions))
  const i1 = await pull(tokenA, { cursors: { records: recCursor, todos: 0 } })
  check(
    '增量返回该域新记录（含 updatedAt）',
    (i1.data?.changes?.todos?.upserts ?? []).length === 1 &&
      i1.data.changes.todos.upserts[0].id === 'td1' &&
      i1.data.changes.todos.upserts[0].updatedAt === at(20),
    JSON.stringify(i1.data?.changes?.todos)
  )
  check('未变更域仍不出现', !('records' in (i1.data?.changes ?? {})))
  const i2 = await pull(tokenA, { cursors: { records: recCursor, todos: 1 } })
  check('推进游标后该域不再出现', !('todos' in (i2.data?.changes ?? {})), JSON.stringify(i2.data?.changes))
  const tDelTd = at(21)
  await push(tokenA, { todos: { upserts: [], deletes: [{ key: 'td1', deletedAt: tDelTd }] } })
  const i3 = await pull(tokenA, { cursors: { records: recCursor, todos: 1 } })
  check(
    '增量返回墓碑（含 deletedAt）',
    (i3.data?.changes?.todos?.deletes ?? []).some((d) => d.key === 'td1' && d.deletedAt === tDelTd),
    JSON.stringify(i3.data?.changes?.todos)
  )
  check(
    '该域 upserts 为空数组（结构稳定）',
    Array.isArray(i3.data?.changes?.todos?.upserts) && i3.data.changes.todos.upserts.length === 0
  )

  console.log('[用例 8：用户隔离（变更与墓碑互不可见）]')
  const p8 = await push(tokenB, { todos: { upserts: [todo('b1', at(30), 'B 的待办')], deletes: [] } })
  check('B 推送成功且序号独立为 1', p8.data?.versions?.todos === 1, JSON.stringify(p8.data?.versions))
  const fB = await pull(tokenB, { full: true })
  check(
    'B 只看到自己的记录',
    (fB.data?.changes?.todos?.upserts ?? []).length === 1 && fB.data.changes.todos.upserts[0].id === 'b1',
    JSON.stringify(fB.data?.changes?.todos)
  )
  check('A 的墓碑不出现在 B', (fB.data?.changes?.todos?.deletes ?? []).length === 0)
  check('B 无任何墓碑行', (rowOf(`SELECT COUNT(*) AS n FROM sync_deletions WHERE user_id = '${uidB}'`)?.n ?? -1) === 0)
  const fA = await pull(tokenA, { full: true })
  check(
    'A 看不到 B 的记录',
    (fA.data?.changes?.todos?.upserts ?? []).length === 0,
    JSON.stringify(fA.data?.changes?.todos)
  )
  check('A 的墓碑仍在且只属于 A', (fA.data?.changes?.todos?.deletes ?? []).length === 1)

  console.log('[用例 12：多域单请求原子性（一个域非法 → 全批不生效）]')
  const p12 = await push(tokenA, {
    records: { upserts: [record('r9', 1, at(40))], deletes: [] },
    todos: { upserts: [{ id: 'td9', date: '2026-09-12', text: '缺 updatedAt' }], deletes: [] }
  })
  check('含非法域 → 400', p12.status === 400, `实际 ${p12.status}`)
  check(
    '同批合法域也未写入（整批回滚）',
    recCount('r9') === 0 &&
      (rowOf(`SELECT COUNT(*) AS n FROM todos WHERE user_id = '${uidA}' AND id = 'td9'`)?.n ?? -1) === 0
  )
  const f12 = await pull(tokenA, { full: true })
  check('full pull 中不存在 r9', !(f12.data?.changes?.records?.upserts ?? []).some((r) => r.id === 'r9'))

  console.log('[用例 14：其余已启用单表域（problemSessions/errorQuestions/exams/notes/materials）往返 + 增量可见]')
  const base14 = (await pull(tokenA, { full: true })).data?.versions ?? {}
  const t14 = at(60)
  const p14 = await push(tokenA, {
    problemSessions: { upserts: [problemSession('ps1', t14)], deletes: [] },
    errorQuestions: { upserts: [errorQuestion('eq1', t14)], deletes: [] },
    exams: { upserts: [exam('ex1', t14)], deletes: [] },
    notes: { upserts: [note('nt1', t14)], deletes: [] },
    materials: { upserts: [material('mt1', t14)], deletes: [] }
  })
  const FIVE = ['problemSessions', 'errorQuestions', 'exams', 'notes', 'materials']
  check(
    '五个域同批推送成功，序号各为 1',
    p14.status === 200 && FIVE.every((d) => p14.data?.versions?.[d] === 1),
    JSON.stringify(p14.data?.versions)
  )
  check(
    '五个域 applied 各为 1 且 clamped 为 0',
    FIVE.every((d) => p14.data?.applied?.[d] === 1) && p14.data?.clamped === 0,
    `${JSON.stringify(p14.data?.applied)} clamped=${p14.data?.clamped}`
  )

  const f14 = await pull(tokenA, { full: true })
  const fullChange = (d, k) => (f14.data?.changes?.[d]?.upserts ?? []).find((r) => r.id === k)
  const ps1 = fullChange('problemSessions', 'ps1')
  check(
    'problemSessions 往返：关键字段一致 + updatedAt',
    ps1?.total === 10 && ps1?.correct === 8 && ps1?.types?.单选 === 10 && ps1?.updatedAt === t14,
    JSON.stringify(ps1)
  )
  const eq1 = fullChange('errorQuestions', 'eq1')
  check(
    'errorQuestions 往返：关键字段一致 + updatedAt',
    eq1?.content === '题干' &&
      eq1?.answer === 'B' &&
      eq1?.reviewCount === 2 &&
      eq1?.mastered === false &&
      eq1?.updatedAt === t14,
    JSON.stringify(eq1)
  )
  const ex1 = fullChange('exams', 'ex1')
  check(
    'exams 往返：关键字段一致 + updatedAt',
    ex1?.title === '一模' &&
      ex1?.score === 120 &&
      ex1?.totalScore === 150 &&
      ex1?.parts?.[0]?.score === 40 &&
      ex1?.updatedAt === t14,
    JSON.stringify(ex1)
  )
  const nt1 = fullChange('notes', 'nt1')
  check(
    'notes 往返：仅元数据 + bodyUpdatedAt/updatedAt 与请求值一致',
    nt1?.title === '笔记' &&
      !Object.prototype.hasOwnProperty.call(nt1 ?? {}, 'content') &&
      JSON.stringify(nt1?.tags) === '["tag1"]' &&
      nt1?.bodyUpdatedAt === t14 &&
      nt1?.updatedAt === t14,
    JSON.stringify(nt1)
  )
  const mt1 = fullChange('materials', 'mt1')
  check(
    'materials 往返：关键字段一致 + updatedAt',
    mt1?.title === '资料' &&
      mt1?.type === 'book' &&
      mt1?.priority === '高' &&
      mt1?.readPages === 3 &&
      mt1?.updatedAt === t14,
    JSON.stringify(mt1)
  )
  // notes.updated_at 是迁移前就存在的列（NOT NULL、无默认值）：push 必须把客户端编辑时刻真正落库
  const ntRow = rowOf(`SELECT updated_at, server_seq FROM notes WHERE user_id = '${uidA}' AND id = 'nt1'`)
  check(
    'notes 的 updated_at 落库 = 请求的 updatedAt（不是服务器当前时间）',
    ntRow?.updated_at === t14 && ntRow?.server_seq === 1 && t14 !== Date.now(),
    JSON.stringify(ntRow)
  )
  const i14 = await pull(tokenA, { cursors: base14 })
  check(
    '五个域都能通过增量 pull 看到',
    i14.data?.full === false && FIVE.every((d) => (i14.data?.changes?.[d]?.upserts ?? []).length === 1),
    JSON.stringify(Object.keys(i14.data?.changes ?? {}))
  )

  console.log('[用例 15：同域并发 push → 序号原子分配互不相同，游标不丢数据]')
  const t15 = at(80)
  const [c1, c2] = await Promise.all([
    push(tokenA, { materials: { upserts: [material('mtc1', t15, '并发1')], deletes: [] } }),
    push(tokenA, { materials: { upserts: [material('mtc2', t15, '并发2')], deletes: [] } })
  ])
  const v1 = c1.data?.versions?.materials
  const v2 = c2.data?.versions?.materials
  check('两个并发 push 都成功', c1.status === 200 && c2.status === 200, `${c1.status}/${c2.status}`)
  check('两批拿到的序号互不相同', Number.isInteger(v1) && Number.isInteger(v2) && v1 !== v2, `${v1}/${v2}`)
  console.log(`  并发结果: mtc1→版本 ${v1}，mtc2→版本 ${v2}（同一域的连续两个序号）`)
  const seqOf = (id) => rowOf(`SELECT server_seq FROM materials WHERE user_id = '${uidA}' AND id = '${id}'`)?.server_seq
  check(
    '两批记录的 server_seq 与各自返回的 versions 一致',
    seqOf('mtc1') === v1 && seqOf('mtc2') === v2,
    `${seqOf('mtc1')}/${seqOf('mtc2')} vs ${v1}/${v2}`
  )
  const lower = Math.min(v1, v2)
  const upperId = v1 > v2 ? 'mtc1' : 'mtc2'
  const idsOf = (res) =>
    (res.data?.changes?.materials?.upserts ?? [])
      .map((r) => r.id)
      .sort()
      .join(',')
  const incLower = await pull(tokenA, { cursors: { materials: lower } })
  check(
    '以较小序号为游标：较大那批记录仍可见（修复前的竞态会永久漏掉它）',
    idsOf(incLower) === upperId,
    `${idsOf(incLower)} 期望 ${upperId}`
  )
  const incBoth = await pull(tokenA, { cursors: { materials: lower - 1 } })
  check('从较小序号之前拉取：两批记录全部可见', idsOf(incBoth) === 'mtc1,mtc2', idsOf(incBoth))

  console.log('[用例 16：pull 空请求体等价于 {}（full 快照）]')
  const emptyBody = await api('/api/data/pull', { method: 'POST', token: tokenA })
  check(
    '空 body 返回 200 且 full=true 快照',
    emptyBody.status === 200 && emptyBody.data?.full === true && !!emptyBody.data?.changes,
    `实际 ${emptyBody.status} ${JSON.stringify(emptyBody.data)?.slice(0, 120)}`
  )

  console.log('[用例 17：输入上限（单字符串字段 1MB / 单域 10000 条）]')
  const bigField = await push(tokenA, {
    materials: { upserts: [material('mtBig', at(90), 'x'.repeat(1_000_001))], deletes: [] }
  })
  check(
    '单字符串字段超过 1MB → 413',
    bigField.status === 413 && /1MB/.test(bigField.data?.message ?? ''),
    `实际 ${bigField.status} ${JSON.stringify(bigField.data)}`
  )
  check(
    '超长字段请求未落库',
    (rowOf(`SELECT COUNT(*) AS n FROM materials WHERE user_id = '${uidA}' AND id = 'mtBig'`)?.n ?? -1) === 0
  )
  const bodyInMetadata = await push(tokenA, {
    notes: { upserts: [{ ...note('ntBodyLeak', at(90)), content: '不应进入同步' }], deletes: [] }
  })
  check(
    'notes 元数据夹带 content → 400',
    bodyInMetadata.status === 400 && /正文/.test(bodyInMetadata.data?.message ?? '')
  )
  const tooMany = await push(tokenA, {
    materials: { upserts: [], deletes: Array.from({ length: 10_001 }, (_, i) => ({ key: `k${i}`, deletedAt: at(90) })) }
  })
  check(
    '单域条数超过 10000 → 413',
    tooMany.status === 413 && /10000/.test(tooMany.data?.message ?? ''),
    `实际 ${tooMany.status} ${JSON.stringify(tooMany.data)}`
  )

  console.log('[用例 18：同请求内重复 key 去重（保留最大 updatedAt）；同 key upsert+delete → 400]')
  const dupPush = await push(tokenA, {
    // 数组顺序为「新值、旧值」：若不去重，后写的旧值会覆盖新值（反转 LWW）
    materials: { upserts: [material('mtdup', at(120), '新值'), material('mtdup', at(100), '旧值')], deletes: [] }
  })
  check(
    '重复 key 请求 200 且 applied=1（去重后只写一次）',
    dupPush.status === 200 && dupPush.data?.applied?.materials === 1,
    `${dupPush.status} ${JSON.stringify(dupPush.data?.applied)}`
  )
  const dupRow = rowOf(`SELECT updated_at FROM materials WHERE user_id = '${uidA}' AND id = 'mtdup'`)
  check('落库为较大的 updatedAt（旧值未覆盖新值）', dupRow?.updated_at === at(120), JSON.stringify(dupRow))
  const dupPull = await pull(tokenA, { full: true })
  check(
    '往返取值为新值条目',
    (dupPull.data?.changes?.materials?.upserts ?? []).find((r) => r.id === 'mtdup')?.title === '新值'
  )
  const conflict = await push(tokenA, {
    records: { upserts: [record('rc1', 5, at(130))], deletes: [{ key: 'rc1', deletedAt: at(130) }] }
  })
  check(
    '同 key 同时 upsert 与 delete → 400 中文提示',
    conflict.status === 400 && /不能同时被 upsert 与 delete/.test(conflict.data?.message ?? ''),
    `实际 ${conflict.status} ${JSON.stringify(conflict.data)}`
  )
  check('冲突请求未落库', recCount('rc1') === 0, `实际 ${recCount('rc1')}`)

  console.log('[用例 19：updatedAt 时钟钳制（超前 > 5 分钟按服务端时间落库）]')
  const futureAt = Date.now() + 10 * 60_000
  const clampPush = await push(tokenA, {
    materials: { upserts: [material('mtclamp', futureAt, '未来时钟')], deletes: [] }
  })
  check('超前 10 分钟 → clamped === 1', clampPush.data?.clamped === 1, JSON.stringify(clampPush.data))
  const clampRow = rowOf(`SELECT updated_at FROM materials WHERE user_id = '${uidA}' AND id = 'mtclamp'`)
  check(
    '落库 updated_at 约为服务端当前时间（不是未来值）',
    !!clampRow && Math.abs(clampRow.updated_at - Date.now()) < 10_000 && clampRow.updated_at < futureAt,
    JSON.stringify(clampRow)
  )
  const normalAt = Date.now() + 1000
  const afterPush = await push(tokenA, {
    materials: { upserts: [material('mtclamp', normalAt, '正常时钟')], deletes: [] }
  })
  check(
    '钳制后一条正常 updatedAt 的修改仍能生效（未被永久占位）',
    afterPush.data?.applied?.materials === 1 && afterPush.data?.clamped === 0,
    `${JSON.stringify(afterPush.data?.applied)} clamped=${afterPush.data?.clamped}`
  )
  const afterRow = rowOf(`SELECT updated_at FROM materials WHERE user_id = '${uidA}' AND id = 'mtclamp'`)
  check('覆盖生效（updated_at = 本次请求值）', afterRow?.updated_at === normalAt, JSON.stringify(afterRow))

  console.log('[用例 20：subjects 域（科目聚合子树）往返 / 子树 id 稳定 / 增量可见 / 删除墓碑]')
  const t20 = at(200)
  const subjectValue = {
    id: 'sj1',
    name: '高等数学',
    icon: 'sigma',
    color: '#3366ff',
    weight: 3,
    builtin: false,
    chapters: [{ id: 'ch1', name: '第一章 极限', topics: ['极限', '导数'] }],
    mastery: { 极限: 4, 导数: 2 },
    topicImportance: { 极限: 'important' }
  }
  const p20 = await push(tokenA, { subjects: { upserts: [wrap('sj1', subjectValue, t20)], deletes: [] } })
  check(
    'subjects 首推生效（applied=1 / versions=1）',
    p20.status === 200 && p20.data?.applied?.subjects === 1 && p20.data?.versions?.subjects === 1,
    JSON.stringify(p20.data)
  )
  const sjRow1 = rowOf(`SELECT rowid, name, server_seq FROM subjects WHERE user_id = '${uidA}' AND id = 'sj1'`)
  check('科目主行落库（server_seq=1）', sjRow1?.server_seq === 1, JSON.stringify(sjRow1))
  const topicIds1 = d1Rows(`SELECT id FROM topics WHERE user_id = '${uidA}' AND chapter_id = 'ch1' ORDER BY rowid`).map(
    (r) => r.id
  )
  check(
    '保留客户端给出的 chapter id，且子树 topic 行已建（2 条）',
    topicIds1.length === 2 && !!rowOf(`SELECT id FROM chapters WHERE user_id = '${uidA}' AND id = 'ch1'`),
    JSON.stringify(topicIds1)
  )
  const childStamp = rowOf(
    `SELECT updated_at, server_seq FROM topics WHERE user_id = '${uidA}' AND chapter_id = 'ch1' LIMIT 1`
  )
  check(
    '子表行继承所属科目的 updated_at/server_seq',
    childStamp?.updated_at === t20 && childStamp?.server_seq === 1,
    JSON.stringify(childStamp)
  )

  const f20 = await pull(tokenA, { full: true })
  const sj1 = wrappedOf(f20, 'subjects', 'sj1')
  check(
    'full pull 往返：科目字段 + 子树结构一致',
    sj1?.value?.name === '高等数学' &&
      sj1?.value?.weight === 3 &&
      sj1?.value?.builtin === false &&
      sj1?.value?.chapters?.length === 1 &&
      sj1?.value?.chapters?.[0]?.id === 'ch1' &&
      JSON.stringify(sj1?.value?.chapters?.[0]?.topics) === '["极限","导数"]',
    JSON.stringify(sj1)
  )
  check(
    'full pull 往返：mastery / topicImportance 一致',
    sj1?.value?.mastery?.极限 === 4 && sj1?.value?.topicImportance?.极限 === 'important',
    JSON.stringify(sj1?.value)
  )
  check(
    '复杂域 upserts 元素为 { key, value, updatedAt } 包装',
    sj1?.key === 'sj1' && sj1?.updatedAt === t20,
    JSON.stringify(sj1)
  )

  const t20b = at(201)
  const p20b = await push(tokenA, {
    subjects: { upserts: [wrap('sj1', { ...subjectValue, name: '高数（改名）' }, t20b)], deletes: [] }
  })
  check(
    '二次推送（仅改标题）生效（序号推进为 2）',
    p20b.data?.applied?.subjects === 1 && p20b.data?.versions?.subjects === 2,
    JSON.stringify(p20b.data)
  )
  const topicIds2 = d1Rows(`SELECT id FROM topics WHERE user_id = '${uidA}' AND chapter_id = 'ch1' ORDER BY rowid`).map(
    (r) => r.id
  )
  check(
    '二次推送后 topic id 完全不变（子树 id 稳定，未被新 uid 覆盖）',
    topicIds2.length === 2 && JSON.stringify(topicIds2) === JSON.stringify(topicIds1),
    `${JSON.stringify(topicIds1)} → ${JSON.stringify(topicIds2)}`
  )
  const sjRow2 = rowOf(`SELECT rowid, name, server_seq FROM subjects WHERE user_id = '${uidA}' AND id = 'sj1'`)
  check(
    '科目主行 rowid 不变（upsert 而非先删后插）+ 名称已更新',
    sjRow2?.rowid === sjRow1?.rowid && sjRow2?.name === '高数（改名）' && sjRow2?.server_seq === 2,
    JSON.stringify(sjRow2)
  )
  const i20 = await pull(tokenA, { cursors: { subjects: 0 } })
  check(
    '增量 pull 返回该科目（取服务端最新状态）',
    i20.data?.full === false &&
      wrappedOf(i20, 'subjects', 'sj1')?.value?.name === '高数（改名）' &&
      i20.data?.versions?.subjects === 2,
    JSON.stringify(i20.data?.changes?.subjects)
  )
  const i20b = await pull(tokenA, { cursors: { subjects: 2 } })
  check(
    '游标推进到 versions.subjects 后不再返回该科目',
    !('subjects' in (i20b.data?.changes ?? {})),
    JSON.stringify(i20b.data?.changes)
  )

  const t20c = at(202)
  const d20 = await push(tokenA, { subjects: { upserts: [], deletes: [{ key: 'sj1', deletedAt: t20c }] } })
  check(
    '科目删除生效（deletes=1 / 序号 3）',
    d20.data?.deletes?.subjects === 1 && d20.data?.versions?.subjects === 3,
    JSON.stringify(d20.data)
  )
  const f20b = await pull(tokenA, { full: true })
  check(
    '删除后 full pull 不返回且出现墓碑、子树行一并清理',
    !wrappedOf(f20b, 'subjects', 'sj1') &&
      (f20b.data?.changes?.subjects?.deletes ?? []).some((d) => d.key === 'sj1' && d.deletedAt === t20c) &&
      (rowOf(`SELECT COUNT(*) AS n FROM topics WHERE user_id = '${uidA}' AND chapter_id = 'ch1'`)?.n ?? -1) === 0 &&
      (rowOf(`SELECT COUNT(*) AS n FROM subjects WHERE user_id = '${uidA}' AND id = 'sj1'`)?.n ?? -1) === 0,
    JSON.stringify(f20b.data?.changes?.subjects)
  )

  console.log('[用例 21：habits 域（习惯 + 打卡 map）往返 / 同日二次打卡 → 增量见新值]')
  const t21 = at(210)
  const habitValue = {
    id: 'hb1',
    name: '背单词',
    type: 'count',
    target: 20,
    bad: false,
    records: { '2026-09-11': 5 },
    checkins: { '2026-09-12': 1 }
  }
  const p21 = await push(tokenA, { habits: { upserts: [wrap('hb1', habitValue, t21)], deletes: [] } })
  check(
    'habits 首推生效（applied=1 / versions=1）',
    p21.data?.applied?.habits === 1 && p21.data?.versions?.habits === 1,
    JSON.stringify(p21.data)
  )
  const f21 = await pull(tokenA, { full: true })
  const hb1 = wrappedOf(f21, 'habits', 'hb1')
  check(
    '往返一致：名称 / type / target / bad',
    hb1?.value?.name === '背单词' &&
      hb1?.value?.type === 'count' &&
      hb1?.value?.target === 20 &&
      hb1?.value?.bad === false,
    JSON.stringify(hb1)
  )
  check(
    '往返一致：records / checkins map',
    hb1?.value?.records?.['2026-09-11'] === 5 && hb1?.value?.checkins?.['2026-09-12'] === 1 && hb1?.updatedAt === t21,
    JSON.stringify(hb1?.value)
  )
  check(
    '打卡表落库 2 行（records + checkin）',
    (rowOf(`SELECT COUNT(*) AS n FROM habit_records WHERE user_id = '${uidA}' AND habit_id = 'hb1'`)?.n ?? -1) === 2
  )
  const t21b = at(211)
  const p21b = await push(tokenA, {
    habits: { upserts: [wrap('hb1', { ...habitValue, records: { '2026-09-11': 9 } }, t21b)], deletes: [] }
  })
  check(
    '同日二次打卡生效（序号推进为 2）',
    p21b.data?.applied?.habits === 1 && p21b.data?.versions?.habits === 2,
    JSON.stringify(p21b.data)
  )
  const i21 = await pull(tokenA, { cursors: { habits: 1 } })
  check(
    '同日二次打卡：增量可见且为新值',
    i21.data?.full === false && wrappedOf(i21, 'habits', 'hb1')?.value?.records?.['2026-09-11'] === 9,
    JSON.stringify(i21.data?.changes?.habits)
  )
  const hbRow2 = rowOf(`SELECT COUNT(*) AS n FROM habit_records WHERE user_id = '${uidA}' AND habit_id = 'hb1'`)
  const hbVal = rowOf(
    `SELECT value FROM habit_records WHERE user_id = '${uidA}' AND habit_id = 'hb1' AND date = '2026-09-11'`
  )
  check(
    '该习惯打卡表被整体重建（仍 2 行，值为新值）',
    hbRow2?.n === 2 && hbVal?.value === '9',
    JSON.stringify({ hbRow2, hbVal })
  )

  console.log('[用例 22：pomodoro 三键空间（day:/itr:/rec:）往返 / itr 整体替换 / rec 删除墓碑]')
  const t22 = at(220)
  const p22 = await push(tokenA, {
    pomodoro: {
      upserts: [
        wrap('day:2026-09-10', { date: '2026-09-10', count: 2, minutes: 50, interruptions: 1 }, t22),
        wrap(
          'itr:2026-09-10',
          [
            { reason: '走神', time: 1000 },
            { reason: '喝水', time: 2000 }
          ],
          t22
        ),
        wrap(
          'rec:pr1',
          { id: 'pr1', date: '2026-09-10', time: 3000, minutes: 25, description: '专注一轮', source: 'solo' },
          t22
        )
      ],
      deletes: []
    }
  })
  check(
    'pomodoro 三键同批生效（applied=3 / versions=1）',
    p22.status === 200 && p22.data?.applied?.pomodoro === 3 && p22.data?.versions?.pomodoro === 1,
    JSON.stringify(p22.data)
  )
  const f22 = await pull(tokenA, { full: true })
  const day22 = wrappedOf(f22, 'pomodoro', 'day:2026-09-10')
  check(
    'day 键往返：日统计一致 + 值内含 date',
    day22?.value?.count === 2 &&
      day22?.value?.minutes === 50 &&
      day22?.value?.interruptions === 1 &&
      day22?.value?.date === '2026-09-10',
    JSON.stringify(day22)
  )
  const itr22 = wrappedOf(f22, 'pomodoro', 'itr:2026-09-10')
  check(
    'itr 键往返：该日打断列表（内容与顺序一致）',
    Array.isArray(itr22?.value) &&
      itr22.value.length === 2 &&
      itr22.value[0].reason === '走神' &&
      itr22.value[1].time === 2000 &&
      itr22.updatedAt === t22,
    JSON.stringify(itr22)
  )
  const rec22 = wrappedOf(f22, 'pomodoro', 'rec:pr1')
  check(
    'rec 键往返：记录字段一致',
    rec22?.value?.description === '专注一轮' &&
      rec22?.value?.minutes === 25 &&
      rec22?.value?.time === 3000 &&
      rec22?.value?.partnerName === undefined,
    JSON.stringify(rec22)
  )
  check(
    '三键分别落三张表',
    (rowOf(`SELECT COUNT(*) AS n FROM pomodoro_daily WHERE user_id = '${uidA}' AND date = '2026-09-10'`)?.n ?? -1) ===
      1 &&
      (rowOf(`SELECT COUNT(*) AS n FROM pomodoro_interruptions WHERE user_id = '${uidA}' AND date = '2026-09-10'`)?.n ??
        -1) === 2 &&
      (rowOf(`SELECT COUNT(*) AS n FROM pomodoro_records WHERE user_id = '${uidA}' AND id = 'pr1'`)?.n ?? -1) === 1
  )

  const t22b = at(221)
  await push(tokenA, {
    pomodoro: { upserts: [wrap('itr:2026-09-10', [{ reason: '新打断', time: 4000 }], t22b)], deletes: [] }
  })
  const itrRow = rowOf(
    `SELECT COUNT(*) AS n FROM pomodoro_interruptions WHERE user_id = '${uidA}' AND date = '2026-09-10'`
  )
  const itrReason = rowOf(`SELECT reason FROM pomodoro_interruptions WHERE user_id = '${uidA}' AND date = '2026-09-10'`)
  check(
    'itr 覆盖后该日打断列表被整体替换（1 条且为新内容）',
    itrRow?.n === 1 && itrReason?.reason === '新打断',
    JSON.stringify({ itrRow, itrReason })
  )
  const i22 = await pull(tokenA, { cursors: { pomodoro: 1 } })
  check(
    'itr 覆盖在增量中可见（值为新列表）',
    wrappedOf(i22, 'pomodoro', 'itr:2026-09-10')?.value?.[0]?.reason === '新打断',
    JSON.stringify(i22.data?.changes?.pomodoro)
  )

  const t22c = at(222)
  const p22c = await push(tokenA, { pomodoro: { upserts: [], deletes: [{ key: 'rec:pr1', deletedAt: t22c }] } })
  check(
    'rec 删除生效（deletes=1 / 序号 3）',
    p22c.data?.deletes?.pomodoro === 1 && p22c.data?.versions?.pomodoro === 3,
    JSON.stringify(p22c.data)
  )
  const f22b = await pull(tokenA, { full: true })
  check(
    'rec 删除后 full pull 不再返回且出现墓碑 + 业务行已删',
    !wrappedOf(f22b, 'pomodoro', 'rec:pr1') &&
      (f22b.data?.changes?.pomodoro?.deletes ?? []).some((d) => d.key === 'rec:pr1' && d.deletedAt === t22c) &&
      (rowOf(`SELECT COUNT(*) AS n FROM pomodoro_records WHERE user_id = '${uidA}' AND id = 'pr1'`)?.n ?? -1) === 0,
    JSON.stringify(f22b.data?.changes?.pomodoro)
  )

  console.log('[用例 23：english 域四键前缀分别落到 vocab/reading/listening/essay_templates]')
  const t23 = at(230)
  const p23 = await push(tokenA, {
    english: {
      upserts: [
        wrap('vocab:vb1', { id: 'vb1', date: '2026-09-10', newWords: 30, reviewWords: 100, points: 25 }, t23),
        wrap('reading:rd1', { id: 'rd1', date: '2026-09-10', wpm: 200, accuracy: 0.8 }, t23),
        wrap('listening:ls1', { id: 'ls1', date: '2026-09-10', minutes: 30, material: 'VOA', mode: '精听' }, t23),
        wrap('template:tp1', { id: 'tp1', title: '议论文模板', content: '开头…', level: 2, category: '议论文' }, t23)
      ],
      deletes: []
    }
  })
  check(
    'english 四键同批生效（applied=4 / versions=1）',
    p23.status === 200 && p23.data?.applied?.english === 4 && p23.data?.versions?.english === 1,
    JSON.stringify(p23.data)
  )
  const countIn = (table, id) =>
    rowOf(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = '${uidA}' AND id = '${id}'`)?.n ?? -1
  check(
    '键前缀正确落表（vocab_records/reading_records/listening_records/essay_templates 各 1 行）',
    countIn('vocab_records', 'vb1') === 1 &&
      countIn('reading_records', 'rd1') === 1 &&
      countIn('listening_records', 'ls1') === 1 &&
      countIn('essay_templates', 'tp1') === 1,
    JSON.stringify([
      countIn('vocab_records', 'vb1'),
      countIn('reading_records', 'rd1'),
      countIn('listening_records', 'ls1'),
      countIn('essay_templates', 'tp1')
    ])
  )
  const f23 = await pull(tokenA, { full: true })
  check(
    '往返一致：vocab 键',
    wrappedOf(f23, 'english', 'vocab:vb1')?.value?.newWords === 30 &&
      wrappedOf(f23, 'english', 'vocab:vb1')?.value?.points === 25,
    JSON.stringify(wrappedOf(f23, 'english', 'vocab:vb1'))
  )
  check(
    '往返一致：reading 键',
    wrappedOf(f23, 'english', 'reading:rd1')?.value?.wpm === 200 &&
      wrappedOf(f23, 'english', 'reading:rd1')?.value?.accuracy === 0.8,
    JSON.stringify(wrappedOf(f23, 'english', 'reading:rd1'))
  )
  check(
    '往返一致：listening 键',
    wrappedOf(f23, 'english', 'listening:ls1')?.value?.material === 'VOA' &&
      wrappedOf(f23, 'english', 'listening:ls1')?.value?.mode === '精听',
    JSON.stringify(wrappedOf(f23, 'english', 'listening:ls1'))
  )
  check(
    '往返一致：template 键',
    wrappedOf(f23, 'english', 'template:tp1')?.value?.title === '议论文模板' &&
      wrappedOf(f23, 'english', 'template:tp1')?.value?.level === 2,
    JSON.stringify(wrappedOf(f23, 'english', 'template:tp1'))
  )

  console.log('[用例 24：summaries 域（键 = date）推入 / 更新 / 删除 + 墓碑]')
  const t24 = at(240)
  const p24 = await push(tokenA, {
    summaries: {
      upserts: [
        wrap('2026-09-10', { date: '2026-09-10', mood: '开心', harvest: '收获', improve: '不足', plan: '计划' }, t24)
      ],
      deletes: []
    }
  })
  check(
    'summaries 首推生效（applied=1 / versions=1）',
    p24.data?.applied?.summaries === 1 && p24.data?.versions?.summaries === 1,
    JSON.stringify(p24.data)
  )
  const u24 = await push(tokenA, {
    summaries: {
      upserts: [
        wrap(
          '2026-09-10',
          { date: '2026-09-10', mood: '平静', harvest: '收获2', improve: '不足2', plan: '计划2' },
          at(241)
        )
      ],
      deletes: []
    }
  })
  check(
    '同日更新生效（序号推进为 2）',
    u24.data?.applied?.summaries === 1 && u24.data?.versions?.summaries === 2,
    JSON.stringify(u24.data)
  )
  const f24 = await pull(tokenA, { full: true })
  const sum24 = wrappedOf(f24, 'summaries', '2026-09-10')
  check(
    '往返一致 + 更新后的值',
    sum24?.value?.mood === '平静' && sum24?.value?.plan === '计划2' && sum24?.value?.date === '2026-09-10',
    JSON.stringify(sum24)
  )
  check(
    'daily_summaries 单行（主键 user_id + date）',
    (rowOf(`SELECT COUNT(*) AS n FROM daily_summaries WHERE user_id = '${uidA}'`)?.n ?? -1) === 1
  )
  const d24 = await push(tokenA, { summaries: { upserts: [], deletes: [{ key: '2026-09-10', deletedAt: at(242) }] } })
  check(
    '删除生效（deletes=1 / 序号 3）',
    d24.data?.deletes?.summaries === 1 && d24.data?.versions?.summaries === 3,
    JSON.stringify(d24.data)
  )
  const f24b = await pull(tokenA, { full: true })
  check(
    '删除后 full pull 不返回该日且墓碑存在、业务行已删',
    !wrappedOf(f24b, 'summaries', '2026-09-10') &&
      (f24b.data?.changes?.summaries?.deletes ?? []).some((d) => d.key === '2026-09-10' && d.deletedAt === at(242)) &&
      (rowOf(`SELECT COUNT(*) AS n FROM daily_summaries WHERE user_id = '${uidA}'`)?.n ?? -1) === 0,
    JSON.stringify(f24b.data?.changes?.summaries)
  )

  console.log('[用例 25：settings 域（键 = self）/ maimemoToken「undefined 不覆盖」/ 单记录 LWW]')
  const t25 = at(250)
  const baseSettings = {
    userName: '同步测试',
    dailyGoalMinutes: 300,
    wordGoal: 60,
    problemGoal: 40,
    examDate: '2027-04-01',
    theme: 'dark',
    reminderEnabled: true,
    reminderTime: '07:30',
    quotes: ['自律即自由'],
    onboarded: true,
    joinProgressBoard: false,
    profileVisibility: 'private',
    bio: '简介',
    doNotDisturb: false,
    dndStartTime: '22:00',
    dndEndTime: '07:00',
    dndMutedTypes: ['like'],
    dndMuteMessage: false,
    partnerShareEnabled: true,
    partnerRemindEnabled: false
  }
  const p25 = await push(tokenA, {
    settings: { upserts: [wrap('self', { ...baseSettings, maimemoToken: 'tok-sync-xyz' }, t25)], deletes: [] }
  })
  check(
    'settings 首推生效（applied=1 / versions=1）',
    p25.status === 200 && p25.data?.applied?.settings === 1 && p25.data?.versions?.settings === 1,
    JSON.stringify(p25.data)
  )
  const tokenBefore = rowOf(`SELECT maimemo_token FROM user_settings WHERE user_id = '${uidA}'`)?.maimemo_token
  check(
    'maimemoToken 已加密落库',
    typeof tokenBefore === 'string' && tokenBefore.length > 0 && tokenBefore !== 'tok-sync-xyz'
  )
  const f25 = await pull(tokenA, { full: true })
  const self25 = wrappedOf(f25, 'settings', 'self')
  check(
    '往返一致：设置字段',
    self25?.value?.userName === '同步测试' &&
      self25?.value?.dailyGoalMinutes === 300 &&
      self25?.value?.theme === 'dark' &&
      JSON.stringify(self25?.value?.quotes) === '["自律即自由"]',
    JSON.stringify(self25?.value)
  )
  check(
    'maimemoToken 不回传明文，仅回传已配置标记',
    self25?.value?.maimemoToken === undefined && self25?.value?.maimemoConnected === true,
    JSON.stringify(self25?.value)
  )
  const p25b = await push(tokenA, {
    settings: { upserts: [wrap('self', { ...baseSettings, dailyGoalMinutes: 360 }, at(251))], deletes: [] }
  })
  check(
    '二次推送（不带 maimemoToken）生效（序号推进为 2）',
    p25b.data?.applied?.settings === 1 && p25b.data?.versions?.settings === 2,
    JSON.stringify(p25b.data)
  )
  const tokenAfter = rowOf(`SELECT maimemo_token FROM user_settings WHERE user_id = '${uidA}'`)?.maimemo_token
  check(
    '未传 maimemoToken 时云端凭证原样保留（未清空、未被重新加密覆盖）',
    typeof tokenAfter === 'string' && tokenAfter.length > 0 && tokenAfter === tokenBefore,
    `before=${typeof tokenBefore} after=${typeof tokenAfter}`
  )
  const f25b = await pull(tokenA, { full: true })
  check(
    '二次推送后读取：新值生效且 token 仍在',
    wrappedOf(f25b, 'settings', 'self')?.value?.dailyGoalMinutes === 360 &&
      wrappedOf(f25b, 'settings', 'self')?.value?.maimemoConnected === true,
    JSON.stringify(wrappedOf(f25b, 'settings', 'self')?.value)
  )
  const p25c = await push(tokenA, {
    settings: { upserts: [wrap('self', { ...baseSettings, dailyGoalMinutes: 1 }, t25)], deletes: [] }
  })
  check(
    '旧 updatedAt 被判负（settings 单记录 LWW）',
    (p25c.data?.rejected ?? []).some((x) => x.domain === 'settings' && x.key === 'self' && x.reason === 'older') &&
      !(p25c.data?.applied?.settings > 0),
    JSON.stringify(p25c.data?.rejected)
  )
  const f25c = await pull(tokenA, { full: true })
  check(
    '服务端保留新值（dailyGoalMinutes 仍为 360）',
    wrappedOf(f25c, 'settings', 'self')?.value?.dailyGoalMinutes === 360,
    JSON.stringify(wrappedOf(f25c, 'settings', 'self')?.value)
  )

  console.log('[用例 26：full 与增量对同一域返回的 upserts 元素结构一致 + 顶层整域快照键已删除]')
  const t26 = at(260)
  await push(tokenA, {
    records: { upserts: [record('rshape', 15, t26)], deletes: [] },
    pomodoro: {
      upserts: [
        wrap(
          'rec:prshape',
          { id: 'prshape', date: '2026-09-10', time: 5000, minutes: 10, description: '形状', source: 'solo' },
          t26
        )
      ],
      deletes: []
    }
  })
  const f26 = await pull(tokenA, { full: true })
  const i26 = await pull(tokenA, { cursors: { records: 0, pomodoro: 0 } })
  const shapeOf = (obj) =>
    Object.keys(obj ?? {})
      .sort()
      .join(',')
  check(
    '单表域：full 与增量元素同为记录对象（无 key/value 包装）',
    shapeOf(recordOf(f26, 'records', 'rshape')) === shapeOf(recordOf(i26, 'records', 'rshape')) &&
      !('key' in (recordOf(f26, 'records', 'rshape') ?? {})) &&
      recordOf(f26, 'records', 'rshape')?.updatedAt === t26,
    `${shapeOf(recordOf(f26, 'records', 'rshape'))} vs ${shapeOf(recordOf(i26, 'records', 'rshape'))}`
  )
  check(
    '复杂域：full 与增量元素同为 { key, value, updatedAt }',
    shapeOf(wrappedOf(f26, 'pomodoro', 'rec:prshape')) === 'key,updatedAt,value' &&
      shapeOf(wrappedOf(i26, 'pomodoro', 'rec:prshape')) === 'key,updatedAt,value',
    `${shapeOf(wrappedOf(f26, 'pomodoro', 'rec:prshape'))} vs ${shapeOf(wrappedOf(i26, 'pomodoro', 'rec:prshape'))}`
  )
  check(
    '复杂域包装内的 value 即记录内容',
    wrappedOf(i26, 'pomodoro', 'rec:prshape')?.value?.description === '形状' &&
      wrappedOf(i26, 'pomodoro', 'rec:prshape')?.value?.id === 'prshape'
  )
  check(
    'full pull 的 changes 覆盖全部 13 个记录级域（不含 gamification）',
    SYNCED_DOMAINS.every((d) => !!f26.data?.changes?.[d]) && !('gamification' in (f26.data?.changes ?? {})),
    JSON.stringify(Object.keys(f26.data?.changes ?? {}))
  )
  check(
    'full pull 不再返回顶层整域快照键（形状与增量统一）',
    ['subjects', 'habits', 'pomodoro', 'settings', 'summaries', 'english'].every((k) => !(k in (f26.data ?? {}))),
    JSON.stringify(Object.keys(f26.data ?? {}))
  )

  console.log('[用例 27：复杂域未知键前缀 / 非法键值 → 400（每个复杂域至少一例）+ 整批原子性]')
  const badMessage = async (domain, key, value) =>
    (await push(tokenA, { [domain]: { upserts: [wrap(key, value, at(270))], deletes: [] } })).data?.message
  const msgPomo = await badMessage('pomodoro', 'week:2026-09-10', {})
  check(
    'pomodoro 未知键前缀 → 400 中文提示',
    typeof msgPomo === 'string' && /day:\/itr:\/rec:/.test(msgPomo),
    String(msgPomo)
  )
  const msgEng = await badMessage('english', 'speak:en1', {})
  check(
    'english 未知键前缀 → 400 中文提示',
    typeof msgEng === 'string' && /vocab:\/reading:\/listening:\/template:/.test(msgEng),
    String(msgEng)
  )
  const msgSettings = await badMessage('settings', 'other', {})
  check(
    'settings 未知键 → 400（只接受 self）',
    typeof msgSettings === 'string' && /只接受键 self/.test(msgSettings),
    String(msgSettings)
  )
  const msgItr = await badMessage('pomodoro', 'itr:2026-09-10', { reason: 'x' })
  check('pomodoro itr: 值非数组 → 400', typeof msgItr === 'string' && /itr: 键需要数组值/.test(msgItr), String(msgItr))
  const msgRec = await badMessage('pomodoro', 'rec:prbad', { minutes: 1 })
  check(
    'pomodoro rec: 缺 date/time → 400',
    typeof msgRec === 'string' && /必须含 date 与 time/.test(msgRec),
    String(msgRec)
  )
  const msgSubj = await badMessage('subjects', 'sjbad', 'x')
  check('subjects 值非对象 → 400', typeof msgSubj === 'string' && /记录值必须为对象/.test(msgSubj), String(msgSubj))
  const msgHabit = await badMessage('habits', 'hbbad', [])
  check('habits 值非对象 → 400', typeof msgHabit === 'string' && /记录值必须为对象/.test(msgHabit), String(msgHabit))
  const msgSum = await badMessage('summaries', '2026-01-01', 42)
  check('summaries 值非对象 → 400', typeof msgSum === 'string' && /记录值必须为对象/.test(msgSum), String(msgSum))
  const msgEngId = await badMessage('english', 'vocab:', {})
  check('english 键缺记录 id → 400', typeof msgEngId === 'string' && /缺少记录 id/.test(msgEngId), String(msgEngId))

  const atomic = await push(tokenA, {
    records: { upserts: [record('rbad', 1, at(271))], deletes: [] },
    english: { upserts: [wrap('speak:en9', {}, at(271))], deletes: [] }
  })
  check(
    '同批含非法复杂域 → 400 且合法域未写入（整批原子）',
    atomic.status === 400 && recCount('rbad') === 0,
    `${atomic.status} / ${recCount('rbad')}`
  )
  check(
    '非法复杂域请求未污染数据库（settings.updated_at 仍为上次成功推送值）',
    rowOf(`SELECT updated_at FROM user_settings WHERE user_id = '${uidA}'`)?.updated_at === at(251) &&
      (rowOf(`SELECT COUNT(*) AS n FROM pomodoro_daily WHERE user_id = '${uidA}'`)?.n ?? -1) === 1
  )

  console.log('[用例 28：english 四表 NOT NULL 必填字段缺失 → 400（前置校验，非 SQLite 约束 500）]')
  const engMissing = async (key, value) =>
    (await push(tokenA, { english: { upserts: [wrap(key, value, at(280))], deletes: [] } })).data?.message
  // 各表 NOT NULL 列见 worker/schema.sql：vocab_records(date/new_words/review_words)、reading_records(date/wpm/accuracy)、
  // listening_records(date/minutes/material/mode)、essay_templates(title/content)
  const msgVocab = await engMissing('vocab:vm1', { id: 'vm1', date: '2026-09-10', newWords: 1 })
  check(
    'vocab 缺 reviewWords → 400 中文提示（明确缺哪个字段）',
    typeof msgVocab === 'string' && /缺少必填字段 reviewWords/.test(msgVocab),
    String(msgVocab)
  )
  const msgReading = await engMissing('reading:rm1', { id: 'rm1', date: '2026-09-10', wpm: 100 })
  check(
    'reading 缺 accuracy → 400 中文提示',
    typeof msgReading === 'string' && /缺少必填字段 accuracy/.test(msgReading),
    String(msgReading)
  )
  const msgListening = await engMissing('listening:lm1', {
    id: 'lm1',
    date: '2026-09-10',
    minutes: 10,
    material: 'VOA'
  })
  check(
    'listening 缺 mode → 400 中文提示',
    typeof msgListening === 'string' && /缺少必填字段 mode/.test(msgListening),
    String(msgListening)
  )
  const msgTemplate = await engMissing('template:tm1', { id: 'tm1', title: '题目' })
  check(
    'template 缺 content → 400 中文提示',
    typeof msgTemplate === 'string' && /缺少必填字段 content/.test(msgTemplate),
    String(msgTemplate)
  )
  check('必填字段缺失请求未落库', countIn('vocab_records', 'vm1') === 0 && countIn('essay_templates', 'tm1') === 0)

  console.log('[用例 29：跨记录隔离护栏（推送/删除一条记录不影响同域其它记录）]')
  // habits：先落 hb2（含打卡），再推送 hb1 的打卡变更 —— hb2 的打卡行数与值必须完全不变
  const t29 = at(290)
  const hb2Value = {
    id: 'hb2',
    name: '跑步',
    type: 'count',
    target: 3,
    bad: false,
    records: { '2026-09-11': 2 },
    checkins: { '2026-09-12': 1 }
  }
  const pHb2 = await push(tokenA, { habits: { upserts: [wrap('hb2', hb2Value, t29)], deletes: [] } })
  check('hb2 首推生效', pHb2.data?.applied?.habits === 1, JSON.stringify(pHb2.data))
  const hb2Before = d1Rows(
    `SELECT date, value, checkin FROM habit_records WHERE user_id = '${uidA}' AND habit_id = 'hb2' ORDER BY date`
  )
  check('hb2 打卡表落库 2 行', hb2Before.length === 2, JSON.stringify(hb2Before))
  await push(tokenA, {
    habits: {
      upserts: [wrap('hb1', { ...habitValue, records: { '2026-09-11': 7 }, checkins: { '2026-09-12': 1 } }, at(291))],
      deletes: []
    }
  })
  const hb2After = d1Rows(
    `SELECT date, value, checkin FROM habit_records WHERE user_id = '${uidA}' AND habit_id = 'hb2' ORDER BY date`
  )
  check(
    '推送 hb1（含打卡变更）后 hb2 的行数与值完全不变（按习惯重建未越界）',
    JSON.stringify(hb2After) === JSON.stringify(hb2Before),
    `${JSON.stringify(hb2Before)} → ${JSON.stringify(hb2After)}`
  )
  // subjects：先落科目 A/B，再删除科目 A —— 科目 B 的 chapters/topics 行数与内容必须完全不变
  const t29s = at(292)
  const sjA29 = {
    id: 'sjA29',
    name: '语文',
    icon: 'book',
    color: '#ff0000',
    chapters: [{ id: 'chA29', name: '第一章', topics: ['古诗', '文言文'] }],
    mastery: { 古诗: 2 },
    topicImportance: { 古诗: 'important' }
  }
  const sjB29 = {
    id: 'sjB29',
    name: '英语',
    icon: 'book',
    color: '#00ff00',
    chapters: [{ id: 'chB29', name: 'Unit 1', topics: ['grammar'] }],
    mastery: {},
    topicImportance: {}
  }
  const pSub29 = await push(tokenA, {
    subjects: { upserts: [wrap('sjA29', sjA29, t29s), wrap('sjB29', sjB29, t29s)], deletes: [] }
  })
  check('sjA29/sjB29 同批推送生效（applied=2）', pSub29.data?.applied?.subjects === 2, JSON.stringify(pSub29.data))
  const bChaptersBefore = d1Rows(
    `SELECT id, name FROM chapters WHERE user_id = '${uidA}' AND subject_id = 'sjB29' ORDER BY id`
  )
  const bTopicsBefore = d1Rows(
    `SELECT id, name FROM topics WHERE user_id = '${uidA}' AND chapter_id = 'chB29' ORDER BY id`
  )
  check(
    '科目 B 子树落库（1 章节 + 1 知识点）',
    bChaptersBefore.length === 1 && bTopicsBefore.length === 1,
    JSON.stringify({ bChaptersBefore, bTopicsBefore })
  )
  await push(tokenA, { subjects: { upserts: [], deletes: [{ key: 'sjA29', deletedAt: at(293) }] } })
  const bChaptersAfter = d1Rows(
    `SELECT id, name FROM chapters WHERE user_id = '${uidA}' AND subject_id = 'sjB29' ORDER BY id`
  )
  const bTopicsAfter = d1Rows(
    `SELECT id, name FROM topics WHERE user_id = '${uidA}' AND chapter_id = 'chB29' ORDER BY id`
  )
  check(
    '删除科目 A 后科目 B 的 chapters 行数与内容不变',
    JSON.stringify(bChaptersAfter) === JSON.stringify(bChaptersBefore),
    `${JSON.stringify(bChaptersBefore)} → ${JSON.stringify(bChaptersAfter)}`
  )
  check(
    '删除科目 A 后科目 B 的 topics 行数与内容不变',
    JSON.stringify(bTopicsAfter) === JSON.stringify(bTopicsBefore),
    `${JSON.stringify(bTopicsBefore)} → ${JSON.stringify(bTopicsAfter)}`
  )
  check(
    '科目 A 已被删除（其主行清空）',
    (rowOf(`SELECT COUNT(*) AS n FROM subjects WHERE user_id = '${uidA}' AND id = 'sjA29'`)?.n ?? -1) === 0
  )

  console.log('[用例 30：游标契约 —— 游标取「实际返回的最大 seq」，不取 versions（防永久漏数据）]')
  // 用例 A：推送一批 → 游标 0 增量拉，断言该域 seq = 该批实际序号；再用返回的 seq 当游标拉，该域不出现
  const engBase = (await pull(tokenA, { full: true })).data?.versions?.english
  const t30 = at(300)
  const p30 = await push(tokenA, {
    english: {
      upserts: [wrap('vocab:vbseq', { id: 'vbseq', date: '2026-09-10', newWords: 1, reviewWords: 1, points: 0 }, t30)],
      deletes: []
    }
  })
  const engVer = p30.data?.versions?.english
  check('english 推送一批（序号推进 +1）', Number.isInteger(engVer) && engVer === engBase + 1, `${engBase} → ${engVer}`)
  const i30a = await pull(tokenA, { cursors: { english: 0 } })
  const seqA = i30a.data?.changes?.english?.seq
  check(
    '用例A 游标 0 增量拉：changes.english.seq = 本次实际返回的最大 server_seq',
    seqA === engVer,
    JSON.stringify({ seq: seqA, engVer })
  )
  check(
    '用例A versions.english 与 seq 一致（本例无空洞）',
    i30a.data?.versions?.english === seqA,
    JSON.stringify(i30a.data?.versions)
  )
  const i30b = await pull(tokenA, { cursors: { english: seqA } })
  check(
    '用例A 用上一次返回的 seq 当游标：该域不再出现（无重复）',
    !('english' in (i30b.data?.changes ?? {})),
    JSON.stringify(i30b.data?.changes)
  )
  // 用例 B（回归护栏）：模拟「版本号已提交、业务行未提交」的窗口。
  // allocateSeq 是独立提交语句，会先于业务行可见：手工把 english 的 version +1 而不写任何业务行，正是该状态。
  const verBeforeHole = engVer
  d1(`UPDATE sync_domain_versions SET version = version + 1 WHERE user_id = '${uidA}' AND domain = 'english'`)
  const holeVer = rowOf(
    `SELECT version FROM sync_domain_versions WHERE user_id = '${uidA}' AND domain = 'english'`
  )?.version
  check(
    '已把 english 版本抬高 1（空洞号，尚无对应业务行）',
    holeVer === verBeforeHole + 1,
    `${verBeforeHole} → ${holeVer}`
  )
  const i30c = await pull(tokenA, { cursors: { english: verBeforeHole } })
  check(
    '用例B 空洞窗口内增量拉：该域不出现（无内容则不推进游标）',
    !('english' in (i30c.data?.changes ?? {})),
    JSON.stringify(i30c.data?.changes)
  )
  check(
    '用例B 此时 versions.english 已高于实际可读序号（旧契约取 versions 当游标即会永久漏数据）',
    i30c.data?.versions?.english === holeVer && holeVer > verBeforeHole,
    JSON.stringify({ versions: i30c.data?.versions?.english, holeVer })
  )
  // 随后那批业务行真正提交：直接以空洞号作为 server_seq 写入（等价于 allocateSeq 已取号后 batch 才落库）
  d1(
    `INSERT INTO vocab_records (id, user_id, date, new_words, review_words, points, updated_at, server_seq) VALUES ('vbhole', '${uidA}', '2026-09-10', 5, 5, 0, ${at(301)}, ${holeVer})`
  )
  const i30d = await pull(tokenA, { cursors: { english: verBeforeHole } })
  check(
    '用例B 业务行提交后，用修复后的游标（停在空洞号之前）仍能拉到该行',
    (i30d.data?.changes?.english?.upserts ?? []).some((u) => u.key === 'vocab:vbhole') &&
      i30d.data?.changes?.english?.seq === holeVer,
    JSON.stringify(i30d.data?.changes?.english)
  )
  const i30e = await pull(tokenA, { cursors: { english: holeVer } })
  check(
    '回归对照：若（按旧契约）把游标推到空洞号，该行被永久漏掉（证明修复的必要性）',
    !(i30e.data?.changes?.english?.upserts ?? []).some((u) => u.key === 'vocab:vbhole'),
    JSON.stringify(i30e.data?.changes?.english)
  )

  console.log('[用例 31：服务端权威派生 —— 今日学习满 60 分钟 → +3，重复推送不重复发放]')
  // 用户 B 此前没有任何学习记录，学习日期集合完全可控（A 的记录日期为固定造数日期）
  const today8 = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10)
  const dayShift = (date, n) => {
    const d = new Date(`${date}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() + n)
    return d.toISOString().slice(0, 10)
  }
  const recOn = (id, minutes, date, updatedAt) => ({ id, subjectId: 'math', date, minutes, createdAt: 1, updatedAt })
  const bRecCount = (id) =>
    rowOf(`SELECT COUNT(*) AS n FROM study_records WHERE user_id = '${uidB}' AND id = '${id}'`)?.n ?? -1
  const studyMinutesRef = `srv:study-minutes:${today8}`
  const t31 = at(400)
  const p31 = await push(tokenB, { records: { upserts: [recOn('b60', 60, today8, t31)], deletes: [] } })
  check(
    '今日学习 60 分钟 → awarded 含 +3',
    (p31.data?.awarded ?? []).some((a) => a.points === 3 && /60 分钟/.test(a.reason ?? '')),
    JSON.stringify(p31.data?.awarded)
  )
  check(
    'points_log 有 srv:study-minutes:<today>',
    logCount(uidB, studyMinutesRef) === 1,
    `实际 ${logCount(uidB, studyMinutesRef)}`
  )
  const pointsAfter31 = p31.data?.gamification?.points
  check('快照 points 与 SUM(log) 一致', pointsConsistent(uidB).ok, JSON.stringify(pointsConsistent(uidB)))
  // 再推一条今日记录（累计 90 分钟）+ 重放已生效的那条（同 updatedAt → 判负）：均不得重复发放
  const p31b = await push(tokenB, {
    records: { upserts: [recOn('b60', 60, today8, t31), recOn('b30', 30, today8, at(401))], deletes: [] }
  })
  check(
    '已跨过阈值再推送/重放 → awarded 为空（ref_id 幂等）',
    (p31b.data?.awarded ?? []).length === 0,
    JSON.stringify(p31b.data?.awarded)
  )
  check(
    'srv:study-minutes 流水仍只有 1 行且 points 未二次增加',
    logCount(uidB, studyMinutesRef) === 1 && p31b.data?.gamification?.points === pointsAfter31,
    `${logCount(uidB, studyMinutesRef)} 行 / ${pointsAfter31} → ${p31b.data?.gamification?.points}`
  )

  console.log('[用例 32：streak 连续 7 天 → +5 + 里程碑徽章，且积分与徽章同批提交]')
  const t32 = at(410)
  const streakDays = [1, 2, 3, 4, 5, 6].map((n) => dayShift(today8, -n))
  const p32 = await push(tokenB, {
    records: { upserts: streakDays.map((d, i) => recOn(`bs${i}`, 10, d, t32 + i)), deletes: [] }
  })
  check(
    '补齐 today-6…today-1 → gamification.streak === 7',
    p32.data?.gamification?.streak === 7,
    JSON.stringify(p32.data?.gamification)
  )
  check(
    'last_checkin = 最新学习日（今日）',
    p32.data?.gamification?.lastCheckin === today8,
    JSON.stringify(p32.data?.gamification)
  )
  check(
    'awarded 含里程碑 +5',
    (p32.data?.awarded ?? []).some((a) => a.points === 5 && /7 天/.test(a.reason ?? '')),
    JSON.stringify(p32.data?.awarded)
  )
  check('points_log 有 srv:streak:7', logCount(uidB, 'srv:streak:7') === 1, `实际 ${logCount(uidB, 'srv:streak:7')}`)
  check(
    '徽章与积分同批提交（同一请求后 user_badges 与 points_log 都已存在）',
    !!rowOf(`SELECT 1 AS x FROM user_badges WHERE user_id = '${uidB}' AND badge_key = 'streak_7'`) &&
      logCount(uidB, 'srv:streak:7') === 1,
    JSON.stringify(rowOf(`SELECT badge_key FROM user_badges WHERE user_id = '${uidB}'`))
  )
  check('快照 points 与 SUM(log) 一致', pointsConsistent(uidB).ok, JSON.stringify(pointsConsistent(uidB)))

  console.log('[用例 33：客户端事件撤销（refId 精确 / refPrefix 前缀），points 按 SUM 重算]')
  const p33a = await push(
    tokenB,
    {},
    {
      points: [
        { op: 'award', refId: 'bref1', points: 6, reason: '撤销用例', date: today8 },
        { op: 'award', refId: 'habit:bh1:2026-01-01', points: 2, reason: '习惯打卡', date: '2026-01-01' },
        { op: 'award', refId: 'habit:bh1:2026-01-02', points: 2, reason: '习惯打卡', date: '2026-01-02' },
        { op: 'award', refId: 'habit:bh2:2026-01-01', points: 2, reason: '习惯打卡', date: '2026-01-01' }
      ]
    }
  )
  check('四条 award 事件同批落账', (p33a.data?.awarded ?? []).length === 4, JSON.stringify(p33a.data?.awarded))
  const pointsAfter33a = p33a.data?.gamification?.points
  const p33b = await push(tokenB, {}, { points: [{ op: 'revoke', refId: 'bref1' }] })
  check('revoke refId → 精确删除该流水', logCount(uidB, 'bref1') === 0, `实际 ${logCount(uidB, 'bref1')}`)
  check(
    'points 重算（= SUM(log)，减少 6）',
    p33b.data?.gamification?.points === pointsAfter33a - 6 && pointsConsistent(uidB).ok,
    `${pointsAfter33a} → ${p33b.data?.gamification?.points} / ${JSON.stringify(pointsConsistent(uidB))}`
  )
  const p33c = await push(tokenB, {}, { points: [{ op: 'revoke', refPrefix: 'habit:bh1:' }] })
  check(
    'revoke refPrefix → 该前缀 2 行删除、前缀外的流水保留',
    logCount(uidB, 'habit:bh1:2026-01-01') === 0 &&
      logCount(uidB, 'habit:bh1:2026-01-02') === 0 &&
      logCount(uidB, 'habit:bh2:2026-01-01') === 1,
    JSON.stringify([
      logCount(uidB, 'habit:bh1:2026-01-01'),
      logCount(uidB, 'habit:bh1:2026-01-02'),
      logCount(uidB, 'habit:bh2:2026-01-01')
    ])
  )
  check(
    'points 再次重算（累计减少 10）且一致',
    p33c.data?.gamification?.points === pointsAfter33a - 10 && pointsConsistent(uidB).ok,
    `${pointsAfter33a} → ${p33c.data?.gamification?.points}`
  )
  check(
    '撤销可重复执行（幂等，不报错）',
    (await push(tokenB, {}, { points: [{ op: 'revoke', refPrefix: 'habit:bh1:' }] })).status === 200
  )
  // 离线一次性刷 outbox 的典型场景：同一批里先撤销、后重新发放同一 refId（取消后重新完成打卡）
  const p33d = await push(
    tokenB,
    {},
    {
      points: [
        { op: 'revoke', refId: 'habit:bh2:2026-01-01' },
        { op: 'award', refId: 'habit:bh2:2026-01-01', points: 5, reason: '重新完成打卡', date: '2026-01-01' }
      ]
    }
  )
  check(
    '同批撤销 + 发放同一 refId → 以本次发放为准（旧 2 分删除、新 5 分落账）',
    logCount(uidB, 'habit:bh2:2026-01-01') === 1 &&
      (p33d.data?.awarded ?? []).some((a) => a.points === 5) &&
      p33d.data?.gamification?.points === pointsAfter33a - 10 - 2 + 5 &&
      pointsConsistent(uidB).ok,
    `${JSON.stringify(p33d.data?.awarded)} points=${p33d.data?.gamification?.points}`
  )

  console.log('[用例 34：记录删除被接受 → 自动撤销关联积分（不依赖客户端 revoke 事件）]')
  const t34 = at(430)
  const p34 = await push(
    tokenB,
    { records: { upserts: [recOn('bdel1', 5, today8, t34)], deletes: [] } },
    { points: [{ op: 'award', refId: 'bdel1', points: 4, reason: '学习记录积分', date: today8 }] }
  )
  check(
    '记录与其关联积分同批写入',
    bRecCount('bdel1') === 1 && logCount(uidB, 'bdel1') === 1,
    `${bRecCount('bdel1')} / ${logCount(uidB, 'bdel1')}`
  )
  const pointsBefore34 = p34.data?.gamification?.points
  const p34b = await push(tokenB, { records: { upserts: [], deletes: [{ key: 'bdel1', deletedAt: at(431) }] } })
  check(
    '删除 records 记录 → 其 ref_id 流水被自动撤销',
    p34b.data?.deletes?.records === 1 && logCount(uidB, 'bdel1') === 0,
    `deletes=${p34b.data?.deletes?.records} 流水=${logCount(uidB, 'bdel1')}`
  )
  check(
    'points 下降 4 且 = SUM(log)',
    p34b.data?.gamification?.points === pointsBefore34 - 4 && pointsConsistent(uidB).ok,
    `${pointsBefore34} → ${p34b.data?.gamification?.points}`
  )
  const p34c = await push(
    tokenB,
    { errorQuestions: { upserts: [errorQuestion('bdelq', t34)], deletes: [] } },
    { points: [{ op: 'award', refId: 'error:bdelq', points: 2, reason: '复习错题', date: today8 }] }
  )
  check(
    '错题与其 error:<id> 积分同批写入',
    logCount(uidB, 'error:bdelq') === 1,
    `实际 ${logCount(uidB, 'error:bdelq')}`
  )
  const pointsBefore34c = p34c.data?.gamification?.points
  const p34d = await push(tokenB, { errorQuestions: { upserts: [], deletes: [{ key: 'bdelq', deletedAt: at(432) }] } })
  check(
    '删除 errorQuestions 记录 → error:<id> 流水被自动撤销',
    p34d.data?.deletes?.errorQuestions === 1 && logCount(uidB, 'error:bdelq') === 0,
    `deletes=${p34d.data?.deletes?.errorQuestions} 流水=${logCount(uidB, 'error:bdelq')}`
  )
  check(
    'points 再下降 2 且 = SUM(log)',
    p34d.data?.gamification?.points === pointsBefore34c - 2 && pointsConsistent(uidB).ok
  )

  console.log('[用例 35：删除驱动的孤儿清理（PDF 分片 / 错题图片 + R2 对象），重复删除幂等]')
  const pdfId = 'bnote1'
  const upPdf = await rawRequest(`/api/pdfs/${pdfId}`, {
    method: 'PUT',
    token: tokenB,
    bytes: Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n'),
    contentType: 'application/pdf'
  })
  check('PDF 上传成功（走现有 /api/pdfs 上传）', upPdf.status === 200, JSON.stringify(upPdf.data))
  const pdfChunks = () =>
    rowOf(`SELECT COUNT(*) AS n FROM pdf_chunks WHERE user_id = '${uidB}' AND pdf_id = '${pdfId}'`)?.n ?? -1
  check('原文分片落库（≥1 行）', pdfChunks() >= 1, `实际 ${pdfChunks()}`)
  const pdfNote = {
    id: 'bnote1',
    subjectId: 'math',
    title: 'PDF 笔记',
    tags: [],
    type: 'pdf',
    bodyUpdatedAt: 0,
    updatedAt: at(440)
  }
  check(
    'PDF 笔记元数据推送成功（正文以 note.id 定位）',
    (await push(tokenB, { notes: { upserts: [pdfNote], deletes: [] } })).data?.applied?.notes === 1
  )
  check('删除前原文可读', (await rawRequest(`/api/pdfs/${pdfId}`, { token: tokenB })).status === 200)
  const d35 = await push(tokenB, { notes: { upserts: [], deletes: [{ key: 'bnote1', deletedAt: at(441) }] } })
  check(
    '删除 notes 记录 → pdf_chunks 分片被清',
    d35.data?.deletes?.notes === 1 && pdfChunks() === 0,
    `deletes=${d35.data?.deletes?.notes} 分片=${pdfChunks()}`
  )
  check('原文读取返回 404', (await rawRequest(`/api/pdfs/${pdfId}`, { token: tokenB })).status === 404)
  const d35b = await push(tokenB, { notes: { upserts: [], deletes: [{ key: 'bnote1', deletedAt: at(442) }] } })
  check('重复删除幂等（再次删除成功且分片仍为空）', d35b.status === 200 && pdfChunks() === 0, `实际 ${pdfChunks()}`)

  // 错题图片：真实上传（服务端内容寻址 id）→ 删除错题 → 归属行 + R2 对象一并清理
  const jpeg = Buffer.from([
    0xff, 0xd8, 0xff, 0xe1, 0x00, 0x10, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 1, 2, 3, 4, 5, 6, 7, 8, 0xff, 0xd9
  ])
  const upImg = await rawRequest('/api/error-images', {
    method: 'POST',
    token: tokenB,
    bytes: jpeg,
    contentType: 'image/jpeg'
  })
  check(
    '图片上传成功（64 位 hex id）',
    upImg.status === 201 && /^[a-f0-9]{64}$/.test(upImg.data?.id ?? ''),
    JSON.stringify(upImg.data)
  )
  const imgId = upImg.data?.id
  check('删除前图片可读', (await rawRequest(`/api/error-images/${imgId}`, { token: tokenB })).status === 200)
  await push(tokenB, {
    errorQuestions: { upserts: [{ ...errorQuestion('bimg1', at(443)), image: `r2:${imgId}` }], deletes: [] }
  })
  check('归属行存在', imgRowCount(uidB) === 1, `实际 ${imgRowCount(uidB)}`)
  const d35c = await push(tokenB, { errorQuestions: { upserts: [], deletes: [{ key: 'bimg1', deletedAt: at(444) }] } })
  check(
    '删除 errorQuestions 记录 → error_images 归属行被清',
    d35c.data?.deletes?.errorQuestions === 1 && imgRowCount(uidB) === 0,
    `deletes=${d35c.data?.deletes?.errorQuestions} 归属行=${imgRowCount(uidB)}`
  )
  check('R2 对象被清（读取 404）', (await rawRequest(`/api/error-images/${imgId}`, { token: tokenB })).status === 404)
  const d35d = await push(tokenB, { errorQuestions: { upserts: [], deletes: [{ key: 'bimg1', deletedAt: at(445) }] } })
  check(
    '重复删除幂等（归属行仍为空、对象仍 404）',
    d35d.status === 200 &&
      imgRowCount(uidB) === 0 &&
      (await rawRequest(`/api/error-images/${imgId}`, { token: tokenB })).status === 404
  )
  // 共享对象护栏：内容寻址下同一 sha256 可能被多条错题引用，仍有引用时不得删除归属行/对象
  const upImg2 = await rawRequest('/api/error-images', {
    method: 'POST',
    token: tokenB,
    bytes: jpeg,
    contentType: 'image/jpeg'
  })
  check(
    '同内容重复上传 → 同一 id 且归属行重建',
    upImg2.data?.id === imgId && imgRowCount(uidB) === 1,
    JSON.stringify(upImg2.data)
  )
  await push(tokenB, {
    errorQuestions: {
      upserts: [
        { ...errorQuestion('bimg2', at(446)), image: `r2:${imgId}` },
        { ...errorQuestion('bimg3', at(447)), image: `r2:${imgId}` }
      ],
      deletes: []
    }
  })
  await push(tokenB, { errorQuestions: { upserts: [], deletes: [{ key: 'bimg2', deletedAt: at(448) }] } })
  check(
    '仍有其它错题引用 → 归属行与对象保留',
    imgRowCount(uidB) === 1 && (await rawRequest(`/api/error-images/${imgId}`, { token: tokenB })).status === 200,
    `归属行=${imgRowCount(uidB)}`
  )
  await push(tokenB, { errorQuestions: { upserts: [], deletes: [{ key: 'bimg3', deletedAt: at(449) }] } })
  check(
    '最后一条引用删除 → 归属行与对象一并清理',
    imgRowCount(uidB) === 0 && (await rawRequest(`/api/error-images/${imgId}`, { token: tokenB })).status === 404,
    `归属行=${imgRowCount(uidB)}`
  )

  console.log('[用例 36：points 事件校验（未知 op / 非正点数 / 缺 refId 与 refPrefix / revoke 同时给两者）→ 400]')
  const badPoints = async (ev) => (await push(tokenB, {}, { points: [ev] })).status
  check('未知 op → 400', (await badPoints({ op: 'banana', refId: 'x', points: 1, reason: 'x' })) === 400)
  check('points 为 0 → 400', (await badPoints({ op: 'award', refId: 'x', points: 0, reason: 'x' })) === 400)
  check('points 为负数 → 400', (await badPoints({ op: 'award', refId: 'x', points: -3, reason: 'x' })) === 400)
  check('points 非整数 → 400', (await badPoints({ op: 'award', refId: 'x', points: 1.5, reason: 'x' })) === 400)
  check('award 缺 refId → 400', (await badPoints({ op: 'award', points: 3, reason: 'x' })) === 400)
  check('revoke 同时缺 refId 与 refPrefix → 400', (await badPoints({ op: 'revoke' })) === 400)
  check(
    'revoke 同时给 refId 与 refPrefix → 400',
    (await badPoints({ op: 'revoke', refId: 'x', refPrefix: 'y:' })) === 400
  )
  const badMsg = await push(tokenB, {}, { points: [{ op: 'banana' }] })
  check('校验文案为中文', /op 只能是 award 或 revoke/.test(badMsg.data?.message ?? ''), String(badMsg.data?.message))
  check('非法 points 事件未落账', logCount(uidB, 'x') === 0, `实际 ${logCount(uidB, 'x')}`)

  console.log('[用例 37：权威投影不变式 gamification.points === SUM(points_log.points)]')
  for (const [label, uid] of [
    ['A', uidA],
    ['B', uidB]
  ]) {
    const c = pointsConsistent(uid)
    check(`用户 ${label}：points(${c.g}) === SUM(log)(${c.s})`, c.ok, JSON.stringify(c))
  }
  check(
    'B 的 streak/last_checkin 反映权威派生结果（7 天 / 今日）',
    rowOf(`SELECT streak, last_checkin FROM gamification WHERE user_id = '${uidB}'`)?.streak === 7 &&
      rowOf(`SELECT last_checkin FROM gamification WHERE user_id = '${uidB}'`)?.last_checkin === today8,
    JSON.stringify(rowOf(`SELECT streak, last_checkin FROM gamification WHERE user_id = '${uidB}'`))
  )

  // T4b 用例 38：成就列表并集（只增不减 + 幂等去重），与记录/积分同一 batch
  console.log('[用例 38：achievements 并集（只增不减、幂等去重、校验非法 → 400）]')
  const achOf = (uid) =>
    JSON.parse(rowOf(`SELECT achievements FROM gamification WHERE user_id = '${uid}'`)?.achievements ?? '[]')
  const achEqual = (uid, expected) => JSON.stringify(achOf(uid)) === JSON.stringify(expected)

  const a38 = await push(tokenB, {}, { achievements: ['first_checkin', 'streak_7'] })
  check(
    '推送两个成就 id → 200 且快照含两者（无 domains/points 也算有变更）',
    a38.status === 200 &&
      JSON.stringify(a38.data?.gamification?.achievements) === JSON.stringify(['first_checkin', 'streak_7']),
    `status=${a38.status} ${JSON.stringify(a38.data?.gamification?.achievements)}`
  )
  check('并集结果落库', achEqual(uidB, ['first_checkin', 'streak_7']), JSON.stringify(achOf(uidB)))

  const a38b = await push(tokenB, {}, { achievements: ['first_checkin', 'streak_7', 'first_checkin'] })
  check(
    '重复推送同一批（含重复项）→ 集合不变、不重复',
    a38b.status === 200 && achEqual(uidB, ['first_checkin', 'streak_7']),
    JSON.stringify(achOf(uidB))
  )

  const a38c = await push(tokenB, {}, { achievements: ['streak_30'] })
  check(
    '再推一个新 id → 追加且旧的不丢（已有在前）',
    a38c.status === 200 &&
      JSON.stringify(a38c.data?.gamification?.achievements) ===
        JSON.stringify(['first_checkin', 'streak_7', 'streak_30']),
    JSON.stringify(a38c.data?.gamification?.achievements)
  )

  const a38d = await push(
    tokenB,
    { todos: { upserts: [todo('bach1', at(460), '同批待办')], deletes: [] } },
    { achievements: ['points_100'] }
  )
  check(
    '与记录变更同批提交 → 成就与记录同时生效',
    a38d.status === 200 &&
      a38d.data?.applied?.todos === 1 &&
      achEqual(uidB, ['first_checkin', 'streak_7', 'streak_30', 'points_100']),
    `applied=${JSON.stringify(a38d.data?.applied)} ${JSON.stringify(achOf(uidB))}`
  )

  check('achievements 非数组 → 400', (await push(tokenB, {}, { achievements: 'x' })).status === 400)
  check('achievements 元素非字符串 → 400', (await push(tokenB, {}, { achievements: ['ok', 1] })).status === 400)
  check('achievements 元素为空字符串 → 400', (await push(tokenB, {}, { achievements: [''] })).status === 400)
  const achOver = await push(tokenB, {}, { achievements: Array.from({ length: 201 }, (_, i) => `a${i}`) })
  check(
    'achievements 去重后超 200 → 400 中文文案',
    achOver.status === 400 && /200/.test(achOver.data?.message ?? ''),
    `status=${achOver.status} ${String(achOver.data?.message)}`
  )
  check(
    '非法 achievements 未改动已有列表',
    achEqual(uidB, ['first_checkin', 'streak_7', 'streak_30', 'points_100']),
    JSON.stringify(achOf(uidB))
  )

  console.log(`\n通过 ${passed} / 失败 ${failed}`)
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
