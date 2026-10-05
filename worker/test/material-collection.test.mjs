import test, { beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { build } from 'esbuild'
import { readFile, mkdir, writeFile, unlink } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const compiled = await build({
  stdin: {
    contents: `import { registerSyncRoutes } from './worker/src/api/sync';
      import { registerMaterialRoutes } from './worker/src/api/materials';
      import { registerPartnerRoutes } from './worker/src/api/partners';
      export { route } from './worker/src/router';
      registerSyncRoutes(); registerMaterialRoutes(); registerPartnerRoutes();`,
    resolveDir: process.cwd()
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  plugins: [
    {
      name: 'material-api-boundaries',
      setup(b) {
        b.onResolve({ filter: /middleware\/(?:auth|rateLimit)$/ }, ({ path }) => ({ path, namespace: 'boundary' }))
        b.onLoad({ filter: /.*/, namespace: 'boundary' }, ({ path }) => ({
          contents: path.endsWith('auth')
            ? `export async function resolveAuth(request) { return { userId: request.headers.get('X-Test-User') || '', role: 'user' } }; export const tryGetAuth = resolveAuth; export const isDbAdmin = async () => false;`
            : `export async function rateLimit() {}`
        }))
      }
    }
  ]
})
await mkdir('.cache/material-tests', { recursive: true })
const file = resolve('.cache/material-tests', `${crypto.randomUUID()}.mjs`)
await writeFile(file, compiled.outputFiles[0].text)
const { route } = await import(pathToFileURL(file).href)
await unlink(file)
const schema = await readFile(new URL('../schema.sql', import.meta.url), 'utf8')
let db, env
function statement(sql, args = []) {
  return {
    sql,
    args,
    bind: (...values) => statement(sql, values),
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    first: async () => db.prepare(sql).get(...args) ?? null,
    run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...args).changes) } })
  }
}
beforeEach(() => {
  db = new DatabaseSync(':memory:')
  db.exec(schema)
  for (const [id, code] of [
    ['owner', 'ABCDEFGH'],
    ['peer', 'BCDEFGHJ']
  ]) {
    db.prepare('INSERT INTO users(id,user_code,username,password_hash,created_at) VALUES(?,?,?,?,1)').run(
      id,
      code,
      `private-login-${id}`,
      'unused'
    )
    db.prepare('INSERT INTO user_settings(user_id,user_name,profile_visibility) VALUES(?,?,?)').run(
      id,
      '升本人',
      'public'
    )
  }
  env = {
    DB: {
      prepare: statement,
      batch: async (items) => {
        db.exec('BEGIN')
        try {
          const rows = items.map((item) =>
            /^\s*SELECT\b/i.test(item.sql)
              ? { results: db.prepare(item.sql).all(...item.args), meta: { changes: 0 } }
              : { meta: { changes: Number(db.prepare(item.sql).run(...item.args).changes) } }
          )
          db.exec('COMMIT')
          return rows
        } catch (e) {
          db.exec('ROLLBACK')
          throw e
        }
      }
    },
    IMAGES: { delete: async () => {} }
  }
})
afterEach(() => db.close())
async function api(path, body, user = 'owner', method = 'POST') {
  return route(
    new Request(`https://local.invalid${path}`, {
      method,
      headers: { 'X-Test-User': user, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    }),
    env
  ).catch((e) => {
    if (!e.status) throw e
    return Response.json({ error: e.message }, { status: e.status })
  })
}
const material = (favorite, updatedAt) => ({
  id: 'shared-local-id',
  title: '高数教材',
  type: 'book',
  favorite,
  createdAt: 1,
  updatedAt
})
const push = (record, user = 'owner') =>
  api(
    '/api/data/push',
    {
      domains: { materials: { upserts: [record], deletes: [] } }
    },
    user
  )

test('收藏状态经推送、冷拉取、增量拉取和取消收藏持久化，相同资料 ID 按账号隔离', async () => {
  assert.equal((await push(material(true, 100))).status, 200)
  assert.equal((await push(material(false, 100), 'peer')).status, 200)
  const full = await (await api('/api/data/pull', { full: true })).json()
  assert.equal(full.changes.materials.upserts[0].favorite, true)
  const peers = await (await api('/api/materials', undefined, 'peer', 'GET')).json()
  assert.equal(peers[0].favorite, false)
  const cursor = full.changes.materials.seq
  assert.equal((await push(material(false, 200))).status, 200)
  const incremental = await (await api('/api/data/pull', { cursors: { materials: cursor } })).json()
  assert.equal(incremental.changes.materials.upserts[0].favorite, false)
  const fresh = await (await api('/api/materials', undefined, 'owner', 'GET')).json()
  assert.equal(fresh[0].favorite, false)
})

test('非布尔收藏值被拒绝，旧客户端未带字段的资料仍可同步', async () => {
  assert.equal((await push(material('yes', 100))).status, 400)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM materials').get().n, 0)
  const legacy = material(undefined, 100)
  assert.equal((await push(legacy)).status, 200)
  const rows = await (await api('/api/materials', undefined, 'owner', 'GET')).json()
  assert.equal(rows[0].favorite, false)
})

test('旧资料收藏迁移保留原记录，默认未收藏且约束非法值', async () => {
  const legacy = new DatabaseSync(':memory:')
  try {
    legacy.exec("CREATE TABLE materials(id TEXT PRIMARY KEY,title TEXT); INSERT INTO materials VALUES('old','旧教材')")
    legacy.exec(await readFile(new URL('../migrations/0008_material_favorites.sql', import.meta.url), 'utf8'))
    assert.equal(legacy.prepare('SELECT * FROM materials').get().title, '旧教材')
    assert.equal(legacy.prepare('SELECT * FROM materials').get().favorite, 0)
    assert.throws(() => legacy.exec('UPDATE materials SET favorite=2'), /CHECK constraint/)
  } finally {
    legacy.close()
  }
})

test('搭子推荐提供稳定公开 ID，同名默认昵称可区分且不暴露登录用户名', async () => {
  const result = await (await api('/api/community/partners/suggestions', undefined, 'owner', 'GET')).json()
  const suggestion = result.suggestions.find((s) => s.userId === 'peer')
  assert.equal(suggestion.userCode, 'BCDEFGHJ')
  assert.equal(suggestion.userName, '升本人-BCDEFGHJ')
  assert.equal(JSON.stringify(suggestion).includes('private-login'), false)
  db.exec("UPDATE user_settings SET user_name='同名同学' WHERE user_id='peer'")
  const renamed = await (await api('/api/community/partners/suggestions', undefined, 'owner', 'GET')).json()
  assert.equal(renamed.suggestions[0].userName, '同名同学')
  assert.equal(renamed.suggestions[0].userCode, 'BCDEFGHJ')
})
