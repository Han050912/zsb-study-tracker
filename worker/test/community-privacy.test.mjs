import test, { beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { build } from 'esbuild'
import { readFile, mkdir, writeFile, unlink } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const compiled = await build({
  stdin: {
    contents: `import { registerUsersRoutes } from './worker/src/api/community/users';
      import { registerPostsRoutes } from './worker/src/api/community/posts';
      import { registerBoardsRoutes } from './worker/src/api/community/boards';
      import { registerAuthRoutes } from './worker/src/api/auth';
      export { getSettings, settingsReplaceStatements, settingsBodySchema } from './worker/src/api/settings';
      export { route } from './worker/src/router';
      registerUsersRoutes(); registerPostsRoutes(); registerAuthRoutes(); registerBoardsRoutes();`,
    resolveDir: process.cwd()
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  plugins: [
    {
      name: 'api-boundaries',
      setup(builder) {
        builder.onResolve({ filter: /(?:middleware\/(?:auth|rateLimit)|\/sensitive)$/ }, ({ path }) => ({
          path,
          namespace: 'boundary'
        }))
        builder.onLoad({ filter: /.*/, namespace: 'boundary' }, ({ path }) => ({
          contents: path.endsWith('auth')
            ? `export async function resolveAuth(request) { return { userId: request.headers.get('X-Test-User') || '', role: 'user' } }; export const tryGetAuth = resolveAuth; export const isDbAdmin = async () => false; export const authCookieHeader = () => ''; export const clearAuthCookieHeader = () => ''; export const extractToken = () => '';`
            : path.endsWith('rateLimit')
              ? 'export async function rateLimit() {}'
              : 'export function assertCleanLocal() { return { flagged: false } }; export async function assertCleanAsync() { return { flagged: false } }'
        }))
      }
    }
  ]
})
await mkdir('.cache/community-tests', { recursive: true })
const filename = resolve('.cache/community-tests', `${crypto.randomUUID()}.mjs`)
await writeFile(filename, compiled.outputFiles[0].text)
const { route, getSettings, settingsReplaceStatements, settingsBodySchema } = await import(pathToFileURL(filename).href)
await unlink(filename)
const schema = await readFile(new URL('../schema.sql', import.meta.url), 'utf8')
let db, env
function statement(sql, values = []) {
  return {
    bind: (...args) => statement(sql, args),
    first: async () => db.prepare(sql).get(...values) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...values) }),
    run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...values).changes) } })
  }
}
beforeEach(() => {
  db = new DatabaseSync(':memory:')
  db.exec(schema)
  env = {
    JWT_SECRET: 'test-secret',
    DESKTOP_TOKEN: 'test-desktop',
    DB: {
      prepare: statement,
      batch: async (items) => {
        db.exec('BEGIN')
        try {
          const results = []
          for (const item of items) results.push(await item.run())
          db.exec('COMMIT')
          return results
        } catch (error) {
          db.exec('ROLLBACK')
          throw error
        }
      }
    }
  }
  for (const [id, code] of [
    ['owner', 'ABCDEFGH'],
    ['visitor', 'BCDEFGHJ']
  ]) {
    db.prepare('INSERT INTO users(id,user_code,username,password_hash,created_at) VALUES(?,?,?,?,1)').run(
      id,
      code,
      `login-${id}`,
      'unused'
    )
    db.prepare('INSERT INTO user_settings(user_id,user_name,profile_visibility) VALUES(?,?,?)').run(
      id,
      '升本人',
      'public'
    )
    db.prepare('INSERT INTO gamification(user_id,points,streak) VALUES(?,32,1)').run(id)
  }
})
afterEach(() => db.close())
const api = (path, user = 'visitor', method = 'GET', body) =>
  route(
    new Request(`http://localhost${path}`, {
      method,
      headers: { 'X-Test-User': user, 'Content-Type': 'application/json', 'X-Desktop-Token': 'test-desktop' },
      ...(body ? { body: JSON.stringify(body) } : {})
    }),
    env
  ).catch((error) => {
    if (!error.status) throw error
    return Response.json({ error: error.message }, { status: error.status })
  })

