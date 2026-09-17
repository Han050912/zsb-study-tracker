/**
 * 笔记正文外置集成测试：独立正文通道、LWW、账号隔离、metadata-only sync、墓碑清理、
 * settings 敏感词旁路与旧 REST 写端点关闭。
 *
 * 前置：npx wrangler d1 execute zsb-study-db --local --file=./schema.sql && npx wrangler dev --port 8787
 * 运行：SMOKE_DESKTOP_TOKEN=<DESKTOP_TOKEN> node test/note-bodies.mjs [baseURL]
 */
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { fetchRetry } from './fetch-retry.mjs'

const BASE = process.argv[2] || 'http://localhost:8787'
const ORIGIN = 'http://localhost:5173'
const WORKER_DIR = fileURLToPath(new URL('..', import.meta.url))
const DESKTOP_TOKEN = process.env.SMOKE_DESKTOP_TOKEN || 'zsb-desktop-v2'

function d1Rows(sql) {
  const output = execSync(`npx wrangler d1 execute zsb-study-db --local --json --command "${sql}"`, {
    cwd: WORKER_DIR
  }).toString()
  return JSON.parse(output.slice(output.indexOf('[')))?.[0]?.results ?? []
}

let passed = 0
let failed = 0
function check(name, condition, extra = '') {
  if (condition) {
    passed++
    console.log(`  ✓ ${name}`)
  } else {
    failed++
    console.error(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`)
  }
}

async function jsonApi(path, { method = 'GET', token, body } = {}) {
  const headers = { 'Content-Type': 'application/json', Origin: ORIGIN, 'X-Desktop-Token': DESKTOP_TOKEN }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetchRetry(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  const data = await res.json().catch(() => null)
  return { status: res.status, data }
}

async function putBody(token, id, content, updatedAt) {
  const headers = {
    'Content-Type': 'text/plain; charset=utf-8',
    'X-Updated-At': String(updatedAt),
    Origin: ORIGIN,
    'X-Desktop-Token': DESKTOP_TOKEN
  }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetchRetry(`${BASE}/api/note-bodies/${id}`, { method: 'PUT', headers, body: content })
  const data = await res.json().catch(() => null)
  return { status: res.status, data }
}

const pullBodies = (token, ids) => jsonApi('/api/note-bodies/pull', { method: 'POST', token, body: { ids } })

const push = (token, domains) => jsonApi('/api/data/push', { method: 'POST', token, body: { domains } })
const pull = (token, body) => jsonApi('/api/data/pull', { method: 'POST', token, body })

function note(id, updatedAt, bodyUpdatedAt, title = '正文外置笔记') {
  return { id, subjectId: 'math', title, tags: ['索引'], updatedAt, bodyUpdatedAt }
}

async function main() {
  console.log(`目标: ${BASE}\n`)
  const uniq = Date.now().toString(36)
  const regA = await jsonApi('/api/auth/register', {
    method: 'POST',
    body: { username: `bodya_${uniq}`, password: 'password123' }
  })
  const regB = await jsonApi('/api/auth/register', {
    method: 'POST',
    body: { username: `bodyb_${uniq}`, password: 'password123' }
  })
  check('注册用户 A', regA.status === 201 && !!regA.data?.token, JSON.stringify(regA.data))
  check('注册用户 B', regB.status === 201 && !!regB.data?.token, JSON.stringify(regB.data))
  const tokenA = regA.data?.token
  const tokenB = regB.data?.token
  const userAId = regA.data?.user?.id
  const userBId = regB.data?.user?.id

  console.log('[正文 API 校验]')
  check('未认证 PUT 返回 401', (await putBody(null, 'note1', 'x', Date.now())).status === 401)
  check('非法 note id 返回 400', (await putBody(tokenA, 'bad!id', 'x', Date.now())).status === 400)
  check('空正文允许保存', (await putBody(tokenA, 'empty', '', Date.now())).status === 200)
  check('超过 1MB 返回 413', (await putBody(tokenA, 'too-big', 'a'.repeat(1024 * 1024 + 1), Date.now())).status === 413)
  const tooMany = Array.from({ length: 51 }, (_, i) => `n${i}`)
  check('批量拉取超过 50 个 id 返回 413', (await pullBodies(tokenA, tooMany)).status === 413)

  console.log('[分片 / LWW / 隔离]')
  const id = `n-${uniq}`
  const v1 = Date.now() - 20_000
  const content1 = `# 标题\n${'跨分片中文正文。'.repeat(9000)}`
  const firstPut = await putBody(tokenA, id, content1, v1)
  check('首次正文 PUT 成功', firstPut.status === 200 && firstPut.data?.applied === true, JSON.stringify(firstPut.data))
  const notePush = await push(tokenA, { notes: { upserts: [note(id, v1, v1)], deletes: [] } })
  check('metadata-only note push 成功', notePush.status === 200 && notePush.data?.applied?.notes === 1)
  const ownPull = await pullBodies(tokenA, [id])
  check(
    '多分片 UTF-8 正文完整重组',
    ownPull.status === 200 &&
      ownPull.data?.bodies?.[0]?.content === content1 &&
      ownPull.data?.bodies?.[0]?.updatedAt === v1
  )
  check('其他用户猜 id 不可读', (await pullBodies(tokenB, [id])).data?.bodies?.length === 0)

  const replay = await putBody(tokenA, id, content1, v1)
  check('相同版本重放幂等', replay.status === 200 && replay.data?.applied === false && replay.data?.updatedAt === v1)
  const older = await putBody(tokenA, id, '旧正文', v1 - 1)
  check('旧版本正文被拒', older.status === 200 && older.data?.applied === false && older.data?.updatedAt === v1)
  const v2 = v1 + 1000
  check('新版本正文覆盖成功', (await putBody(tokenA, id, '新正文', v2)).data?.applied === true)
  check('覆盖后只返回新正文', (await pullBodies(tokenA, [id])).data?.bodies?.[0]?.content === '新正文')

  const future = Date.now() + 10 * 60_000
  const clamped = await putBody(tokenA, id, '快时钟正文', future)
  check(
    '快时钟被钳制并返回有效版本',
    clamped.status === 200 && clamped.data?.clamped === true && clamped.data?.updatedAt < future,
    JSON.stringify(clamped.data)
  )

  console.log('[记录同步载荷与删除清理]')
  const full = await pull(tokenA, { full: true })
  const synced = full.data?.changes?.notes?.upserts?.find((n) => n.id === id)
  check('pull 中笔记含 bodyUpdatedAt', typeof synced?.bodyUpdatedAt === 'number')
  check('pull 中笔记不含 content 字段', synced && !Object.prototype.hasOwnProperty.call(synced, 'content'))
  const deleteAt = Date.now()
  const removed = await push(tokenA, { notes: { upserts: [], deletes: [{ key: id, deletedAt: deleteAt }] } })
  check('笔记墓碑被接受', removed.status === 200 && removed.data?.deletes?.notes === 1)
  check(
    '墓碑同步删除正文分片',
    d1Rows(`SELECT * FROM note_body_chunks WHERE user_id = '${userAId}' AND note_id = '${id}'`).length === 0
  )
  check('删除后正文 pull 为空', (await pullBodies(tokenA, [id])).data?.bodies?.length === 0)

  console.log('[搭子分享与独立复制]')
  const shareNoteId = `share-${uniq}`
  const shareContent = '# 分享正文\n复制后仍应完整可读'
  const shareAt = Date.now()
  await putBody(tokenA, shareNoteId, shareContent, shareAt)
  await push(tokenA, { notes: { upserts: [note(shareNoteId, shareAt, shareAt, '分享笔记')], deletes: [] } })
  const pairKey = [userAId, userBId].sort().join(':')
  d1Rows(`UPDATE user_settings SET partner_share_enabled = 1 WHERE user_id = '${userAId}'`)
  d1Rows(
    `INSERT OR REPLACE INTO study_partners (id, pair_key, from_id, to_id, status, created_at, updated_at) VALUES ('rel-${uniq}', '${pairKey}', '${userAId}', '${userBId}', 'accepted', 1, 1)`
  )
  const shared = await jsonApi('/api/partner-shares', {
    method: 'POST',
    token: tokenA,
    body: { partnerId: userBId, itemType: 'note', itemId: shareNoteId }
  })
  check('Markdown 笔记可分享', shared.status === 201 && !!shared.data?.id, JSON.stringify(shared.data))
  const detail = await jsonApi(`/api/partner-shares/${shared.data?.id}`, { token: tokenB })
  check('分享详情从外置分片重组正文', detail.status === 200 && detail.data?.item?.content === shareContent)
  const copied = await jsonApi(`/api/partner-shares/${shared.data?.id}/copy`, {
    method: 'POST',
    token: tokenB,
    body: { subjectId: 'math' }
  })
  check(
    '复制返回新 id、正文与 bodyUpdatedAt',
    copied.status === 201 &&
      copied.data?.id !== shareNoteId &&
      copied.data?.content === shareContent &&
      copied.data?.bodyUpdatedAt > 0,
    JSON.stringify(copied.data)
  )
  const copiedId = copied.data?.id
  const copiedPull = await pull(tokenB, { cursors: { notes: 0 } })
  check(
    '服务端复制的 notes 行有序号、增量可见',
    (copiedPull.data?.changes?.notes?.upserts ?? []).some((item) => item.id === copiedId)
  )
  check(
    '复制后的正文归接收者独立读取',
    (await pullBodies(tokenB, [copiedId])).data?.bodies?.[0]?.content === shareContent
  )

  console.log('[settings 校验旁路]')
  const beforeSettings = await jsonApi('/api/settings', { token: tokenA })
  const badSettings = await push(tokenA, {
    settings: {
      upserts: [{ key: 'self', value: { ...beforeSettings.data, userName: '代考服务' }, updatedAt: Date.now() }],
      deletes: []
    },
    todos: {
      upserts: [
        { id: `atomic-${uniq}`, date: '2026-09-12', text: '不应落库', done: false, order: 0, updatedAt: Date.now() }
      ],
      deletes: []
    }
  })
  check('sync settings 敏感词返回 400', badSettings.status === 400)
  check(
    'settings 非法时同批 todo 不落库',
    d1Rows(`SELECT id FROM todos WHERE user_id = '${userAId}' AND id = 'atomic-${uniq}'`).length === 0
  )
  const validOnly = await jsonApi('/api/settings/validate', {
    method: 'POST',
    token: tokenA,
    body: { userName: '  正常昵称  ', bio: '  正常简介  ' }
  })
  check(
    'settings validation-only 返回归一化值',
    validOnly.status === 200 && validOnly.data?.userName === '正常昵称' && validOnly.data?.bio === '正常简介'
  )
  const afterSettings = await jsonApi('/api/settings', { token: tokenA })
  check('validation-only 不写设置', afterSettings.data?.userName === beforeSettings.data?.userName)

  console.log('[旧 REST 写端点关闭]')
  for (const path of [
    '/api/records',
    '/api/todos',
    '/api/errors',
    '/api/exams',
    '/api/notes',
    '/api/materials',
    '/api/problems',
    '/api/vocab',
    '/api/reading',
    '/api/listening',
    '/api/templates'
  ]) {
    const res = await jsonApi(path, { method: 'POST', token: tokenA, body: {} })
    check(
      `POST ${path} 不再可写`,
      res.status === 404 || res.status === 405,
      `${res.status} ${JSON.stringify(res.data)}`
    )
  }
  check(
    'PUT /api/pomodoro 不再可写',
    [404, 405].includes((await jsonApi('/api/pomodoro', { method: 'PUT', token: tokenA, body: {} })).status)
  )
  check(
    'PUT /api/summaries/:date 不再可写',
    [404, 405].includes((await jsonApi('/api/summaries/2026-09-12', { method: 'PUT', token: tokenA, body: {} })).status)
  )
  check(
    'PUT /api/settings 不再可写',
    [404, 405].includes((await jsonApi('/api/settings', { method: 'PUT', token: tokenA, body: {} })).status)
  )

  console.log(`\n结果: ${passed} passed, ${failed} failed`)
  if (failed) process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
