import test, { beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { build } from 'esbuild'
import { readFile, mkdir, writeFile, unlink } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const root = fileURLToPath(new URL('../../', import.meta.url))
const code = await build({
  stdin: {
    contents: `import { registerTeamsRoutes } from './worker/src/api/teams/teams'; import { registerChallengeRoutes } from './worker/src/api/teams/challenges'; import { registerPostsRoutes } from './worker/src/api/community/posts'; export { route } from './worker/src/router'; registerTeamsRoutes(); registerChallengeRoutes(); registerPostsRoutes();`,
    resolveDir: root
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  plugins: [
    {
      name: 'local-auth',
      setup(builder) {
        builder.onResolve({ filter: /middleware\/(auth|rateLimit)$/ }, (args) => ({
          path: args.path,
          namespace: 'mock'
        }))
        builder.onLoad({ filter: /.*/, namespace: 'mock' }, (args) => ({
          contents: args.path.endsWith('auth')
            ? `export async function resolveAuth(request) { return { userId: request.headers.get('X-Test-User') || '', role: 'user' } }; export const tryGetAuth = resolveAuth; export const isDbAdmin = async () => false;`
            : `export async function rateLimit() {}`
        }))
      }
    }
  ]
})
const dir = path.join(root, '.cache/refactor-tests')
await mkdir(dir, { recursive: true })
const filename = path.join(dir, `api-${crypto.randomUUID()}.mjs`)
await writeFile(filename, code.outputFiles[0].text)
const { route } = await import(pathToFileURL(filename).href)
await unlink(filename)
const schema = await readFile(new URL('../schema.sql', import.meta.url), 'utf8')
let db, env, beforeBatch
function statement(sql, args = []) {
  return {
    bind: (...values) => statement(sql, values),
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    first: async () => db.prepare(sql).get(...args) ?? null,
    run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...args).changes) } })
  }
}
beforeEach(() => {
  db = new DatabaseSync(':memory:')
  db.exec(schema)
  beforeBatch = null
  env = {
    DB: {
      prepare: (sql) => statement(sql),
      batch: async (statements) => {
        beforeBatch?.()
        beforeBatch = null
        db.exec('BEGIN')
        try {
          const result = []
          for (const sql of statements) result.push(await sql.run())
          db.exec('COMMIT')
          return result
        } catch (error) {
          db.exec('ROLLBACK')
          throw error
        }
      }
    },
    IMAGES: { delete: async () => {} }
  }
  for (const id of ['leader', 'member', 'other'])
    db.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, 1)').run(id, id, 'unused')
  db.exec(
    "INSERT INTO study_teams (id,name,creator_id,member_count,created_at) VALUES ('team','高数冲刺','leader',2,100)"
  )
  db.exec(
    "INSERT INTO team_members (team_id,user_id,role,joined_at) VALUES ('team','leader','leader',1),('team','member','member',2)"
  )
})
afterEach(() => db.close())
async function api(url, user = 'leader', method = 'GET', body) {
  return route(
    new Request('http://localhost' + url, {
      method,
      headers: { 'X-Test-User': user, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {})
    }),
    env
  )
}
test('transfer-and-leave: 同批转让、退出、成员计数与通知', async () => {
  const response = await api('/api/teams/team/transfer-and-leave', 'leader', 'POST', { newLeaderId: 'member' })
  assert.equal(response.status, 200)
  assert.equal(db.prepare("SELECT creator_id FROM study_teams WHERE id='team'").get().creator_id, 'member')
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM team_members WHERE team_id='team'").get().n, 1)
  assert.equal(db.prepare("SELECT role FROM team_members WHERE user_id='member'").get().role, 'leader')
  await assert.rejects(
    api('/api/teams/team/transfer-and-leave', 'leader', 'POST', { newLeaderId: 'member' }),
    (e) => e.status === 403
  )
})
test('transfer-and-leave: 中途失败整批回滚，目标成员在校验后离开也不丢队长', async () => {
  db.exec("CREATE TRIGGER fail_exit BEFORE DELETE ON team_members BEGIN SELECT RAISE(ABORT,'test rollback'); END")
  await assert.rejects(api('/api/teams/team/transfer-and-leave', 'leader', 'POST', { newLeaderId: 'member' }))
  assert.equal(db.prepare("SELECT creator_id FROM study_teams WHERE id='team'").get().creator_id, 'leader')
  assert.equal(db.prepare("SELECT role FROM team_members WHERE user_id='member'").get().role, 'member')
  db.exec('DROP TRIGGER fail_exit')
  beforeBatch = () => db.exec("DELETE FROM team_members WHERE user_id='member'")
  await assert.rejects(
    api('/api/teams/team/transfer-and-leave', 'leader', 'POST', { newLeaderId: 'member' }),
    (e) => e.status === 409
  )
  assert.equal(db.prepare("SELECT role FROM team_members WHERE user_id='leader'").get().role, 'leader')
})
test('sync-active: 五个 active 挑战一轮返回，排除未开始/取消/结束，并验证成员权限', async () => {
  const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)
  for (let i = 0; i < 5; i++) {
    db.prepare(
      'INSERT INTO team_challenges (id,team_id,type,target,duration_days,start_date,end_date,created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run('c' + i, 'team', 'minutes', 100, 1, today, today, i)
    for (const id of ['leader', 'member'])
      db.prepare(
        'INSERT INTO team_challenge_progress (challenge_id,user_id,current_value,is_completed) VALUES (?, ?, 0, 0)'
      ).run('c' + i, id)
  }
  db.exec("UPDATE team_challenges SET is_cancelled=1 WHERE id='c4'")
  const result = await (await api('/api/teams/team/sync-active', 'leader', 'POST')).json()
  assert.equal(result.challenges.length, 5)
  assert.equal(result.challenges.filter((c) => c.status === 'active').length, 4)
  assert.equal(result.challenges[0].status, 'cancelled')
  await assert.rejects(api('/api/teams/team/sync-active', 'other', 'POST'), (e) => e.status === 403)
})