test('主页默认保留社区资料，但不同登录用户和访客均无法读学习统计/积分/连续打卡', async () => {
  for (const viewer of ['visitor', '']) {
    const response = await api('/api/community/users/owner/profile', viewer)
    assert.equal(response.status, 200)
    const profile = await response.json()
    assert.equal(profile.userName, '升本人-ABCDEFGH')
    assert.equal(profile.learningStatsPrivate, true)
    assert.equal('points' in profile, false)
    assert.equal('streak' in profile, false)
    assert.equal(profile.threadsCount, 0)
    assert.equal(profile.followers, 0)
  }
  assert.equal((await api('/api/community/users/owner/stats')).status, 403)
  const self = await (await api('/api/community/users/owner/profile', 'owner')).json()
  assert.equal(self.learningStatsPrivate, false)
  assert.equal(self.points, 32)
  assert.equal(self.streak, 1)
  assert.equal((await api('/api/community/users/owner/stats', 'owner')).status, 200)
})

test('公开学习开关可持久化与撤回；主页可见性仍先限制访问', async () => {
  let settings = await getSettings(env, 'owner')
  assert.equal(settings.shareLearningStats, false)
  assert.equal(settingsBodySchema.safeParse({ shareLearningStats: 'yes' }).success, false)
  for (const enabled of [true, false]) {
    await env.DB.batch(
      await settingsReplaceStatements(env, 'owner', {
        ...settings,
        shareLearningStats: enabled,
        maimemoToken: enabled ? 'maimemo-test-token' : undefined
      })
    )
    settings = await getSettings(env, 'owner')
    assert.equal(settings.shareLearningStats, enabled)
    const profile = await (await api('/api/community/users/owner/profile')).json()
    assert.equal(profile.learningStatsPrivate, !enabled)
    assert.equal('points' in profile, enabled)
    assert.equal((await api('/api/community/users/owner/stats')).status, enabled ? 200 : 403)
  }
  db.exec("UPDATE user_settings SET share_learning_stats=1, profile_visibility='private' WHERE user_id='owner'")
  assert.equal((await api('/api/community/users/owner/stats')).status, 403)
  const privateProfile = await (await api('/api/community/users/owner/profile')).json()
  assert.equal(privateProfile.profilePrivate, true)
  assert.equal('points' in privateProfile, false)
})

test('本人和授权访客学习总览同时包含手动记录与番茄专注分钟，并按日期合并', async () => {
  const today = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10)
  db.exec("UPDATE user_settings SET share_learning_stats=1 WHERE user_id='owner'")
  db.prepare('INSERT INTO study_records(id,user_id,subject_id,date,minutes,created_at) VALUES(?,?,?,?,20,1)').run(
    'record',
    'owner',
    'math',
    today
  )
  db.prepare('INSERT INTO pomodoro_daily(user_id,date,count,minutes) VALUES(?,?,1,1)').run('owner', today)
  for (const viewer of ['owner', 'visitor']) {
    const response = await api('/api/community/users/owner/stats', viewer)
    assert.equal(response.status, 200)
    const stats = await response.json()
    assert.equal(stats.totalStudy.minutes, 21)
    assert.equal(stats.totalStudy.days, 1)
    assert.equal(stats.monthStudy.minutes, 21)
    assert.equal(stats.heatmap.find((day) => day.date === today).minutes, 21)
  }
})

test('注册默认昵称带唯一用户短码，旧默认名在帖子与评论中稳定且区分作者', async () => {
  const registration = await api('/api/auth/register', '', 'POST', { username: 'new-account', password: 'abc12345' })
  assert.equal(registration.status, 201)
  const registered = await registration.json()
  const settings = await getSettings(env, registered.user.id)
  assert.equal(settings.userName, `升本人-${registered.user.userCode}`)
  assert.notEqual(settings.userName, 'new-account')
  db.exec(
    "INSERT INTO community_posts(id,user_id,type,content,created_at,updated_at) VALUES('post','owner','share','分享解题方法',1,1)"
  )
  db.exec(
    "INSERT INTO community_comments(id,post_id,user_id,content,created_at,updated_at) VALUES('comment','post','visitor','谢谢分享',2,2)"
  )
  const detail = await (await api('/api/community/posts/post?paginate=1')).json()
  assert.equal(detail.post.userName, '升本人-ABCDEFGH')
  assert.equal('userPoints' in detail.post, false)
  assert.equal(detail.comments[0].userName, '升本人-BCDEFGHJ')
  assert.notEqual(detail.post.userName, detail.comments[0].userName)
  const again = await (await api('/api/community/posts/post?paginate=1')).json()
  assert.equal(again.comments[0].userName, detail.comments[0].userName)
  const ownerDetail = await (await api('/api/community/posts/post?paginate=1', 'owner')).json()
  assert.equal(ownerDetail.post.userPoints, 32)
  const feed = await (await api('/api/community/posts')).json()
  assert.equal('userPoints' in feed.posts[0], false)
  const profilePosts = await (await api('/api/community/users/owner/posts')).json()
  assert.equal('userPoints' in profilePosts.posts[0], false)
  db.exec("UPDATE user_settings SET share_learning_stats=1 WHERE user_id='owner'")
  const shared = await (await api('/api/community/posts/post?paginate=1')).json()
  assert.equal(shared.post.userPoints, 32)
  db.exec("UPDATE user_settings SET profile_visibility='private' WHERE user_id='owner'")
  const privateAuthor = await (await api('/api/community/posts/post?paginate=1')).json()
  assert.equal('userPoints' in privateAuthor.post, false)
  db.exec("UPDATE user_settings SET profile_visibility='login' WHERE user_id='owner'")
  const anonymous = await (await api('/api/community/posts/post?paginate=1', '')).json()
  assert.equal('userPoints' in anonymous.post, false)
  const authorized = await (await api('/api/community/posts/post?paginate=1')).json()
  assert.equal(authorized.post.userPoints, 32)
})

