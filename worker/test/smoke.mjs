/**
 * zsb-study-api 冒烟测试（Node 18+ 原生 fetch，无测试框架）。
 * 前置：npx wrangler d1 execute zsb-study-db --local --file=./schema.sql && npx wrangler dev
 * 运行：node test/smoke.mjs [baseURL]（默认 http://localhost:8787）
 */

import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const BASE = process.argv[2] || 'http://localhost:8787'
const ORIGIN = 'http://localhost:5173'
const WORKER_DIR = fileURLToPath(new URL('..', import.meta.url))

/** 直接操作本地 D1（管理员提升/留痕校验），与线上运营方式一致 */
function d1(sql) {
  return execSync(`npx wrangler d1 execute zsb-study-db --local --json --command "${sql}"`, { cwd: WORKER_DIR }).toString()
}

let passed = 0
let failed = 0

function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.error(`  ✗ ${name}${extra ? ' — ' + extra : ''}`) }
}

async function api(path, { method = 'GET', token, body } = {}) {
  // 本地冒烟无人机验证环节，与桌面端一样通过共享令牌跳过 Turnstile
  const headers = { 'Content-Type': 'application/json', Origin: ORIGIN, 'X-Desktop-Token': 'zsb-desktop-v2' }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(`${BASE}${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body)
  })
  let data = null
  try { data = await res.json() } catch { /* 204 等无 body */ }
  return { status: res.status, data, headers: res.headers }
}

const uniq = Date.now().toString(36)
const userA = { username: `smoke_a_${uniq}`, password: 'password123' }
const userB = { username: `smoke_b_${uniq}`, password: 'password123' }

// 构建一份覆盖全部实体的 AppState 快照
function sampleState() {
  return {
    subjects: [{
      id: 'math', name: '高等数学', icon: '📐', color: '#3b82f6', weight: 50, builtin: true,
      chapters: [{ id: 'm1', name: '第一章 函数与极限', topics: ['函数及其性质', '数列极限'] }],
      mastery: { '函数及其性质': 4 }, topicImportance: { '函数及其性质': 'must' }
    }],
    records: [{ id: 'r1', subjectId: 'math', date: '2026-08-04', minutes: 60, chapterId: 'm1', topic: '数列极限', note: 'n', createdAt: 1 }],
    problemSessions: [{ id: 'p1', subjectId: 'math', date: '2026-08-04', total: 20, correct: 15, types: { choice: 10, blank: 10 } }],
    errorQuestions: [{ id: 'e1', subjectId: 'math', date: '2026-08-04', chapter: '第一章', type: '选择', content: '题面', answer: 'A', image: 'data:image/png;base64,xx', reviewCount: 2, mastered: false, createdAt: 1 }],
    exams: [{ id: 'x1', subjectId: 'math', date: '2026-08-04', title: '2025 真题', score: 80, totalScore: 100, minutes: 120, parts: { 选择: 40 } }],
    notes: [{ id: 'n1', subjectId: 'math', title: '极限笔记', content: '# md', tags: ['极限'], updatedAt: 1 }],
    english: {
      vocab: [{ id: 'v1', date: '2026-08-04', newWords: 30, reviewWords: 20, points: 3 }],
      reading: [{ id: 'rd1', date: '2026-08-04', wpm: 120, accuracy: 0.8 }],
      listening: [{ id: 'l1', date: '2026-08-04', minutes: 30, material: 'VOA', mode: '精听' }],
      templates: [{ id: 't1', title: '议论文模板', content: 'As is known...', level: 2, category: '议论文' }]
    },
    summaries: { '2026-08-04': { date: '2026-08-04', mood: '😄 开心', harvest: 'h', improve: 'i', plan: 'p' } },
    habits: [{
      id: 'h1', name: '早起晨读', type: 'checkbox', target: undefined, bad: false,
      records: { '2026-08-04': 1 }, checkins: {}
    }, {
      id: 'h5', name: '熬夜', type: 'count', bad: true,
      records: { '2026-08-03': 2 }, checkins: { '2026-08-04': 1 }
    }],
    materials: [{ id: 'mt1', title: '高数讲义', type: 'doc', subjectId: 'math', priority: '高', author: '张', totalPages: 300, readPages: 50, notes: 'n', createdAt: 1 }],
    gamification: {
      points: 100, streak: 5, lastCheckin: '2026-08-04', achievements: ['first_checkin'],
      pointsLog: [{ date: '2026-08-04', points: 10, reason: '每日打卡', refId: 'r1' }]
    },
    pomodoro: {
      daily: { '2026-08-04': { count: 3, minutes: 75, interruptions: 1 } },
      interruptions: [{ date: '2026-08-04', reason: '手机', time: 1754300000000 }]
    },
    todos: [{ id: 'td1', date: '2026-08-04', text: '复习极限', done: true, order: 1, completedAt: 1754300000000 }],
    settings: {
      userName: '测试员', dailyGoalMinutes: 300, wordGoal: 60, problemGoal: 40, examDate: '2027-04-01',
      theme: 'dark', reminderEnabled: true, reminderTime: '07:30', quotes: ['自定义引言'],
      maimemoToken: undefined, onboarded: true
    }
  }
}

async function main() {
  console.log(`目标: ${BASE}\n`)

  // ---- CORS ----
  console.log('[CORS]')
  const preflight = await fetch(`${BASE}/api/records`, {
    method: 'OPTIONS',
    headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'Authorization' }
  })
  check('OPTIONS 预检返回 204', preflight.status === 204, `实际 ${preflight.status}`)
  check('预检响应带 Access-Control-Allow-Origin', preflight.headers.get('access-control-allow-origin') === ORIGIN)
  check('预检响应允许 Authorization 头', (preflight.headers.get('access-control-allow-headers') || '').includes('Authorization'))

  // ---- 认证 ----
  console.log('[认证]')
  const regA = await api('/api/auth/register', { method: 'POST', body: userA })
  check('注册 A 返回 201 + token', regA.status === 201 && !!regA.data?.token, JSON.stringify(regA.data))
  check('注册即初始化 settings（GET /api/settings 有默认值）',
    (await api('/api/settings', { token: regA.data.token })).data?.userName === '升本人')

  const regDup = await api('/api/auth/register', { method: 'POST', body: userA })
  check('重复注册返回 409', regDup.status === 409, `实际 ${regDup.status}`)

  const badLogin = await api('/api/auth/login', { method: 'POST', body: { username: userA.username, password: 'wrong-password' } })
  check('错误密码登录返回 401', badLogin.status === 401, `实际 ${badLogin.status}`)

  const loginA = await api('/api/auth/login', { method: 'POST', body: userA })
  check('登录返回 token + user', loginA.status === 200 && !!loginA.data?.token && loginA.data?.user?.username === userA.username)
  const tokenA = loginA.data.token

  const me = await api('/api/auth/me', { token: tokenA })
  check('GET /api/auth/me 返回当前用户', me.status === 200 && me.data?.user?.username === userA.username)

  const regB = await api('/api/auth/register', { method: 'POST', body: userB })
  const tokenB = regB.data?.token

  // ---- 未认证拦截 ----
  console.log('[未认证]')
  const noAuth = await api('/api/records')
  check('无 token 访问数据接口返回 401', noAuth.status === 401, `实际 ${noAuth.status}`)
  const badAuth = await api('/api/records', { token: 'invalid.token.here' })
  check('伪造 token 返回 401', badAuth.status === 401, `实际 ${badAuth.status}`)

  // ---- 单实体 CRUD（以 records 为例） ----
  console.log('[CRUD /api/records]')
  const created = await api('/api/records', {
    method: 'POST', token: tokenA,
    body: { subjectId: 'math', date: '2026-08-01', minutes: 45, topic: '导数', createdAt: 1 }
  })
  check('POST 创建返回 201 + 记录', created.status === 201 && !!created.data?.id, JSON.stringify(created.data))
  const rid = created.data.id
  const listed = await api('/api/records', { token: tokenA })
  check('GET 列表包含新记录', listed.data?.some(r => r.id === rid && r.topic === '导数'))
  const updated = await api(`/api/records/${rid}`, {
    method: 'PUT', token: tokenA,
    body: { subjectId: 'math', date: '2026-08-01', minutes: 90, topic: '导数', createdAt: 1 }
  })
  check('PUT 更新生效', updated.status === 200 && updated.data?.minutes === 90)
  const notMine = await api(`/api/records/${rid}`, { method: 'PUT', token: tokenB, body: { minutes: 1 } })
  check('B 用户更新 A 的记录返回 404', notMine.status === 404, `实际 ${notMine.status}`)
  const del = await api(`/api/records/${rid}`, { method: 'DELETE', token: tokenA })
  check('DELETE 删除成功', del.status === 200)
  check('删除后列表为空', (await api('/api/records', { token: tokenA })).data?.length === 0)

  // ---- 科目树 CRUD + 级联删除 ----
  console.log('[CRUD /api/subjects]')
  const subj = await api('/api/subjects', {
    method: 'POST', token: tokenA,
    body: { name: '计算机', icon: '💻', color: '#f59e0b', weight: 30, builtin: false,
            chapters: [{ id: 'c1', name: '第一章', topics: ['数据结构'] }],
            mastery: { '数据结构': 3 }, topicImportance: { '数据结构': 'important' } }
  })
  check('POST 创建科目（整树）', subj.status === 201 && !!subj.data?.id, JSON.stringify(subj.data))
  const sid = subj.data.id
  const tree = await api('/api/subjects', { token: tokenA })
  const found = tree.data?.find(s => s.id === sid)
  check('GET 科目树组装 chapters/topics/mastery',
    found?.chapters?.[0]?.topics?.[0] === '数据结构' && found?.mastery?.['数据结构'] === 3 && found?.topicImportance?.['数据结构'] === 'important')
  await api('/api/records', { method: 'POST', token: tokenA, body: { subjectId: sid, date: '2026-08-01', minutes: 10, createdAt: 1 } })
  const delSubj = await api(`/api/subjects/${sid}`, { method: 'DELETE', token: tokenA })
  check('DELETE 科目成功', delSubj.status === 200)
  check('级联删除该科目学习记录', (await api('/api/records', { token: tokenA })).data?.length === 0)

  // ---- 全量同步 ----
  console.log('[全量同步 /api/data/sync]')
  const snapshot = sampleState()
  const push = await api('/api/data/sync', { method: 'POST', token: tokenA, body: snapshot })
  check('POST 全量推送成功', push.status === 200, JSON.stringify(push.data))
  const pull = await api('/api/data/sync', { token: tokenA })
  check('GET 全量拉取成功', pull.status === 200 && !!pull.data)

  const d = pull.data
  check('subjects 树还原（chapters/topics/mastery/topicImportance）',
    d.subjects?.[0]?.chapters?.[0]?.topics?.length === 2 &&
    d.subjects[0].mastery['函数及其性质'] === 4 &&
    d.subjects[0].topicImportance['函数及其性质'] === 'must' &&
    d.subjects[0].builtin === true)
  check('records 还原（camelCase + 可选字段）', d.records?.[0]?.subjectId === 'math' && d.records[0].chapterId === 'm1')
  check('problemSessions.types JSON 还原', d.problemSessions?.[0]?.types?.choice === 10)
  check('errorQuestions 还原（base64 图片 + mastered 布尔）', d.errorQuestions?.[0]?.image?.startsWith('data:image') && d.errorQuestions[0].mastered === false)
  check('exams.parts JSON 还原', d.exams?.[0]?.parts?.['选择'] === 40)
  check('notes.tags JSON 还原', d.notes?.[0]?.tags?.[0] === '极限')
  check('english 四组数据还原', d.english?.vocab?.[0]?.newWords === 30 && d.english?.reading?.[0]?.wpm === 120 &&
    d.english?.listening?.[0]?.mode === '精听' && d.english?.templates?.[0]?.category === '议论文')
  check('summaries 按键还原', d.summaries?.['2026-08-04']?.mood === '😄 开心')
  check('habits.records 数值还原', d.habits?.find(h => h.id === 'h1')?.records?.['2026-08-04'] === 1)
  check('habits.checkins + bad 还原', d.habits?.find(h => h.id === 'h5')?.checkins?.['2026-08-04'] === 1 &&
    d.habits.find(h => h.id === 'h5').bad === true)
  check('materials 可选字段还原', d.materials?.[0]?.fileName === undefined && d.materials[0].totalPages === 300)
  check('gamification + pointsLog 还原', d.gamification?.points === 100 && d.gamification?.pointsLog?.[0]?.refId === 'r1' &&
    d.gamification?.achievements?.[0] === 'first_checkin')
  check('pomodoro 还原', d.pomodoro?.daily?.['2026-08-04']?.count === 3 && d.pomodoro?.interruptions?.[0]?.reason === '手机')
  check('todos 还原（done/order/completedAt）', d.todos?.[0]?.done === true && d.todos[0].order === 1 && d.todos[0].completedAt === 1754300000000)
  check('settings + quotes 还原', d.settings?.userName === '测试员' && d.settings?.quotes?.[0] === '自定义引言' &&
    d.settings?.reminderEnabled === true && d.settings?.onboarded === true)

  // 二次推送（覆盖语义）：清空 records 后应同步为空
  snapshot.records = []
  await api('/api/data/sync', { method: 'POST', token: tokenA, body: snapshot })
  check('二次推送为整体替换语义', (await api('/api/data/sync', { token: tokenA })).data?.records?.length === 0)

  // ---- 跨用户数据隔离 ----
  console.log('[数据隔离]')
  const pullB = await api('/api/data/sync', { token: tokenB })
  check('B 用户拉取不到 A 的科目', (pullB.data?.subjects ?? []).length === 0)
  check('B 用户拉取不到 A 的笔记', (pullB.data?.notes ?? []).length === 0)
  check('B 用户游戏化为默认值', pullB.data?.gamification?.points === 0)
  const bSettings = await api('/api/settings', { token: tokenB })
  check('B 用户设置为默认值（不受 A 影响）', bSettings.data?.userName === '升本人')

  // 多租户 id 复用：B 推送与 A 完全相同 id 的快照应成功（复合主键 user_id+id）
  const pushB = await api('/api/data/sync', { method: 'POST', token: tokenB, body: sampleState() })
  check('B 推送相同 id 的数据不冲突', pushB.status === 200, JSON.stringify(pushB.data))
  const pullB2 = await api('/api/data/sync', { token: tokenB })
  check('B 拉取到自己的数据（id 与 A 相同但互不影响）', pullB2.data?.subjects?.[0]?.id === 'math' && pullB2.data?.notes?.length === 1)
  const pullA2 = await api('/api/data/sync', { token: tokenA })
  check('A 的数据未被 B 覆盖', pullA2.data?.notes?.length === 1 && pullA2.data?.records?.length === 0)

  // C1 回归：B 推送与 A 相同章节 id（'m1'）但不同知识点名称，A 的 topics/mastery 必须不受影响
  const variant = sampleState()
  variant.subjects[0].chapters[0].topics = ['B的知识点']
  variant.subjects[0].mastery = { 'B的知识点': 5 }
  await api('/api/data/sync', { method: 'POST', token: tokenB, body: variant })
  const pullA3 = await api('/api/data/sync', { token: tokenA })
  check('A 的 topics 未被 B 污染（C1 回归）',
    pullA3.data?.subjects?.[0]?.chapters?.[0]?.topics?.join(',') === '函数及其性质,数列极限' &&
    pullA3.data.subjects[0].mastery['函数及其性质'] === 4,
    JSON.stringify(pullA3.data?.subjects?.[0]?.chapters?.[0]?.topics))

  // ---- 其余实体 REST 端点可用性 ----
  console.log('[REST 端点可用性]')
  for (const p of ['/api/problems', '/api/errors', '/api/exams', '/api/notes', '/api/vocab',
    '/api/reading', '/api/listening', '/api/templates', '/api/materials', '/api/todos', '/api/habits', '/api/summaries']) {
    const r = await api(p, { token: tokenA })
    check(`GET ${p} → 200`, r.status === 200, `实际 ${r.status}`)
  }
  check('GET /api/gamification → 200', (await api('/api/gamification', { token: tokenA })).status === 200)
  check('GET /api/pomodoro → 200', (await api('/api/pomodoro', { token: tokenA })).status === 200)
  const sumPut = await api('/api/summaries/2026-08-05', { method: 'PUT', token: tokenA, body: { mood: '🙂 平静', harvest: 'h', improve: 'i', plan: 'p' } })
  check('PUT /api/summaries/:date upsert → 200', sumPut.status === 200 && sumPut.data?.date === '2026-08-05')

  // ---- 墨墨代理（未配置 Token 时） ----
  console.log('[墨墨代理]')
  const mm = await api('/api/proxy/maimemo/today', { method: 'POST', token: tokenA })
  check('未配置墨墨 Token 返回 400 提示', mm.status === 400 && (mm.data?.message || '').includes('墨墨'), JSON.stringify(mm.data))

  // ---- 社区广场 ----
  // 前置：A/B 均已推送 sampleState（gamification.points 各为 100）
  console.log('[社区广场]')
  check('未认证访问社区接口返回 401', (await api('/api/community/posts')).status === 401)

  const post1 = await api('/api/community/posts', {
    method: 'POST', token: tokenA,
    body: { type: 'checkin', content: '今日学习打卡：高数 2 小时', tags: ['#每日打卡', '#高等数学'], refType: 'record', refId: '2026-08-04' }
  })
  check('发帖返回 201 + 作者昵称', post1.status === 201 && post1.data?.userName === '测试员', JSON.stringify(post1.data))
  const postId = post1.data?.id
  // 积分经 /api/data/sync 拉取验证（/api/gamification 有 60s 边缘缓存，写入后短时间会读到旧值）
  const pointsOf = async (token) => (await api('/api/data/sync', { token })).data?.gamification?.points
  check('每日首帖 +5 积分', (await pointsOf(tokenA)) === 105)
  await api('/api/community/posts', { method: 'POST', token: tokenA, body: { type: 'share', content: '当日第二帖', tags: [] } })
  check('当日第二帖不重复加分', (await pointsOf(tokenA)) === 105)
  const emptyPost = await api('/api/community/posts', { method: 'POST', token: tokenA, body: { type: 'share', content: '  ', tags: [] } })
  check('空内容发帖返回 400', emptyPost.status === 400, `实际 ${emptyPost.status}`)

  const feed = await api('/api/community/posts?sort=latest', { token: tokenB })
  check('B 拉取动态流包含 A 的帖子', feed.data?.posts?.some(p => p.id === postId && p.likedByMe === false))
  const tagFeed = await api('/api/community/posts?tag=' + encodeURIComponent('#高等数学'), { token: tokenB })
  check('按标签筛选生效', tagFeed.data?.posts?.length === 1 && tagFeed.data.posts[0].id === postId)
  const page1 = await api('/api/community/posts?limit=1', { token: tokenB })
  const page2 = await api(`/api/community/posts?limit=1&cursor=${encodeURIComponent(page1.data?.nextCursor)}`, { token: tokenB })
  check('游标分页不重复', page1.data?.posts?.[0]?.id !== page2.data?.posts?.[0]?.id && !!page1.data?.nextCursor)

  const like = await api('/api/community/likes', { method: 'POST', token: tokenB, body: { targetType: 'post', targetId: postId } })
  check('B 点赞 A 的帖子', like.data?.liked === true)
  check('被赞 +1 积分', (await pointsOf(tokenA)) === 106)
  const unlike = await api('/api/community/likes', { method: 'POST', token: tokenB, body: { targetType: 'post', targetId: postId } })
  check('再次点赞为取消（toggle）', unlike.data?.liked === false)
  check('取消点赞回收被赞积分', (await pointsOf(tokenA)) === 105)
  await api('/api/community/likes', { method: 'POST', token: tokenB, body: { targetType: 'post', targetId: postId } })

  const c1 = await api(`/api/community/posts/${postId}/comments`, { method: 'POST', token: tokenB, body: { content: '一起加油！' } })
  check('B 评论成功返回 201', c1.status === 201 && !!c1.data?.id, JSON.stringify(c1.data))
  check('评论者 +1 / 作者 +2 积分',
    (await pointsOf(tokenB)) === 101 && (await pointsOf(tokenA)) === 108)
  const c2 = await api(`/api/community/posts/${postId}/comments`, { method: 'POST', token: tokenA, body: { content: '@测试员B 谢谢！', parentId: c1.data.id } })
  check('二级回复成功', c2.status === 201 && c2.data?.parentId === c1.data.id)
  const c3 = await api(`/api/community/posts/${postId}/comments`, { method: 'POST', token: tokenB, body: { content: '三级', parentId: c2.data.id } })
  check('三级回复被拒绝（400）', c3.status === 400, `实际 ${c3.status}`)

  const detail = await api(`/api/community/posts/${postId}`, { token: tokenB })
  check('帖子详情含评论与点赞态',
    detail.data?.post?.likedByMe === true && detail.data?.comments?.length === 2 && detail.data?.post?.commentsCount === 2)

  const notify = await api('/api/community/notifications', { token: tokenA })
  check('A 收到点赞+评论通知（取消点赞的通知已撤回，未读=1赞+1评论）',
    notify.data?.unreadCount === 2 && notify.data?.items?.some(n => n.type === 'like') && notify.data?.items?.some(n => n.type === 'comment'),
    JSON.stringify({ unread: notify.data?.unreadCount, types: notify.data?.items?.map(n => n.type) }))
  await api('/api/community/notifications/read-all', { method: 'PUT', token: tokenA })
  check('全部已读后未读数归零', (await api('/api/community/notifications', { token: tokenA })).data?.unreadCount === 0)

  const delByOther = await api(`/api/community/posts/${postId}`, { method: 'DELETE', token: tokenB })
  check('B 删除 A 的帖子返回 403', delByOther.status === 403, `实际 ${delByOther.status}`)
  const delComment = await api(`/api/community/comments/${c1.data.id}`, { method: 'DELETE', token: tokenB })
  check('B 删除自己的评论成功', delComment.status === 200)
  check('删除评论后帖子评论数回退', (await api(`/api/community/posts/${postId}`, { token: tokenA })).data?.post?.commentsCount === 0)
  // A 轨迹：发帖105 → 再被赞106 → 收到评论+2=108 → 自己回复+1=109 → 回收c1(+2)+c2(+1)=106
  const [ptsB, ptsA] = [await pointsOf(tokenB), await pointsOf(tokenA)]
  check('删除评论回收双方积分（B -1 评论 / A -2 收到评论 -1 回复）',
    ptsB === 100 && ptsA === 106, `实际 B=${ptsB} A=${ptsA}`)
  const delPost = await api(`/api/community/posts/${postId}`, { method: 'DELETE', token: tokenA })
  check('A 删除自己的帖子成功', delPost.status === 200)
  check('删帖后动态流不再包含', !(await api('/api/community/posts', { token: tokenB })).data?.posts?.some(p => p.id === postId))

  // ---- 图片上传 ----
  console.log('[图片上传]')
  const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
  const uploadRaw = async (token, bytes, contentType) => {
    const res = await fetch(`${BASE}/api/community/upload`, {
      method: 'POST',
      headers: { 'Content-Type': contentType, Origin: ORIGIN, 'X-Desktop-Token': 'zsb-desktop-v2', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: bytes
    })
    let data = null
    try { data = await res.json() } catch { /* 图片响应非 JSON */ }
    return { status: res.status, data, headers: res.headers }
  }
  check('未认证上传返回 401', (await uploadRaw(null, PNG_1PX, 'image/png')).status === 401)
  const up1 = await uploadRaw(tokenA, PNG_1PX, 'image/png')
  check('上传 PNG 返回 201 + url', up1.status === 201 && /^\/api\/community\/images\/[a-f0-9]{16}$/.test(up1.data?.url || ''), JSON.stringify(up1.data))
  const imgUrl = up1.data?.url
  const imgGet = await fetch(`${BASE}${imgUrl}`, { headers: { Origin: ORIGIN } })
  check('图片公开读取 200 + 内容类型正确', imgGet.status === 200 && imgGet.headers.get('content-type') === 'image/png')
  check('伪造 Content-Type 的非法图片被 Magic Bytes 拒绝', (await uploadRaw(tokenA, Buffer.from('not an image'), 'image/png')).status === 400)
  // 携带 EXIF 的 JPEG：APP1 段应在服务端被剥离
  const jpegExif = Buffer.from([0xFF, 0xD8, 0xFF, 0xE1, 0x00, 0x10, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 1, 2, 3, 4, 5, 6, 7, 8, 0xFF, 0xD9])
  const upJpg = await uploadRaw(tokenA, jpegExif, 'image/jpeg')
  check('上传 JPEG 返回 201', upJpg.status === 201, JSON.stringify(upJpg.data))
  const jpgGet = await fetch(`${BASE}${upJpg.data?.url}`)
  check('EXIF 元数据已被服务端剥离', jpgGet.status === 200 && !Buffer.from(await jpgGet.arrayBuffer()).includes(Buffer.from('Exif')))

  // ---- 发帖配图 ----
  console.log('[发帖配图]')
  const postImg = await api('/api/community/posts', { method: 'POST', token: tokenA, body: { type: 'share', content: '配图帖', tags: [], imageUrls: [imgUrl] } })
  check('发帖携带图片成功', postImg.status === 201 && postImg.data?.imageUrls?.[0] === imgUrl, JSON.stringify(postImg.data))
  check('动态流返回 imageUrls', (await api('/api/community/posts', { token: tokenB })).data?.posts?.find(p => p.id === postImg.data?.id)?.imageUrls?.length === 1)
  check('引用他人图片发帖被拒绝', (await api('/api/community/posts', { method: 'POST', token: tokenB, body: { type: 'share', content: '盗图', tags: [], imageUrls: [imgUrl] } })).status === 400)

  // 发帖限流按 key+IP 计数（community:post 5 次/分），到这里已用满，等待一个限流窗口再发提问帖
  console.log('  … 等待 61s 让发帖限流窗口滑动')
  await new Promise(r => setTimeout(r, 61_000))

  // ---- 提问帖（用 B 发帖，便于验证 A 非楼主 403）----
  console.log('[提问帖]')
  check('提问帖缺科目标签返回 400', (await api('/api/community/posts', { method: 'POST', token: tokenB, body: { type: 'question', content: '这题怎么做', tags: [] } })).status === 400)
  const qPost = await api('/api/community/posts', { method: 'POST', token: tokenB, body: { type: 'question', content: '这道极限题怎么做', tags: ['#高等数学'] } })
  check('提问帖发布成功且默认待解答', qPost.status === 201 && qPost.data?.isResolved === false, JSON.stringify(qPost.data))
  const qId = qPost.data?.id
  const qFeed = await api('/api/community/posts?type=question', { token: tokenA })
  check('提问类型筛选生效', qFeed.data?.posts?.length >= 1 && qFeed.data.posts.every(p => p.type === 'question'))
  check('非楼主标记解决返回 403', (await api(`/api/community/posts/${qId}/resolve`, { method: 'PUT', token: tokenA })).status === 403)
  check('楼主标记已解答', (await api(`/api/community/posts/${qId}/resolve`, { method: 'PUT', token: tokenB })).data?.isResolved === true)
  check('再次标记为取消解答', (await api(`/api/community/posts/${qId}/resolve`, { method: 'PUT', token: tokenB })).data?.isResolved === false)

  // ---- 举报与审核（A 举报 B 的提问帖，A 提升为管理员处理）----
  console.log('[举报与审核]')
  check('A 举报 B 的帖子返回 201', (await api('/api/community/reports', { method: 'POST', token: tokenA, body: { targetType: 'post', targetId: qId, reason: '广告' } })).status === 201)
  check('重复举报被拒绝', (await api('/api/community/reports', { method: 'POST', token: tokenA, body: { targetType: 'post', targetId: qId, reason: '广告' } })).status === 400)
  check('举报自己的内容被拒绝', (await api('/api/community/reports', { method: 'POST', token: tokenA, body: { targetType: 'post', targetId: postImg.data.id, reason: '广告' } })).status === 400)
  check('非法举报原因被拒绝', (await api('/api/community/reports', { method: 'POST', token: tokenB, body: { targetType: 'post', targetId: postImg.data.id, reason: '随便' } })).status === 400)
  check('非管理员访问举报队列返回 403', (await api('/api/admin/reports', { token: tokenB })).status === 403)

  d1(`UPDATE users SET role = 'admin' WHERE username = '${userA.username}'`)
  const queue = await api('/api/admin/reports', { token: tokenA })
  const repId = queue.data?.reports?.find(r => r.targetId === qId)?.id
  check('管理员查看举报队列（含目标快照）', !!repId && queue.data.reports.find(r => r.id === repId)?.target?.excerpt?.includes('极限'), JSON.stringify(queue.data))
  check('管理员隐藏被举报帖子', (await api(`/api/admin/reports/${repId}/resolve`, { method: 'PUT', token: tokenA, body: { action: 'hide', reason: '确认违规' } })).status === 200)
  check('被隐藏帖子从广场消失', !(await api('/api/community/posts', { token: tokenB })).data?.posts?.some(p => p.id === qId))
  const notifB = await api('/api/community/notifications', { token: tokenB })
  check('被处理人收到 system 通知（含原因）', notifB.data?.items?.some(n => n.type === 'system' && (n.content || '').includes('隐藏')), JSON.stringify(notifB.data?.items?.map(n => n.type)))
  check('举报人收到处理回执', (await api('/api/community/notifications', { token: tokenA })).data?.items?.some(n => n.type === 'system' && (n.content || '').includes('感谢你的监督')))
  check('审核动作已留痕', /"n":\s*[1-9]/.test(d1('SELECT COUNT(*) AS n FROM community_moderation_log')))

  // 驳回路径 + 管理员删除路径（连带 R2 图片清理）
  await api('/api/community/reports', { method: 'POST', token: tokenB, body: { targetType: 'post', targetId: postImg.data.id, reason: '不相关内容' } })
  const rep2Id = (await api('/api/admin/reports', { token: tokenA })).data?.reports?.find(r => r.targetId === postImg.data.id)?.id
  check('管理员驳回举报', (await api(`/api/admin/reports/${rep2Id}/resolve`, { method: 'PUT', token: tokenA, body: { action: 'reject' } })).status === 200)
  check('驳回后帖子仍在广场', (await api('/api/community/posts', { token: tokenB })).data?.posts?.some(p => p.id === postImg.data.id))
  await api('/api/community/reports', { method: 'POST', token: tokenB, body: { targetType: 'post', targetId: postImg.data.id, reason: '广告' } })
  const rep3Id = (await api('/api/admin/reports', { token: tokenA })).data?.reports?.find(r => r.targetId === postImg.data.id)?.id
  check('管理员删除被举报帖子', (await api(`/api/admin/reports/${rep3Id}/resolve`, { method: 'PUT', token: tokenA, body: { action: 'delete', reason: '广告内容' } })).status === 200)
  check('删除后帖子详情 404', (await api(`/api/community/posts/${postImg.data.id}`, { token: tokenB })).status === 404)
  check('配图已随删帖从 R2 清理', (await fetch(`${BASE}${imgUrl}`)).status === 404)

  // ---- 服务端积分规则 ----
  console.log('[服务端积分规则]')
  const todayUtc8 = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)
  const stateToday = sampleState()
  stateToday.records = [{ id: 'rt', subjectId: 'math', date: todayUtc8, minutes: 70, createdAt: 1 }]
  stateToday.gamification.lastCheckin = todayUtc8
  stateToday.gamification.pointsLog = [{ date: todayUtc8, points: 10, reason: '每日打卡', refId: 'rt' }]
  const syncAward = await api('/api/data/sync', { method: 'POST', token: tokenA, body: stateToday })
  check('学习时长达标发放 +3 并回传 gamification',
    syncAward.data?.awarded?.some(a => a.points === 3) && syncAward.data?.gamification?.points === 103,
    JSON.stringify(syncAward.data?.awarded))
  // 真实前端会用响应中的 gamification 回写本地（见 app store saveAsync），smoke 模拟该行为
  stateToday.gamification = syncAward.data.gamification
  check('重复推送不重复发放（refId 去重）',
    !((await api('/api/data/sync', { method: 'POST', token: tokenA, body: stateToday })).data?.awarded?.length))
  const pullAward = await api('/api/data/sync', { token: tokenA })
  check('服务端流水（srv:）在全量同步后保留',
    pullAward.data?.gamification?.pointsLog?.some(l => l.refId?.startsWith('srv:study-minutes:')) &&
    pullAward.data.gamification.points === 103)
  const stateStreak = sampleState()
  stateStreak.records = []
  stateStreak.gamification.streak = 7
  const syncStreak = await api('/api/data/sync', { method: 'POST', token: tokenB, body: stateStreak })
  check('连续打卡 7 天发放 +5', syncStreak.data?.awarded?.some(a => a.points === 5 && (a.reason || '').includes('连续打卡')), JSON.stringify(syncStreak.data?.awarded))

  // ---- 每日打卡榜 ----
  console.log('[每日打卡榜]')
  const lb = await api('/api/community/leaderboard', { token: tokenA })
  check('榜单返回结构完整', lb.status === 200 && Array.isArray(lb.data?.today) && Array.isArray(lb.data?.streak))
  // A 当日积分 = 每日打卡 10 + 学习时长 3 + 社区打卡 5（均落在今日）
  check('今日打卡榜：A 以当日积分上榜并携带科目', lb.data.today?.[0]?.todayPoints >= 13 && lb.data.today[0].subjects?.includes('高等数学'), JSON.stringify(lb.data?.today))
  check('连续打卡王按 streak 降序（B=7 在 A=5 前）', lb.data.streak?.[0]?.streak === 7 && lb.data.streak?.[1]?.streak === 5, JSON.stringify(lb.data?.streak))

  // ---- 404 ----
  console.log('[路由]')
  check('未知路径返回 404', (await api('/api/nonexistent', { token: tokenA })).status === 404)

  console.log(`\n结果: ${passed} 通过, ${failed} 失败`)
  process.exit(failed ? 1 : 0)
}

main().catch(e => { console.error('冒烟测试执行异常:', e); process.exit(1) })