test('退出并发转让：校验后接任队长不能被旧退出请求删除', async () => {
  beforeBatch = () =>
    db.exec(
      "UPDATE team_members SET role='member' WHERE user_id='leader'; UPDATE team_members SET role='leader' WHERE user_id='member'; UPDATE study_teams SET creator_id='member' WHERE id='team'"
    )
  await assert.rejects(api('/api/teams/team/leave', 'member', 'POST'), (e) => e.status === 409)
  assert.equal(db.prepare("SELECT role FROM team_members WHERE user_id='member'").get().role, 'leader')
  assert.equal(db.prepare("SELECT member_count FROM study_teams WHERE id='team'").get().member_count, 2)
})

test('帖子关键词搜索：中文和通配符按原文匹配，隐藏内容不泄漏', async () => {
  const insert = db.prepare(
    'INSERT INTO community_posts (id,user_id,type,content,created_at,updated_at,is_hidden) VALUES (?, ?, ?, ?, 100, 1, ?)'
  )
  insert.run('a', 'leader', 'share', '复习100%_高数', 0)
  insert.run('b', 'leader', 'share', '复习1000分', 0)
  insert.run('c', 'leader', 'share', '复习100%_隐藏', 1)
  const result = await (await api('/api/community/posts?keyword=' + encodeURIComponent('100%_'))).json()
  assert.deepEqual(
    result.posts.map((p) => p.id),
    ['a']
  )
})
test('小队列表过滤/稳定游标和局部查询，私密组不会泄漏', async () => {
  for (let i = 0; i < 25; i++)
    db.prepare(
      'INSERT INTO study_teams (id,name,creator_id,member_count,max_members,created_at) VALUES (?, ?, ?, 2, 4, 100)'
    ).run('t' + String(i).padStart(2, '0'), '高数' + i, 'leader')
  const first = await (await api('/api/teams?paged=1&keyword=高数&capacity=available')).json()
  const second = await (
    await api('/api/teams?paged=1&keyword=高数&capacity=available&cursor=' + encodeURIComponent(first.nextCursor))
  ).json()
  assert.equal(first.teams.length, 20)
  assert.equal(new Set([...first.teams, ...second.teams].map((t) => t.id)).size, 26)
  const members = await (await api('/api/teams/team?section=members')).json()
  assert.equal(members.members.length, 2)
  assert.equal(members.challenges.length, 0)
  db.exec("UPDATE study_teams SET is_public=0 WHERE id='team'")
  await assert.rejects(api('/api/teams/team?section=members', 'other'), (e) => e.status === 403)
})
test('评论分页: 20 条根评论、回复按需、锚点定位、隐藏评论/父级权限与计数', async () => {
  db.exec(
    "INSERT INTO community_posts (id,user_id,type,content,created_at,updated_at) VALUES ('post','leader','question','微积分',1,1)"
  )
  for (let i = 0; i < 45; i++)
    db.prepare(
      'INSERT INTO community_comments (id,post_id,user_id,content,created_at,updated_at) VALUES (?, ?, ?, ?, ?, 1)'
    ).run('r' + String(i).padStart(2, '0'), 'post', 'member', '回答', 100)
  for (let i = 0; i < 25; i++)
    db.prepare(
      'INSERT INTO community_comments (id,post_id,user_id,parent_id,content,created_at,updated_at) VALUES (?, ?, ?, ?, ?, ?, 1)'
    ).run('reply' + i, 'post', 'member', 'r44', '回复', i + 200)
  const page = await (await api('/api/community/posts/post?paginate=1&sort=latest')).json()
  assert.equal(page.comments.length, 20)
  assert.equal(page.comments[0].replyCount, 25)
  assert.equal(
    page.comments.some((c) => c.parentId),
    false
  )
  const next = await (
    await api('/api/community/posts/post/comments?sort=latest&cursor=' + encodeURIComponent(page.nextCursor))
  ).json()
  assert.equal(new Set([...page.comments, ...next.comments].map((c) => c.id)).size, 40)
  const replies = await (await api('/api/community/posts/post/comments?parentId=r44')).json()
  assert.equal(replies.comments.length, 20)
  assert.ok(replies.nextCursor)
  const anchor = await (await api('/api/community/posts/post/comments?aroundCommentId=reply24')).json()
  assert.deepEqual(new Set(anchor.comments.map((c) => c.id)), new Set(['r44', 'reply24']))
  db.exec("UPDATE community_comments SET is_hidden=1 WHERE id='r44'")
  await assert.rejects(api('/api/community/posts/post/comments?aroundCommentId=reply24'), (e) => e.status === 404)
  await assert.rejects(api('/api/community/posts/post/comments?parentId=r44'), (e) => e.status === 404)
})
