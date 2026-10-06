import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { createHmac } from 'node:crypto'
import { build } from 'esbuild'
import { readFile, mkdir, writeFile, unlink } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

// Exercise real handlers, JWT verification and SQL. Only D1/R2/platform bindings are local fixtures.
const compiled = await build({
  stdin: {
    contents: `export { default as worker } from './worker/src/index';
      export { signToken, hashPassword, verifyTokenFull } from './worker/src/auth';
      export { pushWeeklyReports } from './worker/src/api/partners';`,
    resolveDir: process.cwd()
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false
})
await mkdir('.cache/security-tests', { recursive: true })
const filename = resolve('.cache/security-tests', `${crypto.randomUUID()}.mjs`)
await writeFile(filename, compiled.outputFiles[0].text)
const { worker, signToken, hashPassword, pushWeeklyReports } = await import(pathToFileURL(filename).href)
await unlink(filename)
const schema = await readFile(new URL('../schema.sql', import.meta.url), 'utf8')
globalThis.caches = { default: { async match() {}, async put() {}, async delete() {} } }

function deferred() {
  let resolve
  const promise = new Promise((r) => {
    resolve = r
  })
  return { promise, resolve }
}
function barrier(n) {
  let count = 0
  const ready = deferred()
  return async () => {
    if (++count === n) ready.resolve()
    await ready.promise
  }
}
async function fixture(t, count = 3) {
  const db = new DatabaseSync(':memory:')
  db.exec(schema)
  t.after(() => db.close())
  const hooks = {}
  let queue = Promise.resolve()
  const statement = (sql, params = []) => {
    assert.ok(params.length <= 100, `D1 binding limit: ${params.length}`)
    return {
      sql,
      params,
      bind: (...values) => statement(sql, values),
      first: async () => {
        const row = db.prepare(sql).get(...params) ?? null
        await hooks.first?.(sql, params, row)
        return row
      },
      all: async () => {
        const rows = db.prepare(sql).all(...params)
        await hooks.all?.(sql, params, rows)
        return { results: rows }
      },
      run: async () => {
        await hooks.run?.(sql, params)
        return { meta: { changes: Number(db.prepare(sql).run(...params).changes) } }
      }
    }
  }
  const env = {
    JWT_SECRET: 'security-test-only',
    DESKTOP_TOKEN: 'desktop-test-only',
    DB: {
      prepare: statement,
      batch(stmts) {
        const job = queue.then(async () => {
          await hooks.batch?.(stmts)
          db.exec('BEGIN')
          try {
            const results = []
            for (const stmt of stmts) results.push(await stmt.run())
            db.exec('COMMIT')
            return results
          } catch (error) {
            db.exec('ROLLBACK')
            throw error
          }
        })
        queue = job.catch(() => {})
        return job
      }
    },
    IMAGES: { async delete() {} }
  }
  for (const tier of [3, 5, 10, 20, 30, 60, 100, 120]) env[`RL_${tier}`] = { limit: async () => ({ success: true }) }
  const tokens = new Map()
  const hash = await hashPassword('OldPass123')
  for (let i = 0; i < count; i++) {
    const id = `user${i}`
    db.prepare('INSERT INTO users (id,username,password_hash,created_at) VALUES (?,?,?,1)').run(id, id, hash)
    db.prepare('INSERT INTO user_settings (user_id,user_name) VALUES (?,?)').run(id, id)
    db.prepare('INSERT INTO gamification (user_id) VALUES (?)').run(id)
    tokens.set(id, await signToken(id, env.JWT_SECRET, 'user'))
  }
  async function api(path, id = 'user0', method = 'GET', body, token = tokens.get(id)) {
    const headers = new Headers({ 'X-Desktop-Token': env.DESKTOP_TOKEN })
    if (token) headers.set('Authorization', `Bearer ${token}`)
    if (body) headers.set('Content-Type', 'application/json')
    return worker.fetch(
      new Request(`https://local.invalid${path}`, {
        method,
        headers,
        ...(body ? { body: JSON.stringify(body) } : {})
      }),
      env,
      { waitUntil() {} }
    )
  }
  const post = (id = 'post') =>
    db
      .prepare('INSERT INTO community_posts (id,user_id,type,content,created_at,updated_at) VALUES (?, ?, ?, ?, 1, 1)')
      .run(id, 'user1', 'share', '学习记录')
  const relation = (from = 'user0', to = 'user1') =>
    db
      .prepare(
        "INSERT INTO study_partners (id,pair_key,from_id,to_id,status,created_at,updated_at) VALUES (?,?,?,?,'accepted',1,1)"
      )
      .run(`${from}-${to}`, [from, to].sort().join(':'), from, to)
  return { db, env, api, post, relation, tokens, hooks }
}

test('Cookie切号广播前的旧账号写入与退出被预期账号头阻止，匹配账号照常执行', async (t) => {
  const { db, env, api, post, tokens } = await fixture(t)
  post()
  const cookieRequest = (path, expectedUser, body) =>
    worker.fetch(
      new Request(`http://localhost${path}`, {
        method: 'POST',
        headers: {
          Cookie: `zsb_session=${tokens.get('user0')}`,
          Origin: 'http://localhost',
          'Content-Type': 'application/json',
          'X-Expected-User-Id': expectedUser
        },
        body: JSON.stringify(body)
      }),
      env,
      { waitUntil() {} }
    )
  const staleWrite = await cookieRequest('/api/community/likes', 'user2', { targetType: 'post', targetId: 'post' })
  assert.equal(staleWrite.status, 409)
  assert.match((await staleWrite.json()).message, /账号已改变/)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM community_likes').get().n, 0)
  const staleLogout = await cookieRequest('/api/auth/logout', 'user2', {})
  assert.equal(staleLogout.status, 409)
  assert.equal(staleLogout.headers.get('Set-Cookie'), null)
  assert.equal((await api('/api/auth/me')).status, 200)
  assert.equal(
    (await cookieRequest('/api/community/likes', 'user0', { targetType: 'post', targetId: 'post' })).status,
    200
  )
  assert.equal(db.prepare('SELECT COUNT(*) n FROM community_likes').get().n, 1)
  const logout = await cookieRequest('/api/auth/logout', 'user0', {})
  assert.equal(logout.status, 200)
  assert.match(logout.headers.get('Set-Cookie'), /Max-Age=0/)
  assert.equal((await api('/api/auth/me')).status, 401)
})

test('改密提交前并发旧密码登录的会话立即失效，新会话与新密码正常', async (t) => {
  const { api, hooks, db } = await fixture(t)
  const entered = deferred(),
    release = deferred()
  hooks.batch = async (statements) => {
    if (statements[0].sql.startsWith('UPDATE users SET password_hash')) {
      hooks.batch = null
      entered.resolve()
      await release.promise
    }
  }
  const change = api('/api/auth/password', 'user0', 'POST', { oldPassword: 'OldPass123', newPassword: 'NewPass123' })
  await entered.promise
  const login = await api('/api/auth/login', 'user0', 'POST', { username: 'user0', password: 'OldPass123' })
  assert.equal(login.status, 200)
  const oldToken = (await login.json()).token
  release.resolve()
  const changed = await change
  assert.equal(changed.status, 200)
  const newToken = (await changed.json()).token
  assert.equal((await api('/api/auth/me', 'user0', 'GET', undefined, oldToken)).status, 401)
  assert.equal((await api('/api/auth/me', 'user0', 'GET', undefined, newToken)).status, 200)
  assert.equal(db.prepare("SELECT session_version FROM users WHERE id='user0'").get().session_version, 1)
  assert.equal(
    (await api('/api/auth/login', 'user0', 'POST', { username: 'user0', password: 'OldPass123' })).status,
    401
  )
  assert.equal(
    (await api('/api/auth/login', 'user0', 'POST', { username: 'user0', password: 'NewPass123' })).status,
    200
  )
})

test('旧密码登录读取凭证后暂停，改密完成再签发不得登记旧版本会话', async (t) => {
  const { api, hooks, db } = await fixture(t)
  const entered = deferred(),
    release = deferred()
  hooks.first = async (sql) => {
    if (sql === 'SELECT * FROM users WHERE username = ?') {
      hooks.first = null
      entered.resolve()
      await release.promise
    }
  }
  const login = api('/api/auth/login', 'user0', 'POST', { username: 'user0', password: 'OldPass123' })
  await entered.promise
  const changed = await api('/api/auth/password', 'user0', 'POST', {
    oldPassword: 'OldPass123',
    newPassword: 'NewPass123'
  })
  assert.equal(changed.status, 200)
  release.resolve()
  assert.equal((await login).status, 401)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM user_sessions').get().n, 1)
})

test('同一旧密码的并发改密只有一次成功，失败者不会清除成功者的新会话', async (t) => {
  const { api, hooks, db } = await fixture(t)
  const wait = barrier(2)
  hooks.first = async (sql) => {
    if (sql === 'SELECT * FROM users WHERE id = ?') await wait()
  }
  const responses = await Promise.all(
    ['NewPass123', 'OtherPass123'].map((newPassword) =>
      api('/api/auth/password', 'user0', 'POST', { oldPassword: 'OldPass123', newPassword })
    )
  )
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409])
  const token = (await responses.find((r) => r.status === 200).json()).token
  hooks.first = null
  assert.equal((await api('/api/auth/me', 'user0', 'GET', undefined, token)).status, 200)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM user_sessions').get().n, 1)
})

