import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { build } from 'esbuild'
import { readFile, mkdir, writeFile, unlink } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const local = new Map()
globalThis.localStorage = {
  get length() {
    return local.size
  },
  key: (i) => [...local.keys()][i] ?? null,
  getItem: (key) => local.get(key) ?? null,
  setItem: (key, value) => local.set(key, value),
  removeItem: (key) => local.delete(key)
}
const built = await build({
  stdin: {
    contents: `import { registerSyncRoutes } from './worker/src/api/sync'; registerSyncRoutes();
    export { route } from './worker/src/router'; export { syncActions, syncIssue } from './src/stores/app/sync';
    export { ApiError } from './src/api/client';
    export * from './src/stores/app/staging'; export * from './src/services/syncOutbox';
    export { createDefaultState } from './src/data/defaults';`,
    resolveDir: process.cwd()
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  external: ['vue'],
  plugins: [
    {
      name: 'external-boundaries',
      setup(b) {
        b.onResolve(
          { filter: /(?:middleware\/(auth|rateLimit)|services\/(auth|noteBodies)|api\/(sync|client|errorImages))$/ },
          (args) => {
            if (args.path.includes('worker/')) return null
            return { path: args.path.endsWith('/api/client') ? '/api/client' : args.path, namespace: 'boundary' }
          }
        )
        b.onLoad({ filter: /.*/, namespace: 'boundary' }, ({ path }) => {
          if (path.includes('middleware/auth'))
            return {
              contents: `export const resolveAuth=async()=>({userId:'u',role:'user'}); export const tryGetAuth=resolveAuth; export const isDbAdmin=async()=>false;`
            }
          if (path.endsWith('rateLimit')) return { contents: 'export const rateLimit=async()=>{};' }
          if (path.endsWith('services/auth')) return { contents: `export const sessionUser={value:{id:'u'}};` }
          if (path.endsWith('api/sync'))
            return {
              contents: `export const syncApi={pushChanges:(v)=>globalThis.__batchApi.push(v),pullChanges:(v)=>globalThis.__batchApi.pull(v),pushChangesBeacon(){}};`
            }
          if (path.endsWith('api/client'))
            return {
              contents: `export class ApiError extends Error { constructor(message,status){super(message);this.status=status} }`
            }
          if (path.endsWith('errorImages')) return { contents: 'export const clearErrorImageCache=()=>{};' }
          return {
            contents: `export const flushPendingNoteBodies=async()=>({revisions:new Map(),failures:[]});
        export const hasPendingNoteBodies=()=>false; export const reconcileNoteBodies=async()=>{};
        export const setNoteBodyUser=async()=>{}; export const isNoteRestorePending=()=>false; export const finishNoteRestore=()=>{};
        export const noteBodyStorageIssue={value:null}; export const hasVolatileNoteBodies=()=>false;`
          }
        })
      }
    }
  ]
})
await mkdir('.cache/backup-batch-tests', { recursive: true })
const file = resolve('.cache/backup-batch-tests', `${crypto.randomUUID()}.mjs`)
await writeFile(file, built.outputFiles[0].text)
after(() => unlink(file))
const schema = await readFile('worker/schema.sql', 'utf8')
const imageId = 'a'.repeat(64)
const subject = (id) => ({
  id,
  name: id,
  icon: 'book',
  color: '#000000',
  weight: 1,
  builtin: false,
  chapters: [],
  mastery: {},
  topicImportance: {}
})
const question = (id, subjectId, image = '') => ({
  id,
  subjectId,
  date: '2026-10-10',
  type: 'choice',
  content: 'question',
  image,
  reviewCount: 0,
  mastered: false,
  createdAt: 1,
  updatedAt: 1
})

async function fixture(t) {
  local.clear()
  const app = await import(`${pathToFileURL(file).href}?fixture=${crypto.randomUUID()}`)
  const db = new DatabaseSync(':memory:')
  db.exec(schema)
  db.prepare('INSERT INTO users(id, username, password_hash, created_at) VALUES (?,?,?,1)').run('u', 'u', 'unused')
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
  let beforeBatch
  const env = {
    DB: {
      prepare: (sql) => statement(sql),
      batch: async (statements) => {
        await beforeBatch?.(statements)
        db.exec('BEGIN')
        try {
          const results = statements.map((s) =>
            /^\s*SELECT\b/i.test(s.sql)
              ? { results: db.prepare(s.sql).all(...s.args) }
              : { meta: { changes: Number(db.prepare(s.sql).run(...s.args).changes) } }
          )
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
  globalThis.caches = { default: { delete: async () => true } }
  const api = async (path, payload) =>
    (
      await app.route(
        new Request(`https://test.invalid${path}`, {
          method: 'POST',
          body: JSON.stringify(payload)
        }),
        env
      )
    ).json()
  const calls = []
  globalThis.__batchApi = {
    push: async (payload) => {
      calls.push(payload)
      try {
        return await api('/api/data/push', payload)
      } catch (error) {
        throw new app.ApiError(error.message, error.status)
      }
    },
    pull: (payload) => api('/api/data/pull', payload)
  }
  const old = app.createDefaultState()
  old.subjects = [subject('oldsubject')]
  old.habits = []
  old.errorQuestions = Array.from({ length: 151 }, (_, i) =>
    question(`old${i}`, 'oldsubject', i === 0 ? `r2:${imageId}` : '')
  )
  db.prepare('INSERT INTO error_images(id,user_id,r2_key,size,content_type,created_at) VALUES (?,?,?,?,?,?)').run(
    imageId,
    'u',
    'prepared-generation',
    1,
    'image/png',
    1
  )
  await api('/api/data/push', {
    domains: {
      subjects: { upserts: old.subjects.map((s) => ({ key: s.id, value: s, updatedAt: 1 })), deletes: [] },
      errorQuestions: { upserts: old.errorQuestions, deletes: [] }
    }
  })
  const store = Object.assign(app.createDefaultState(), app.syncActions, {
    $patch(patch) {
      Object.assign(this, patch)
    },
    migrateErrorImages() {}
  })
  Object.defineProperty(store, '$state', { get: () => store })
  await store.hydrate()
  calls.length = 0
  const incoming = app.createDefaultState()
  incoming.subjects = [subject('newsubject')]
  incoming.habits = []
  incoming.errorQuestions = [question('restored', 'newsubject', `r2:${imageId}`)]
  const now = Date.now()
  app.stageAllDeletes(store.$state, now)
  store.$patch(incoming)
  app.stageAllUpserts(store.$state, now, true)
  t.after(() => {
    store.resetState()
    db.close()
  })
  return {
    app,
    db,
    store,
    calls,
    now,
    api,
    beforeBatch: (callback) => {
      beforeBatch = callback
    }
  }
}

test('real restore staging creates a new subject and image reference before 151 old deletions and subject cascade', async (t) => {
  const { app, db, store, calls } = await fixture(t)
  assert.equal((await store.flushOutbox()).ok, true)
  assert.deepEqual(Object.keys(calls[0].domains), ['subjects'])
  assert.deepEqual(Object.keys(calls[1].domains), ['errorQuestions'])
  assert.equal(calls[1].domains.errorQuestions.deletes.length, 0)
  assert.ok(calls.length >= 4)
  assert.equal(db.prepare('SELECT count(*) AS n FROM error_questions').get().n, 1)
  assert.equal(db.prepare('SELECT subject_id FROM error_questions WHERE id=?').get('restored').subject_id, 'newsubject')
  assert.equal(db.prepare('SELECT r2_key FROM error_images WHERE id=?').get(imageId).r2_key, 'prepared-generation')
  assert.equal(db.prepare('SELECT count(*) AS n FROM r2_cleanup_jobs').get().n, 0)
  assert.equal(app.size(), 0)
})

for (const rejectedDomain of ['subjects', 'errorQuestions']) {
  test(`a rejected ${rejectedDomain} prerequisite stops destructive batches and survives retry`, async (t) => {
    const { app, db, store, calls, now } = await fixture(t)
    const key = rejectedDomain === 'subjects' ? 'newsubject' : 'restored'
    db.prepare('INSERT INTO sync_deletions(user_id,domain,record_key,deleted_at,seq) VALUES (?,?,?,?,?)').run(
      'u',
      rejectedDomain,
      key,
      now + 1000,
      1
    )
    assert.equal((await store.flushOutbox()).ok, false)
    assert.ok(calls.every((payload) => Object.values(payload.domains).every((domain) => domain.deletes.length === 0)))
    assert.equal(db.prepare('SELECT count(*) AS n FROM error_questions WHERE id LIKE ?').get('old%').n, 151)
    assert.ok(db.prepare('SELECT id FROM error_images WHERE id=?').get(imageId))
    assert.equal(app.takeForFlush().upserts[rejectedDomain][key].restoration, true)
    assert.ok(app.takeForFlush().upserts[rejectedDomain][key].updatedAt > now + 1000)
    assert.equal((await store.flushOutbox()).ok, true)
    assert.ok(db.prepare('SELECT id FROM error_images WHERE id=?').get(imageId))
    assert.equal(db.prepare('SELECT count(*) AS n FROM error_questions').get().n, 1)
  })
}

test('failed image prerequisite request keeps old data and the prerequisite queued before retry', async (t) => {
  const { app, db, store } = await fixture(t)
  const push = globalThis.__batchApi.push
  globalThis.__batchApi.push = async (payload) => {
    if (payload.domains.errorQuestions?.upserts.length) throw new Error('offline')
    return push(payload)
  }
  assert.equal((await store.flushOutbox()).ok, false)
  assert.equal(db.prepare('SELECT count(*) AS n FROM error_questions').get().n, 151)
  assert.equal(app.takeForFlush().upserts.errorQuestions.restored.restoration, true)
  globalThis.__batchApi.push = push
  assert.equal((await store.flushOutbox()).ok, true)
  assert.ok(db.prepare('SELECT id FROM error_images WHERE id=?').get(imageId))
})

test('a previously captured drain yields to restore prerequisites staged later by another tab', async (t) => {
  const { app } = await fixture(t)
  const captured = app.takeForFlush()
  app.stageUpsert('subjects', 'late', subject('late'), Date.now(), true)
  assert.equal(
    app.takeForFlush({ keys: new Set(captured.receipt.keys), maxChanges: 100, maxBytes: 2 * 1024 * 1024 }),
    null
  )
  const fresh = app.takeForFlush()
  const batch = app.takeForFlush({ keys: new Set(fresh.receipt.keys), maxChanges: 100, maxBytes: 2 * 1024 * 1024 })
  assert.ok(batch.upserts.subjects.late)
  assert.deepEqual(batch.deletes, {})
})

test('a concurrent deletion after ownership read aborts restore atomically, preserves old data, and can retry after image repair', async (t) => {
  const { app, db, store, calls, api, beforeBatch, now } = await fixture(t)
  let raced = false
  beforeBatch(async (statements) => {
    if (!statements.some((s) => s.sql.startsWith('INSERT INTO error_questions') && s.args.includes('restored'))) return
    beforeBatch(undefined)
    raced = true
    // Another device deletes the previous last reference after our ownership
    // check but before our transaction commits. Its CAS revision invalidates ours.
    await api('/api/data/push', {
      domains: { errorQuestions: { upserts: [], deletes: [{ key: 'old0', deletedAt: now + 1 }] } }
    })
  })
  assert.equal((await store.flushOutbox()).ok, false)
  assert.equal(raced, true)
  assert.match(app.syncIssue.value, /422.*重新选择原完整备份/)
  assert.equal(db.prepare('SELECT count(*) AS n FROM error_questions').get().n, 150)
  assert.equal(db.prepare('SELECT id FROM error_questions WHERE id=?').get('restored'), undefined)
  assert.equal(db.prepare('SELECT id FROM error_images WHERE id=?').get(imageId), undefined)
  assert.ok(calls.every((payload) => Object.values(payload.domains).every((domain) => domain.deletes.length === 0)))
  assert.equal(app.takeForFlush().upserts.errorQuestions.restored.restoration, true)
  // Selecting the original complete file repairs the ownership with a fresh generation.
  db.prepare('INSERT INTO error_images(id,user_id,r2_key,size,content_type,created_at) VALUES (?,?,?,?,?,?)').run(
    imageId,
    'u',
    'repaired-generation',
    1,
    'image/png',
    1
  )
  assert.equal((await store.flushOutbox()).ok, true)
  assert.equal(db.prepare('SELECT count(*) AS n FROM error_questions').get().n, 1)
  assert.equal(db.prepare('SELECT r2_key FROM error_images WHERE id=?').get(imageId).r2_key, 'repaired-generation')
  assert.equal(app.size(), 0)
})
