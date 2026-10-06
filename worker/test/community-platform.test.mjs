import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { build } from 'esbuild'
import { readFile, mkdir, writeFile, unlink } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

const built = await build({
  stdin: {
    contents: `import { registerPostsRoutes } from './worker/src/api/community/posts'; export { route } from './worker/src/router'; registerPostsRoutes();`,
    resolveDir: process.cwd()
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  plugins: [
    {
      name: 'test-boundaries',
      setup(builder) {
        builder.onResolve({ filter: /(?:middleware\/(auth|rateLimit)|\/sensitive)$/ }, ({ path }) => ({
          path,
          namespace: 'boundary'
        }))
        builder.onLoad({ filter: /.*/, namespace: 'boundary' }, ({ path }) => ({
          contents: path.endsWith('/auth')
            ? `export const resolveAuth = async () => ({userId:'me', role:'user'}); export const tryGetAuth = resolveAuth; export const isDbAdmin = async () => false;`
            : path.endsWith('/rateLimit')
              ? `export async function rateLimit() {}`
              : `export async function assertCleanAsync() { return {flagged:false} }; export function assertCleanLocal() { return {flagged:false} }`
        }))
      }
    }
  ]
})
await mkdir('.cache/community-platform', { recursive: true })
const file = resolve('.cache/community-platform', `${crypto.randomUUID()}.mjs`)
await writeFile(file, built.outputFiles[0].text)
const { route } = await import(pathToFileURL(file).href)
await unlink(file)
const schema = await readFile(new URL('../schema.sql', import.meta.url), 'utf8')

function fixture(t) {
  const db = new DatabaseSync(':memory:')
  db.exec(schema)
  t.after(() => db.close())
  let failDelete = false
  const statement = (sql, values = []) => {
    assert.ok(values.length <= 100, `D1 bind limit: ${values.length}`)
    if (/\bLIKE\b/i.test(sql))
      for (const value of values)
        if (typeof value === 'string') assert.ok(Buffer.byteLength(value) <= 50, 'D1 LIKE byte limit')
    return {
      sql,
      values,
      bind: (...args) => statement(sql, args),
      first: async () => db.prepare(sql).get(...values) ?? null,
      all: async () => ({ results: db.prepare(sql).all(...values) }),
      run: async () => {
        if (failDelete && sql.startsWith('DELETE FROM community_comments')) throw new Error('injected failure')
        return { meta: { changes: Number(db.prepare(sql).run(...values).changes) } }
      }
    }
  }
  const env = {
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
    },
    IMAGES: { delete: async () => {} }
  }
  for (const id of ['me', 'owner'])
    db.prepare('INSERT INTO users(id,username,password_hash,created_at) VALUES(?,?,?,1)').run(id, id, 'unused')
  const post = (id, createdAt, pinned = 0, content = 'Safe content', tags = '[]') =>
    db
      .prepare(
        'INSERT INTO community_posts(id,user_id,type,content,tags,is_pinned,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)'
      )
      .run(id, 'owner', 'share', content, tags, pinned, createdAt, createdAt)
  const api = (path, method = 'GET') =>
    route(new Request(`https://test.invalid${path}`, { method }), env).catch((e) => {
      if (e.status) return Response.json({ error: e.message }, { status: e.status })
      throw e
    })
  return {
    db,
    post,
    api,
    fail: () => {
      failDelete = true
    }
  }
}

test('latest分页包含置顶排序键，同秒/多个置顶与普通帖子均不重复遗漏', async (t) => {
  const { post, api } = fixture(t)
  for (const row of [
    ['pin-b', 100, 1],
    ['pin-a', 100, 1],
    ['normal-b', 300, 0],
    ['normal-a', 300, 0],
    ['old', 50, 0]
  ])
    post(...row)
  let cursor = '',
    ids = []
  do {
    const response = await api('/api/community/posts?limit=1' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''))
    assert.equal(response.status, 200)
    const data = await response.json()
    ids.push(...data.posts.map((p) => p.id))
    cursor = data.nextCursor
  } while (cursor)
  assert.deepEqual(ids, ['pin-b', 'pin-a', 'normal-b', 'normal-a', 'old'])
  const legacy = await (await api('/api/community/posts?limit=5&cursor=100_pin-a')).json()
  assert.deepEqual(
    legacy.posts.map((p) => p.id),
    ['normal-b', 'normal-a', 'old']
  )
  assert.equal((await api('/api/community/posts?cursor=latest:2:100:pin-a')).status, 400)
  assert.equal((await api('/api/community/posts?cursor=100_missing')).status, 400)
})