test('迁移前无版本 claim 的 JWT 在版本0可用，改密后失效', async (t) => {
  const { api, env, tokens } = await fixture(t)
  const [header, encoded] = tokens.get('user0').split('.')
  const claims = JSON.parse(Buffer.from(encoded, 'base64url'))
  delete claims.sessionVersion
  const unsigned = `${header}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}`
  const legacy = `${unsigned}.${createHmac('sha256', env.JWT_SECRET).update(unsigned).digest('base64url')}`
  assert.equal((await api('/api/auth/me', 'user0', 'GET', undefined, legacy)).status, 200)
  assert.equal(
    (await api('/api/auth/password', 'user0', 'POST', { oldPassword: 'OldPass123', newPassword: 'NewPass123' }, legacy))
      .status,
    200
  )
  assert.equal((await api('/api/auth/me', 'user0', 'GET', undefined, legacy)).status, 401)
})

test('同账号10次并发举报只生成一条待审，5个不同账号才能原子隐藏并通知一次', async (t) => {
  const { api, post, db, hooks } = await fixture(t, 7)
  post()
  let wait = barrier(10)
  hooks.first = async (sql) => {
    if (sql.startsWith('SELECT id FROM community_reports WHERE reporter_id')) await wait()
  }
  const report = (id) =>
    api('/api/community/reports', id, 'POST', { targetType: 'post', targetId: 'post', reason: '广告' })
  const repeated = await Promise.all(Array.from({ length: 10 }, () => report('user0')))
  assert.equal(repeated.filter((r) => r.status === 201).length, 1)
  assert.equal(repeated.filter((r) => r.status === 400).length, 9)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM community_reports').get().n, 1)
  assert.equal(db.prepare("SELECT is_hidden FROM community_posts WHERE id='post'").get().is_hidden, 0)
  wait = barrier(4)
  assert.deepEqual(
    (await Promise.all([2, 3, 4, 5].map((i) => report(`user${i}`)))).map((r) => r.status),
    [201, 201, 201, 201]
  )
  assert.equal(db.prepare("SELECT is_hidden FROM community_posts WHERE id='post'").get().is_hidden, 1)
  assert.equal(db.prepare("SELECT COUNT(*) n FROM community_reports WHERE status='resolved'").get().n, 5)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM community_moderation_log').get().n, 1)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM community_notifications').get().n, 1)
})

