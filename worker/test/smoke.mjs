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
  const adminUserId = regA.data?.user?.id
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
  // 残留库重跑时可能有历史同标签帖子，只断言目标帖在结果集中且全部命中标签
  check('按标签筛选生效', tagFeed.data?.posts?.some(p => p.id === postId) && tagFeed.data.posts.every(p => p.tags.includes('#高等数学')))
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
  check('A 收到点赞+评论+首帖徽章通知（取消点赞的通知已撤回，未读=1赞+1评论+1徽章）',
    notify.data?.unreadCount === 3 && notify.data?.items?.some(n => n.type === 'like') && notify.data?.items?.some(n => n.type === 'comment')
      && notify.data?.items?.some(n => n.type === 'achievement' && (n.content || '').includes('首次发帖')),
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

  // ---- 最佳答案采纳 ----
  console.log('[最佳答案采纳]')
  const ansC = await api(`/api/community/posts/${qId}/comments`, { method: 'POST', token: tokenA, body: { content: '这题用洛必达法则，分子分母分别求导' } })
  check('A 回答 B 的提问帖', ansC.status === 201, JSON.stringify(ansC.data))
  const ansCId = ansC.data?.id
  check('非楼主采纳返回 403', (await api(`/api/community/posts/${qId}/accept`, { method: 'PUT', token: tokenA, body: { commentId: ansCId } })).status === 403)
  const accept1 = await api(`/api/community/posts/${qId}/accept`, { method: 'PUT', token: tokenB, body: { commentId: ansCId } })
  check('楼主采纳最佳答案（自动已解答）', accept1.data?.acceptedAnswerId === ansCId && accept1.data?.isResolved === true, JSON.stringify(accept1.data))
  // 积分轨迹：A 105 → 评论+1=106 → 被采纳+10=116；B qPost首帖+5=105 → 收到评论+2=107 → 提问被解答+3=110
  check('采纳积分：回答者 +10 / 提问者 +3', (await pointsOf(tokenA)) === 116 && (await pointsOf(tokenB)) === 110,
    `实际 A=${await pointsOf(tokenA)} B=${await pointsOf(tokenB)}`)
  check('被采纳者收到 achievement 通知', (await api('/api/community/notifications', { token: tokenA })).data?.items?.some(n => n.type === 'achievement' && (n.content || '').includes('采纳')))
  check('已采纳时手动标记解决被拒绝（400）', (await api(`/api/community/posts/${qId}/resolve`, { method: 'PUT', token: tokenB })).status === 400)
  const detailAccepted = await api(`/api/community/posts/${qId}`, { token: tokenB })
  check('详情返回采纳状态（acceptedAnswerId + isAccepted）',
    detailAccepted.data?.post?.acceptedAnswerId === ansCId && detailAccepted.data?.comments?.find(c => c.id === ansCId)?.isAccepted === true)
  const accept2 = await api(`/api/community/posts/${qId}/accept`, { method: 'PUT', token: tokenB, body: { commentId: ansCId } })
  check('重复采纳同一评论为取消采纳（回退待解答）', accept2.data?.acceptedAnswerId === null && accept2.data?.isResolved === false)
  check('取消采纳回收双方积分', (await pointsOf(tokenA)) === 106 && (await pointsOf(tokenB)) === 107)
  check('取消采纳撤回 achievement 通知',
    !(await api('/api/community/notifications', { token: tokenA })).data?.items?.some(n => n.type === 'achievement' && n.commentId === ansCId))
  await api(`/api/community/posts/${qId}/accept`, { method: 'PUT', token: tokenB, body: { commentId: ansCId } })
  check('重新采纳积分恢复', (await pointsOf(tokenA)) === 116 && (await pointsOf(tokenB)) === 110)
  const selfC = await api(`/api/community/posts/${qId}/comments`, { method: 'POST', token: tokenB, body: { content: '补充题目条件' } })
  check('采纳自己的评论被拒绝（400）', (await api(`/api/community/posts/${qId}/accept`, { method: 'PUT', token: tokenB, body: { commentId: selfC.data?.id } })).status === 400)

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

  // ---- 精华帖 ----
  console.log('[精华帖]')
  const sharePost = await api('/api/community/posts', { method: 'POST', token: tokenB, body: { type: 'share', content: '高数极限求法总结：先定型再选方法', tags: ['#升本经验'] } })
  check('B 发经验帖', sharePost.status === 201, JSON.stringify(sharePost.data))
  const shareId = sharePost.data?.id
  check('非管理员加精返回 403', (await api(`/api/admin/posts/${shareId}/feature`, { method: 'PUT', token: tokenB })).status === 403)
  check('管理员加精', (await api(`/api/admin/posts/${shareId}/feature`, { method: 'PUT', token: tokenA })).data?.isFeatured === true)
  const featuredFeed = await api('/api/community/posts?featured=1', { token: tokenB })
  check('精华筛选仅含加精帖（隐藏/已删帖不出现）', featuredFeed.data?.posts?.length === 1 && featuredFeed.data.posts[0].id === shareId && featuredFeed.data.posts[0].isFeatured === true, JSON.stringify(featuredFeed.data?.posts?.map(p => p.id)))
  const unfeature = await api(`/api/admin/posts/${shareId}/feature`, { method: 'PUT', token: tokenA })
  check('取消加精后精华流为空', unfeature.data?.isFeatured === false &&
    (await api('/api/community/posts?featured=1', { token: tokenB })).data?.posts?.length === 0)
  check('加精动作已留痕', /feature/.test(d1("SELECT action FROM community_moderation_log WHERE action = 'feature' LIMIT 1")))

  // ---- 评论图片 ----
  console.log('[评论图片]')
  const up2 = await uploadRaw(tokenA, PNG_1PX, 'image/png')
  const imgUrl2 = up2.data?.url
  const imgC = await api(`/api/community/posts/${shareId}/comments`, { method: 'POST', token: tokenA, body: { content: '手写步骤供参考', imageUrls: [imgUrl2] } })
  check('评论携带图片成功', imgC.status === 201 && imgC.data?.imageUrls?.[0] === imgUrl2, JSON.stringify(imgC.data))
  check('帖子详情的评论返回配图', (await api(`/api/community/posts/${shareId}`, { token: tokenB })).data?.comments?.find(c => c.id === imgC.data?.id)?.imageUrls?.length === 1)
  check('评论引用他人图片被拒绝（400）', (await api(`/api/community/posts/${shareId}/comments`, { method: 'POST', token: tokenB, body: { content: '盗图', imageUrls: [imgUrl2] } })).status === 400)
  const delImgC = await api(`/api/community/comments/${imgC.data?.id}`, { method: 'DELETE', token: tokenA })
  check('删除评论成功', delImgC.status === 200)
  check('评论配图随删除从 R2 清理', (await fetch(`${BASE}${imgUrl2}`)).status === 404)

  // ---- 敏感词过滤 ----
  // 本节发帖用例共 4 个（加微信/间隔符/标签），加上前面窗口的 3 个（提问缺标签/qPost/sharePost）会超限，
  // 等待一个限流窗口再开始
  console.log('[敏感词过滤]')
  console.log('  … 等待 61s 让发帖限流窗口滑动')
  await new Promise(r => setTimeout(r, 61_000))
  check('命中敏感词发帖被拒绝（400）', (await api('/api/community/posts', { method: 'POST', token: tokenA, body: { type: 'share', content: '更多资料加微信领取', tags: [] } })).status === 400)
  check('命中敏感词评论被拒绝（400）', (await api(`/api/community/posts/${shareId}/comments`, { method: 'POST', token: tokenB, body: { content: '兼职日结，私聊' } })).status === 400)
  check('间隔符绕过被归一化拦截（400）', (await api('/api/community/posts', { method: 'POST', token: tokenA, body: { type: 'share', content: '加 微 信 有内部资料', tags: [] } })).status === 400)
  check('标签命中敏感词被拒绝（400）', (await api('/api/community/posts', { method: 'POST', token: tokenA, body: { type: 'share', content: '正常内容', tags: ['#兼职日结'] } })).status === 400)
  // 昵称/用户名/认证专长同样公开可见，统一过敏感词
  check('昵称命中敏感词被拒绝（400）', (await api('/api/settings', { method: 'PUT', token: tokenA, body: { userName: '代考包过找我' } })).status === 400)
  check('认证专长命中敏感词被拒绝（400）', (await api(`/api/admin/users/${adminUserId}/verify`, { method: 'PUT', token: tokenA, body: { expertise: '兼职日结' } })).status === 400)
  check('注册用户名命中敏感词被拒绝（400）', (await api('/api/auth/register', { method: 'POST', body: { username: '卖答案的人', password: 'password123' } })).status === 400)
  // 「包过」限定为营销搭配词后，正常表达不应被误伤（用评论验证，避免占用发帖限流额度）
  check('「红包过期」等正常表达不误伤', (await api(`/api/community/posts/${shareId}/comments`, { method: 'POST', token: tokenA, body: { content: '群里发的红包过期了，可惜' } })).status === 201)

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
  // 残留库可能有历史 streak=100 数据（LIMIT 5 会挤掉 B），干净库下验证完整降序语义
  if (lb.data.streak?.length && lb.data.streak.length <= 5 && lb.data.streak[0].streak === 7) {
    check('连续打卡王按 streak 降序（B=7 在 A=5 前）', lb.data.streak[0].streak === 7 && lb.data.streak[1].streak === 5, JSON.stringify(lb.data?.streak))
  } else {
    check('连续打卡王按 streak 降序（残留库容忍）', lb.data.streak?.every((e, i, a) => i === 0 || a[i - 1].streak >= e.streak), JSON.stringify(lb.data?.streak))
  }

  // ---- 徽章与专家认证 ----
  // 放在最后：streak 推送会覆盖 B 的 gamification（避免干扰榜单断言）；发帖额度需要新窗口
  console.log('[徽章与专家认证]')
  console.log('  … 等待 61s 让发帖限流窗口滑动')
  await new Promise(r => setTimeout(r, 61_000))

  const newPostA = await api('/api/community/posts', { method: 'POST', token: tokenA, body: { type: 'share', content: '徽章测试帖', tags: [] } })
  const userIdA = newPostA.data?.userId
  const profileA0 = await api(`/api/community/users/${userIdA}/profile`, { token: tokenA })
  check('资料卡返回结构完整', profileA0.status === 200 && Array.isArray(profileA0.data?.badges), JSON.stringify(profileA0.data))
  check('首次发帖徽章已发放（A 首帖时）', profileA0.data?.badges?.some(b => b.key === 'first_post'))
  check('资料卡不泄露登录名/角色', profileA0.data && !('username' in profileA0.data) && !('role' in profileA0.data))
  check('资料卡 404（不存在的用户）', (await api('/api/community/users/nouser000000000/profile', { token: tokenA })).status === 404)

  // 百赞达人：d1 把新帖 likes_count 调到 99，B 真实点赞凑满 100
  d1(`UPDATE community_posts SET likes_count = 99 WHERE id = '${newPostA.data.id}'`)
  await api('/api/community/likes', { method: 'POST', token: tokenB, body: { targetType: 'post', targetId: newPostA.data.id } })
  const profileA1 = await api(`/api/community/users/${userIdA}/profile`, { token: tokenA })
  check('百赞达人徽章在获赞满 100 时发放', profileA1.data?.badges?.some(b => b.key === 'likes_100'), JSON.stringify(profileA1.data?.badges))
  check('徽章发放推送 achievement 通知',
    (await api('/api/community/notifications', { token: tokenA })).data?.items?.some(n => n.type === 'achievement' && (n.content || '').includes('百赞达人')))

  // 答疑专家：d1 补 9 条已采纳评论（挂在已隐藏的 qId 下），再真实采纳 1 条凑满 10（A 已有 ansC 被采纳）
  d1(`WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c WHERE x<9) INSERT INTO community_comments (id, post_id, user_id, parent_id, content, image_urls, likes_count, is_accepted, is_hidden, created_at, updated_at) SELECT lower(hex(randomblob(8))), '${qId}', '${userIdA}', NULL, '历史采纳', '[]', 0, 1, 0, 1755000000, 1755000000 FROM c`)
  const newQ = await api('/api/community/posts', { method: 'POST', token: tokenB, body: { type: 'question', content: '又一道极限题', tags: ['#高等数学'] } })
  const userIdB = newQ.data?.userId
  const answerC = await api(`/api/community/posts/${newQ.data.id}/comments`, { method: 'POST', token: tokenA, body: { content: '先用等价无穷小替换' } })
  await api(`/api/community/posts/${newQ.data.id}/accept`, { method: 'PUT', token: tokenB, body: { commentId: answerC.data.id } })
  const profileA2 = await api(`/api/community/users/${userIdA}/profile`, { token: tokenA })
  check('答疑专家徽章在被采纳满 10 次时发放', profileA2.data?.badges?.some(b => b.key === 'answer_expert'), JSON.stringify(profileA2.data?.badges))

  // 图片达人：d1 补 50 条上传记录，再真实上传 1 张越过 50 门槛
  d1(`WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c WHERE x<50) INSERT INTO community_uploads (id, user_id, filename, r2_key, url, size, content_type, created_at) SELECT lower(hex(randomblob(8))), '${userIdA}', 'seed', 'posts/seed-'||x||'.png', '/api/community/images/seed', 1, 'image/png', 1755000000 FROM c`)
  const up3 = await uploadRaw(tokenA, PNG_1PX, 'image/png')
  check('第 50+ 张上传成功', up3.status === 201, JSON.stringify(up3.data))
  const profileA3 = await api(`/api/community/users/${userIdA}/profile`, { token: tokenA })
  check('图片达人徽章在上传满 50 张时发放', profileA3.data?.badges?.some(b => b.key === 'image_50'), JSON.stringify(profileA3.data?.badges))

  // 连续打卡徽章：B 在积分规则 section 已推过 streak=7（streak_7 应已发放）
  const profileB0 = await api(`/api/community/users/${userIdB}/profile`, { token: tokenB })
  check('首次发帖/首次提问徽章已发放（B 提问帖时）',
    profileB0.data?.badges?.some(b => b.key === 'first_post') && profileB0.data?.badges?.some(b => b.key === 'first_question'),
    JSON.stringify(profileB0.data?.badges))
  check('连续打卡 7 天徽章已随同步发放', profileB0.data?.badges?.some(b => b.key === 'streak_7'))
  const stateStreak2 = sampleState()
  stateStreak2.records = []
  stateStreak2.gamification.streak = 100
  await api('/api/data/sync', { method: 'POST', token: tokenB, body: stateStreak2 })
  const profileB1 = await api(`/api/community/users/${userIdB}/profile`, { token: tokenB })
  check('连续打卡 30/100 天徽章随同步发放',
    profileB1.data?.badges?.some(b => b.key === 'streak_30') && profileB1.data?.badges?.some(b => b.key === 'streak_100'),
    JSON.stringify(profileB1.data?.badges))

  // 专家认证
  check('非管理员授予认证返回 403', (await api(`/api/admin/users/${userIdB}/verify`, { method: 'PUT', token: tokenB, body: { expertise: '高等数学' } })).status === 403)
  check('缺少专长领域返回 400', (await api(`/api/admin/users/${userIdB}/verify`, { method: 'PUT', token: tokenA, body: {} })).status === 400)
  const verify = await api(`/api/admin/users/${userIdB}/verify`, { method: 'PUT', token: tokenA, body: { expertise: '高等数学' } })
  check('管理员授予专家认证', verify.status === 200 && verify.data?.verified === true, JSON.stringify(verify.data))
  check('动态流透出蓝 V（userVerified）',
    (await api('/api/community/posts', { token: tokenA })).data?.posts?.some(p => p.userId === userIdB && p.userVerified === true))
  check('被认证用户收到 system 通知',
    (await api('/api/community/notifications', { token: tokenB })).data?.items?.some(n => n.type === 'system' && (n.content || '').includes('认证')))
  const unverify = await api(`/api/admin/users/${userIdB}/verify`, { method: 'DELETE', token: tokenA })
  check('撤销专家认证', unverify.status === 200 && unverify.data?.verified === false)
  check('撤销后资料卡 verified=false', (await api(`/api/community/users/${userIdB}/profile`, { token: tokenA })).data?.verified === false)
  check('认证动作已留痕', /verify/.test(d1("SELECT action FROM community_moderation_log WHERE action = 'verify' LIMIT 1")))

  // ---- 好友关注 ----
  console.log('[好友关注]')
  check('不能关注自己（400）', (await api(`/api/community/users/${userIdA}/follow`, { method: 'PUT', token: tokenA })).status === 400)
  check('关注不存在的用户（404）', (await api('/api/community/users/nouser000000000/follow', { method: 'PUT', token: tokenA })).status === 404)
  const follow1 = await api(`/api/community/users/${userIdA}/follow`, { method: 'PUT', token: tokenB })
  check('B 关注 A', follow1.status === 200 && follow1.data?.following === true, JSON.stringify(follow1.data))
  check('A 收到 follow 通知',
    (await api('/api/community/notifications', { token: tokenA })).data?.items?.some(n => n.type === 'follow' && n.actorId === userIdB))
  const profileA4 = await api(`/api/community/users/${userIdA}/profile`, { token: tokenB })
  check('资料卡粉丝数=1 且 followedByMe=true', profileA4.data?.followers === 1 && profileA4.data?.followedByMe === true,
    JSON.stringify({ followers: profileA4.data?.followers, followedByMe: profileA4.data?.followedByMe }))
  // 关注流：B 视角仅含 A 的未隐藏帖子（newPostA + ansC 回答所在帖；A 的 postImg 已删、firstPost 已隐藏）
  const followFeed = await api('/api/community/posts?follow=1', { token: tokenB })
  check('关注流仅含关注作者的帖子',
    followFeed.data?.posts?.length === 2 && followFeed.data.posts.every(p => p.userId === userIdA),
    JSON.stringify(followFeed.data?.posts?.map(p => p.id)))
  check('A 视角关注流为空（A 未关注任何人）', (await api('/api/community/posts?follow=1', { token: tokenA })).data?.posts?.length === 0)
  const follow2 = await api(`/api/community/users/${userIdA}/follow`, { method: 'PUT', token: tokenB })
  check('重复调用为取关', follow2.data?.following === false)
  check('取关后 follow 通知撤回',
    !(await api('/api/community/notifications', { token: tokenA })).data?.items?.some(n => n.type === 'follow' && n.actorId === userIdB))
  check('取关后关注流为空', (await api('/api/community/posts?follow=1', { token: tokenB })).data?.posts?.length === 0)
  check('取关后粉丝数回退', (await api(`/api/community/users/${userIdA}/profile`, { token: tokenB })).data?.followers === 0)

  // ---- 每日一题 ----
  console.log('[每日一题]')
  check('无每日一题时返回 null', (await api('/api/community/daily', { token: tokenA })).data?.post === null)
  check('非管理员设置每日一题返回 403', (await api(`/api/admin/posts/${shareId}/daily`, { method: 'PUT', token: tokenB })).status === 403)
  const daily1 = await api(`/api/admin/posts/${shareId}/daily`, { method: 'PUT', token: tokenA })
  check('管理员设置每日一题', daily1.status === 200 && daily1.data?.isDaily === true, JSON.stringify(daily1.data))
  const dailyGet = await api('/api/community/daily', { token: tokenB })
  check('广场获取每日一题', dailyGet.data?.post?.id === shareId && dailyGet.data?.post?.isDaily === true, JSON.stringify(dailyGet.data))
  // 设置更新的帖子后，顶部展示切换为最新一题
  const daily2 = await api(`/api/admin/posts/${newQ.data.id}/daily`, { method: 'PUT', token: tokenA })
  check('设置第二个每日一题', daily2.data?.isDaily === true)
  check('顶部展示切换为最新一题', (await api('/api/community/daily', { token: tokenB })).data?.post?.id === newQ.data.id)
  check('取消最新一题后回退到上一题',
    (await api(`/api/admin/posts/${newQ.data.id}/daily`, { method: 'PUT', token: tokenA })).data?.isDaily === false &&
    (await api('/api/community/daily', { token: tokenB })).data?.post?.id === shareId)
  check('每日一题动作已留痕', /daily/.test(d1("SELECT action FROM community_moderation_log WHERE action = 'daily' LIMIT 1")))
  await api(`/api/admin/posts/${shareId}/daily`, { method: 'PUT', token: tokenA })
  check('全部取消后返回 null', (await api('/api/community/daily', { token: tokenB })).data?.post === null)

  // ---- 话题圈子 ----
  console.log('[话题圈子]')
  // 用户 C 在此注册：auth 限流 5 次/分，认证段已用满，等到此段时窗口已滑动
  const userC = { username: `smoke_c_${uniq}`, password: 'password123' }
  const regC = await api('/api/auth/register', { method: 'POST', body: userC })
  const tokenC = regC.data?.token
  const userIdC = regC.data?.user?.id
  check('注册 C（限流窗口已滑动）', !!tokenC, JSON.stringify(regC.data))
  // 建圈
  const circlePub = await api('/api/community/circles', { method: 'POST', token: tokenA, body: { name: '高数冲刺组', description: '一起刷题', isPublic: true } })
  check('创建公开圈', circlePub.status === 201 && circlePub.data?.myStatus === 'owner' && circlePub.data?.memberCount === 1, JSON.stringify(circlePub.data))
  const pubId = circlePub.data?.id
  const circlePriv = await api('/api/community/circles', { method: 'POST', token: tokenA, body: { name: '英语单词打卡组', isPublic: false } })
  check('创建审核圈', circlePriv.status === 201 && circlePriv.data?.isPublic === false)
  const privId = circlePriv.data?.id
  check('圈子名称命中敏感词（400）', (await api('/api/community/circles', { method: 'POST', token: tokenA, body: { name: '兼职日结组' } })).status === 400)
  const circlesList = await api('/api/community/circles', { token: tokenB })
  // 残留库可能有历史圈子，只断言新建的两个圈在列表中且 B 的状态为未加入
  check('圈子列表含新建圈且附我的状态',
    ['高数冲刺组', '英语单词打卡组'].every(n => circlesList.data?.circles?.some(c => c.name === n && c.myStatus === null)),
    JSON.stringify(circlesList.data?.circles?.map(c => [c.name, c.myStatus])))

  // 公开圈：B 直接加入并发帖
  check('B 加入公开圈（直接 active）', (await api(`/api/community/circles/${pubId}/join`, { method: 'PUT', token: tokenB })).data?.status === 'active')
  check('加入后成员数=2', (await api(`/api/community/circles/${pubId}`, { token: tokenB })).data?.circle?.memberCount === 2)
  console.log('  … 等待 61s 让发帖限流窗口滑动')
  await new Promise(r => setTimeout(r, 61_000))
  const circlePost = await api('/api/community/posts', { method: 'POST', token: tokenB, body: { type: 'share', content: '圈内讨论：微分中值定理', tags: [], circleId: pubId } })
  check('成员圈内发帖成功', circlePost.status === 201 && circlePost.data?.circleId === pubId && circlePost.data?.circleName === '高数冲刺组', JSON.stringify(circlePost.data))
  check('圈子帖不进公共广场', !(await api('/api/community/posts', { token: tokenA })).data?.posts?.some(p => p.id === circlePost.data.id))
  const circleFeed = await api(`/api/community/posts?circle=${pubId}`, { token: tokenB })
  check('圈内流含圈子帖', circleFeed.data?.posts?.some(p => p.id === circlePost.data.id))

  // 非成员在公开圈可浏览但不能发帖
  check('公开圈非成员可浏览帖子流', (await api(`/api/community/posts?circle=${pubId}`, { token: tokenA })).status === 200)
  check('非成员圈内发帖被拒（403）', (await api('/api/community/posts', { method: 'POST', token: tokenC, body: { type: 'share', content: '混入', tags: [], circleId: pubId } })).status === 403)

  // 审核圈：申请→圈主批准→发帖
  check('C 申请加入审核圈（pending）', (await api(`/api/community/circles/${privId}/join`, { method: 'PUT', token: tokenC })).data?.status === 'pending')
  check('审核圈非成员浏览被拒（403）', (await api(`/api/community/posts?circle=${privId}`, { token: tokenC })).status === 403)
  check('待审批不计入成员数', (await api(`/api/community/circles/${privId}`, { token: tokenA })).data?.circle?.memberCount === 1)
  check('圈主收到申请通知', (await api('/api/community/notifications', { token: tokenA })).data?.items?.some(n => (n.content || '').includes('申请加入圈子')))
  const privDetail = await api(`/api/community/circles/${privId}`, { token: tokenA })
  check('圈主可见待审批列表', privDetail.data?.pending?.length === 1 && privDetail.data.pending[0].userId === userIdC)
  check('圈主批准申请', (await api(`/api/community/circles/${privId}/members/${userIdC}/approve`, { method: 'PUT', token: tokenA })).status === 200)
  check('批准后成员数=2', (await api(`/api/community/circles/${privId}`, { token: tokenA })).data?.circle?.memberCount === 2)
  check('申请人收到通过通知', (await api('/api/community/notifications', { token: tokenC })).data?.items?.some(n => (n.content || '').includes('已通过')))
  check('批准后 C 可浏览审核圈', (await api(`/api/community/posts?circle=${privId}`, { token: tokenC })).status === 200)
  check('非圈主审批被拒（403）', (await api(`/api/community/circles/${privId}/members/${userIdC}/approve`, { method: 'PUT', token: tokenB })).status === 403)

  // 圈主移除成员
  check('圈主移除成员', (await api(`/api/community/circles/${pubId}/members/${userIdB}`, { method: 'DELETE', token: tokenA })).status === 200)
  check('移除后成员数回退为 1', (await api(`/api/community/circles/${pubId}`, { token: tokenA })).data?.circle?.memberCount === 1)
  check('不能移除圈主（400）', (await api(`/api/community/circles/${pubId}/members/${userIdA}`, { method: 'DELETE', token: tokenA })).status === 400)

  // 圈主退圈限制与成员退圈
  check('圈主不能退出自己的圈（400）', (await api(`/api/community/circles/${privId}/join`, { method: 'PUT', token: tokenA })).status === 400)
  check('成员退圈', (await api(`/api/community/circles/${privId}/join`, { method: 'PUT', token: tokenC })).data?.status === null)
  check('退圈后成员数回退为 1', (await api(`/api/community/circles/${privId}`, { token: tokenA })).data?.circle?.memberCount === 1)
  check('退圈后审核圈再次不可见（403）', (await api(`/api/community/posts?circle=${privId}`, { token: tokenC })).status === 403)

  // ---- 私信 ----
  console.log('[私信]')
  check('不能给自己发私信（400）', (await api(`/api/community/messages/${adminUserId}`, { method: 'POST', token: tokenA, body: { content: 'hi' } })).status === 400)
  check('私信不存在用户（404）', (await api('/api/community/messages/nouser000000000', { method: 'POST', token: tokenA, body: { content: 'hi' } })).status === 404)
  check('私信命中敏感词（400）', (await api(`/api/community/messages/${userIdB}`, { method: 'POST', token: tokenA, body: { content: '加微信详聊' } })).status === 400)
  const msg1 = await api(`/api/community/messages/${userIdB}`, { method: 'POST', token: tokenA, body: { content: '同学，高数那道题你搞定了吗？' } })
  check('A 发私信给 B', msg1.status === 201 && msg1.data?.fromMe === true, JSON.stringify(msg1.data))
  check('B 收到 message 通知', (await api('/api/community/notifications', { token: tokenB })).data?.items?.some(n => n.type === 'message' && n.actorId === adminUserId))
  check('B 私信未读=1', (await api('/api/community/messages/unread-count', { token: tokenB })).data?.count === 1)
  const msg2 = await api(`/api/community/messages/${userIdB}`, { method: 'POST', token: tokenA, body: { content: '我也想请教一下英语' } })
  check('A 再发一条', msg2.status === 201)
  check('B 私信未读=2', (await api('/api/community/messages/unread-count', { token: tokenB })).data?.count === 2)
  const convB = await api('/api/community/messages/conversations', { token: tokenB })
  check('B 会话列表含 A（未读=2）', convB.data?.conversations?.[0]?.peerId === adminUserId && convB.data.conversations[0].unread === 2,
    JSON.stringify(convB.data?.conversations))
  const chatB = await api(`/api/community/messages/with/${adminUserId}`, { token: tokenB })
  check('B 拉取记录（倒序，最新在前）', chatB.data?.messages?.length === 2 && chatB.data.messages[0].content === '我也想请教一下英语',
    JSON.stringify(chatB.data?.messages?.map(m => m.content)))
  check('打开记录后对方消息已读', chatB.data?.messages?.every(m => m.isRead === true))
  check('B 私信未读清零', (await api('/api/community/messages/unread-count', { token: tokenB })).data?.count === 0)
  const replyB = await api(`/api/community/messages/${adminUserId}`, { method: 'POST', token: tokenB, body: { content: '搞定了！用的是洛必达' } })
  check('B 回复 A', replyB.status === 201)
  const convA = await api('/api/community/messages/conversations', { token: tokenA })
  check('A 会话列表最后一条为 B 的回复（lastFromMe=false）',
    convA.data?.conversations?.[0]?.lastFromMe === false && convA.data.conversations[0].unread === 1, JSON.stringify(convA.data?.conversations))

  // 私信举报
  check('举报自己的私信被拒（400）', (await api('/api/community/reports', { method: 'POST', token: tokenA, body: { targetType: 'message', targetId: msg1.data.id, reason: '广告' } })).status === 400)
  check('举报无关私信被拒（403）', (await api('/api/community/reports', { method: 'POST', token: tokenC, body: { targetType: 'message', targetId: msg1.data.id, reason: '广告' } })).status === 403)
  check('接收方举报私信', (await api('/api/community/reports', { method: 'POST', token: tokenB, body: { targetType: 'message', targetId: msg1.data.id, reason: '人身攻击' } })).status === 201)
  const adminReportsMsg = await api('/api/admin/reports', { token: tokenA })
  const msgReport = adminReportsMsg.data?.reports?.find(r => r.targetType === 'message')
  check('管理员看到私信举报（含快照）', !!msgReport && msgReport.target?.excerpt?.includes('高数'), JSON.stringify(msgReport))
  check('私信举报 hide 被拒（400）', (await api(`/api/admin/reports/${msgReport?.id}/resolve`, { method: 'PUT', token: tokenA, body: { action: 'hide' } })).status === 400)
  check('管理员删除被举报私信', (await api(`/api/admin/reports/${msgReport?.id}/resolve`, { method: 'PUT', token: tokenA, body: { action: 'delete', reason: '违规' } })).status === 200)
  check('删除后私信不存在', (await api(`/api/community/messages/with/${userIdB}`, { token: tokenA })).data?.messages?.every(m => m.id !== msg1.data.id))

  // ---- 404 ----
  console.log('[路由]')
  check('未知路径返回 404', (await api('/api/nonexistent', { token: tokenA })).status === 404)

  console.log(`\n结果: ${passed} 通过, ${failed} 失败`)
  process.exit(failed ? 1 : 0)
}

main().catch(e => { console.error('冒烟测试执行异常:', e); process.exit(1) })