test('没有短码的旧 UUID 账号默认名符合昵称长度限制，可正常同步设置', async () => {
  const id = 'e90bdb46-4c49-4e98-a0c3-05679f9afff1'
  db.prepare('INSERT INTO users(id,username,password_hash,created_at) VALUES(?,?,?,1)').run(
    id,
    'private-login',
    'unused'
  )
  const settings = await getSettings(env, id)
  assert.ok(settings.userName.length <= 30)
  assert.equal(settingsBodySchema.safeParse(settings).success, true)
  await env.DB.batch(await settingsReplaceStatements(env, id, { ...settings, theme: 'dark' }))
  assert.equal((await getSettings(env, id)).userName, settings.userName)
})

test('旧库应用学习隐私迁移后已有昵称保留且所有账号默认不公开', async () => {
  const legacy = new DatabaseSync(':memory:')
  try {
    legacy.exec(
      "CREATE TABLE user_settings(user_id TEXT PRIMARY KEY,user_name TEXT); INSERT INTO user_settings VALUES('old','已选昵称')"
    )
    legacy.exec(await readFile(new URL('../migrations/0007_profile_learning_privacy.sql', import.meta.url), 'utf8'))
    const row = legacy.prepare('SELECT * FROM user_settings').get()
    assert.equal(row.user_name, '已选昵称')
    assert.equal(row.share_learning_stats, 0)
  } finally {
    legacy.close()
  }
})

test('推荐关注对象的积分遵守学习公开和主页可见性', async () => {
  const today = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10)
  db.prepare(
    "INSERT INTO study_records(user_id,id,subject_id,date,minutes,created_at,updated_at) VALUES('owner','recent','math',?,30,1,1)"
  ).run(today)
  let recommended = (await (await api('/api/community/recommend')).json()).users
  assert.equal(recommended[0].userId, 'owner')
  assert.equal('totalPoints' in recommended[0], false)
  db.exec("UPDATE user_settings SET share_learning_stats=1 WHERE user_id='owner'")
  recommended = (await (await api('/api/community/recommend')).json()).users
  assert.equal(recommended[0].totalPoints, 32)
  db.exec("UPDATE user_settings SET profile_visibility='private' WHERE user_id='owner'")
  recommended = (await (await api('/api/community/recommend')).json()).users
  assert.equal('totalPoints' in recommended[0], false)
})

test('打卡榜不绕过学习隐私，公开且允许访问主页的用户才上榜', async () => {
  const today = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10)
  db.prepare("UPDATE gamification SET last_checkin=? WHERE user_id='owner'").run(today)
  db.prepare("INSERT INTO points_log(user_id,date,points,reason) VALUES('owner',?,2,'学习打卡')").run(today)
  let board = await (await api('/api/community/leaderboard')).json()
  assert.deepEqual(board.today, [])
  assert.deepEqual(board.streak, [])
  db.exec("UPDATE user_settings SET share_learning_stats=1 WHERE user_id='owner'")
  board = await (await api('/api/community/leaderboard')).json()
  assert.equal(board.today[0].userName, '升本人-ABCDEFGH')
  assert.equal(board.streak[0].totalPoints, 32)
  db.exec("UPDATE user_settings SET profile_visibility='private' WHERE user_id='owner'")
  board = await (await api('/api/community/leaderboard')).json()
  assert.deepEqual(board.today, [])
  assert.deepEqual(board.streak, [])
})