test('并发点赞只发一次积分和通知，并发取消仅回收一次且保留其他人的点赞', async (t) => {
  const { api, post, db, hooks } = await fixture(t)
  post()
  db.exec("UPDATE gamification SET points=100 WHERE user_id='user1'")
  const vote = (id) => api('/api/community/likes', id, 'POST', { targetType: 'post', targetId: 'post' })
  let wait = barrier(10)
  hooks.first = async (sql) => {
    if (sql.startsWith('SELECT 1 AS x FROM community_likes')) await wait()
  }
  assert.ok((await Promise.all(Array.from({ length: 10 }, () => vote('user0')))).every((r) => r.status === 200))
  assert.equal(db.prepare('SELECT COUNT(*) n FROM community_likes').get().n, 1)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM points_log').get().n, 1)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM community_notifications').get().n, 1)
  assert.equal(db.prepare("SELECT points FROM gamification WHERE user_id='user1'").get().points, 101)
  hooks.first = null
  await vote('user2')
  wait = barrier(2)
  hooks.first = async (sql) => {
    if (sql.startsWith('SELECT 1 AS x FROM community_likes')) await wait()
  }
  assert.ok((await Promise.all([vote('user0'), vote('user0')])).every((r) => r.status === 200))
  assert.equal(db.prepare('SELECT COUNT(*) n FROM community_likes').get().n, 1)
  assert.equal(db.prepare("SELECT likes_count FROM community_posts WHERE id='post'").get().likes_count, 1)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM points_log').get().n, 1)
  assert.equal(db.prepare("SELECT points FROM gamification WHERE user_id='user1'").get().points, 101)
})