test('长中文搜索与特殊符号按字面匹配，标签使用JSON元素等值而非LIKE', async (t) => {
  const { post, api } = fixture(t)
  const keyword = '中文'.repeat(50)
  const tag = '高数复习'.repeat(5)
  post('long', 100, 0, `${keyword} A_%\\ literal`, JSON.stringify([tag, '带"引号']))
  for (const query of [
    'keyword=' + encodeURIComponent(keyword),
    'keyword=' + encodeURIComponent('a_%\\'),
    'tag=' + encodeURIComponent(tag),
    'tag=' + encodeURIComponent('带"引号')
  ]) {
    const data = await (await api('/api/community/posts?' + query)).json()
    assert.deepEqual(
      data.posts.map((p) => p.id),
      ['long']
    )
  }
  assert.deepEqual((await (await api('/api/community/posts?tag=' + encodeURIComponent('高数'))).json()).posts, [])
})

function thread(db, post) {
  post('thread', 100)
  db.exec("UPDATE community_posts SET comments_count=121, accepted_answer_id='root', is_resolved=1 WHERE id='thread'")
  const comment = db.prepare(
    'INSERT INTO community_comments(id,post_id,user_id,parent_id,content,created_at,updated_at) VALUES(?,?,?,?,?,1,1)'
  )
  comment.run('root', 'thread', 'me', null, 'Root')
  for (let i = 0; i < 120; i++) {
    const id = 'reply' + i
    comment.run(id, 'thread', 'owner', 'root', 'Reply')
    db.prepare("INSERT INTO community_likes(user_id,target_type,target_id,created_at) VALUES('me','comment',?,1)").run(
      id
    )
    db.prepare(
      "INSERT INTO community_notifications(id,user_id,type,comment_id,content,created_at) VALUES(?,'owner','like',?,'Like',1)"
    ).run('n' + i, id)
    db.prepare(
      "INSERT INTO community_reports(id,reporter_id,target_type,target_id,reason,status,created_at) VALUES(?,'me','comment',?,'广告','pending',1)"
    ).run('r' + i, id)
  }
}
test('120条回复删除遵守100绑定上限，清理关联并一次回退计数和采纳', async (t) => {
  const { db, post, api } = fixture(t)
  thread(db, post)
  const response = await api('/api/community/comments/root', 'DELETE')
  assert.equal(response.status, 200)
  assert.equal((await response.json()).removed, 121)
  for (const table of ['community_comments', 'community_likes', 'community_notifications', 'community_reports'])
    assert.equal(db.prepare(`SELECT count(*) n FROM ${table}`).get().n, 0)
  assert.deepEqual(
    {
      ...db
        .prepare("SELECT comments_count, accepted_answer_id, is_resolved FROM community_posts WHERE id='thread'")
        .get()
    },
    { comments_count: 0, accepted_answer_id: null, is_resolved: 0 }
  )
})
test('评论删除失败会回滚计数及所有关联清理', async (t) => {
  const { db, post, api, fail } = fixture(t)
  thread(db, post)
  fail()
  await assert.rejects(api('/api/community/comments/root', 'DELETE'), /injected failure/)
  assert.equal(db.prepare('SELECT count(*) n FROM community_comments').get().n, 121)
  assert.equal(db.prepare('SELECT count(*) n FROM community_likes').get().n, 120)
  assert.equal(db.prepare('SELECT comments_count FROM community_posts').get().comments_count, 121)
})