test('百赞里程碑依赖真实点赞，99不发章，第100赞并发仅发一次徽章、通知与广播', async (t) => {
  const { api, post, db, hooks } = await fixture(t)
  post()
  for (let i = 0; i < 98; i++) {
    const id = `historical-like-${i}`
    db.prepare(
      "INSERT INTO users (id,username,password_hash,created_at) SELECT ?,? ,password_hash,1 FROM users WHERE id='user1'"
    ).run(id, id)
    db.prepare("INSERT INTO community_likes (user_id,target_type,target_id,created_at) VALUES (?,'post','post',1)").run(
      id
    )
  }
  db.exec("UPDATE community_posts SET likes_count=98 WHERE id='post'")
  const vote = (userId) => api('/api/community/likes', userId, 'POST', { targetType: 'post', targetId: 'post' })
  const count = (sql) => db.prepare(sql).get().n
  const badgeCount = () => count("SELECT COUNT(*) n FROM user_badges WHERE user_id='user1' AND badge_key='likes_100'")
  const notificationCount = () =>
    count("SELECT COUNT(*) n FROM community_notifications WHERE user_id='user1' AND type='achievement'")
  const broadcastCount = () =>
    count("SELECT COUNT(*) n FROM community_posts WHERE ref_type='badge' AND ref_id='likes_100:user1'")

  assert.equal((await vote('user0')).status, 200)
  assert.equal(count("SELECT COUNT(*) n FROM community_likes WHERE target_type='post' AND target_id='post'"), 99)
  assert.equal(db.prepare("SELECT likes_count FROM community_posts WHERE id='post'").get().likes_count, 99)
  assert.deepEqual([badgeCount(), notificationCount(), broadcastCount()], [0, 0, 0])

  const wait = barrier(2)
  hooks.first = async (sql) => {
    if (sql.startsWith('SELECT 1 AS x FROM community_likes')) await wait()
  }
  assert.ok((await Promise.all([vote('user2'), vote('user2')])).every((response) => response.status === 200))
  hooks.first = null
  assert.equal(count("SELECT COUNT(*) n FROM community_likes WHERE target_type='post' AND target_id='post'"), 100)
  assert.equal(db.prepare("SELECT likes_count FROM community_posts WHERE id='post'").get().likes_count, 100)
  assert.deepEqual([badgeCount(), notificationCount(), broadcastCount()], [1, 1, 1])
  assert.match(
    db.prepare("SELECT content FROM community_notifications WHERE user_id='user1' AND type='achievement'").get()
      .content,
    /百赞达人/
  )
  assert.equal(db.prepare("SELECT points FROM gamification WHERE user_id='user1'").get().points, 2)
  // 徽章记录的是曾达成：取消后再次达到100，也不重复通知或广播。
  assert.equal((await vote('user2')).status, 200)
  assert.equal(db.prepare("SELECT likes_count FROM community_posts WHERE id='post'").get().likes_count, 99)
  assert.equal((await vote('user2')).status, 200)
  assert.deepEqual([badgeCount(), notificationCount(), broadcastCount()], [1, 1, 1])
})

test('并发赞踩保持互斥、计数与实际行一致，积分与通知随最终赞态', async (t) => {
  const { api, post, db, hooks } = await fixture(t)
  post()
  const wait = barrier(2)
  hooks.first = async (sql) => {
    if (/SELECT 1 AS x FROM community_(likes|dislikes)/.test(sql)) await wait()
  }
  const body = { targetType: 'post', targetId: 'post' }
  assert.ok(
    (
      await Promise.all([
        api('/api/community/likes', 'user0', 'POST', body),
        api('/api/community/dislikes', 'user0', 'POST', body)
      ])
    ).every((r) => r.status === 200)
  )
  const likes = db.prepare('SELECT COUNT(*) n FROM community_likes').get().n
  const dislikes = db.prepare('SELECT COUNT(*) n FROM community_dislikes').get().n
  assert.equal(likes + dislikes, 1)
  const counts = db.prepare("SELECT likes_count,dislikes_count FROM community_posts WHERE id='post'").get()
  assert.equal(counts.likes_count, likes)
  assert.equal(counts.dislikes_count, dislikes)
  assert.equal(db.prepare("SELECT points FROM gamification WHERE user_id='user1'").get().points, likes)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM community_notifications').get().n, likes)
})

test('帖子和其评论的赞独立回收，取消帖子赞保留评论积分与通知', async (t) => {
  const { api, post, db } = await fixture(t)
  post()
  db.exec(
    "INSERT INTO community_comments (id,post_id,user_id,content,created_at,updated_at) VALUES ('comment','post','user1','回复',1,1)"
  )
  await api('/api/community/likes', 'user0', 'POST', { targetType: 'post', targetId: 'post' })
  await api('/api/community/likes', 'user0', 'POST', { targetType: 'comment', targetId: 'comment' })
  assert.equal(db.prepare("SELECT points FROM gamification WHERE user_id='user1'").get().points, 2)
  await api('/api/community/likes', 'user0', 'POST', { targetType: 'post', targetId: 'post' })
  assert.equal(db.prepare("SELECT points FROM gamification WHERE user_id='user1'").get().points, 1)
  const notices = db.prepare('SELECT comment_id FROM community_notifications').all()
  assert.equal(notices.length, 1)
  assert.equal(notices[0].comment_id, 'comment')
})

test('周报默认关闭不发送，只有共享数据属主开启的方向推送且重复cron不重发', async (t) => {
  const { api, db, env, relation } = await fixture(t)
  relation()
  assert.equal((await (await api('/api/community/partners/user1/weekly-report')).json()).shared, false)
  await pushWeeklyReports(env)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM community_notifications').get().n, 0)
  db.exec(
    "UPDATE user_settings SET partner_share_enabled=1 WHERE user_id='user1'; UPDATE gamification SET streak=9 WHERE user_id='user1'"
  )
  await Promise.all([pushWeeklyReports(env), pushWeeklyReports(env)])
  const notices = db.prepare('SELECT user_id,actor_id,content FROM community_notifications').all()
  assert.equal(notices.length, 1)
  assert.equal(notices[0].user_id, 'user0')
  assert.equal(notices[0].actor_id, 'user1')
  assert.match(notices[0].content, /连续打卡 9 天/)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM weekly_report_push_log').get().n, 1)
})

test('历史周报失去共享许可或已解绑会出队；生成统计后关闭开关也不会落库通知', async (t) => {
  const { db, env, relation, hooks } = await fixture(t)
  relation()
  db.exec(
    `INSERT INTO weekly_report_push_pending VALUES ('2026-09-21','user1','user0',1),('2026-09-21','user2','user0',1)`
  )
  await pushWeeklyReports(env)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM weekly_report_push_pending').get().n, 0)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM community_notifications').get().n, 0)
  db.exec("UPDATE user_settings SET partner_share_enabled=1 WHERE user_id='user1'")
  hooks.batch = async (statements) => {
    if (statements[0].sql.includes('INSERT OR IGNORE INTO weekly_report_push_log')) {
      hooks.batch = null
      db.exec("UPDATE user_settings SET partner_share_enabled=0 WHERE user_id='user1'")
    }
  }
  await pushWeeklyReports(env)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM community_notifications').get().n, 0)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM weekly_report_push_log').get().n, 0)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM weekly_report_push_pending').get().n, 0)
})

test('28方向首批发送失败全部持久化，跨周恢复原week_key并保持幂等', async (t) => {
  let now = Date.parse('2026-10-05T08:00:00+08:00')
  t.mock.method(Date, 'now', () => now)
  const { db, env, relation, hooks } = await fixture(t, 16)
  for (let i = 2; i < 16; i++) relation('user0', `user${i}`)
  db.exec('UPDATE user_settings SET partner_share_enabled=1')
  hooks.run = async (sql) => {
    if (sql.includes('INSERT INTO community_notifications')) throw new Error('injected send failure')
  }
  await assert.rejects(pushWeeklyReports(env), /injected send failure/)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM weekly_report_push_pending').get().n, 28)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM weekly_report_push_log').get().n, 0)
  hooks.run = null
  now += 7 * 86400000
  await pushWeeklyReports(env)
  assert.equal(db.prepare("SELECT COUNT(*) n FROM weekly_report_push_log WHERE week_key='2026-09-28'").get().n, 28)
  assert.equal(db.prepare("SELECT COUNT(*) n FROM weekly_report_push_log WHERE week_key='2026-10-05'").get().n, 28)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM community_notifications').get().n, 56)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM weekly_report_push_pending').get().n, 0)
  await pushWeeklyReports(env)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM community_notifications').get().n, 56)
})

test('搭子推荐、已绑定列表和待接受请求遵守主页学习统计授权', async (t) => {
  const { api, db, relation } = await fixture(t)
  db.exec("UPDATE gamification SET points=321 WHERE user_id='user1'")
  for (const visibility of ['public', 'login', 'private']) {
    for (const shared of [0, 1]) {
      db.prepare("UPDATE user_settings SET profile_visibility=?,share_learning_stats=? WHERE user_id='user1'").run(
        visibility,
        shared
      )
      const data = await (await api('/api/community/partners/suggestions')).json()
      const candidate = data.suggestions.find((r) => r.userId === 'user1')
      assert.equal(candidate.totalPoints, shared && visibility !== 'private' ? 321 : undefined)
    }
  }
  relation()
  const lists = await (await api('/api/community/partners')).json()
  assert.equal(lists.partners[0].totalPoints, undefined)
  db.exec("UPDATE study_partners SET status='pending',from_id='user1',to_id='user0'")
  const incoming = await (await api('/api/community/partners')).json()
  assert.equal(incoming.incoming[0].totalPoints, undefined)
})

test('推荐时段使用毫秒契约，08:00/20:00分别匹配且31天前记录不参与', async (t) => {
  t.mock.method(Date, 'now', () => Date.parse('2026-10-06T12:00:00+08:00'))
  const { api, db } = await fixture(t, 4)
  const insert = db.prepare(
    'INSERT INTO study_records (id,user_id,subject_id,date,minutes,created_at) VALUES (?,?,?,?,?,?)'
  )
  const record = (id, user, time, minutes = 60) => insert.run(id, user, 'math', '2026-10-05', minutes, Date.parse(time))
  record('mine', 'user0', '2026-10-05T08:00:00+08:00')
  record('same', 'user1', '2026-10-05T08:00:00+08:00')
  record('different', 'user2', '2026-10-05T20:00:00+08:00')
  record('old', 'user3', '2026-09-05T08:00:00+08:00', 10000)
  const { suggestions } = await (await api('/api/community/partners/suggestions')).json()
  assert.deepEqual(suggestions.find((r) => r.userId === 'user1').reasons, ['学习时段相近'])
  assert.deepEqual(suggestions.find((r) => r.userId === 'user2').reasons, [])
  assert.deepEqual(suggestions.find((r) => r.userId === 'user3').reasons, [])
  db.exec("DELETE FROM study_records WHERE user_id='user0'")
  record('mine20', 'user0', '2026-10-05T20:00:00+08:00')
  const second = (await (await api('/api/community/partners/suggestions')).json()).suggestions
  assert.deepEqual(second.find((r) => r.userId === 'user2').reasons, ['学习时段相近'])
  assert.deepEqual(second.find((r) => r.userId === 'user1').reasons, [])
})

test('0010旧库迁移保留待审业务一条、保存重复审计历史并兼容老会话版本', async () => {
  const db = new DatabaseSync(':memory:')
  try {
    db.exec(
      schema
        .replace(/^.*session_version INTEGER.*\r?\n/m, '')
        .replace(
          /CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_pending_reporter\s+ON community_reports\(reporter_id, target_type, target_id\) WHERE status = 'pending';/,
          ''
        )
    )
    db.exec(`INSERT INTO users(id,username,password_hash,created_at) VALUES ('owner','owner','oldhash',1);
      INSERT INTO community_reports VALUES ('r1','owner','post','p','广告','','pending',1),
      ('r2','owner','post','p','广告','','pending',2),('r3','owner','post','p','广告','','resolved',3)`)
    db.exec(await readFile(new URL('../migrations/0010_auth_sessions_reports.sql', import.meta.url), 'utf8'))
    assert.equal(db.prepare('SELECT session_version FROM users').get().session_version, 0)
    assert.equal(db.prepare("SELECT COUNT(*) n FROM community_reports WHERE status='pending'").get().n, 1)
    assert.equal(db.prepare('SELECT COUNT(*) n FROM community_reports').get().n, 3)
    assert.throws(
      () => db.exec("INSERT INTO community_reports VALUES ('r4','owner','post','p','广告','','pending',4)"),
      /UNIQUE/
    )
  } finally {
    db.close()
  }
})
