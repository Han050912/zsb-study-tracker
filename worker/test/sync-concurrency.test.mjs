import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { build } from 'esbuild'
import { readFile, mkdir, writeFile, unlink } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const root = fileURLToPath(new URL('../../', import.meta.url))
const code = await build({
  stdin: {
    contents: `import { registerSyncRoutes } from './worker/src/api/sync';
    import { registerNoteBodyRoutes } from './worker/src/api/noteBodies';
    import { registerPdfRoutes } from './worker/src/api/pdfs';
    export { route } from './worker/src/router';
    export { cleanupR2Objects } from './worker/src/r2Cleanup';
    registerSyncRoutes(); registerNoteBodyRoutes(); registerPdfRoutes();`,
    resolveDir: root
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  plugins: [
    {
      name: 'local-boundaries',
      setup(builder) {
        builder.onResolve({ filter: /middleware\/(auth|rateLimit)$/ }, (args) => ({
          path: args.path,
          namespace: 'mock'
        }))
        builder.onLoad({ filter: /.*/, namespace: 'mock' }, (args) => ({
          contents: args.path.endsWith('auth')
            ? `export async function resolveAuth(request) { return { userId: request.headers.get('X-Test-User') || 'u', role: 'user' } }; export const tryGetAuth = resolveAuth; export const isDbAdmin = async () => false;`
            : `export async function rateLimit() {}`
        }))
      }
    }
  ]
})
await mkdir(path.join(root, '.cache/sync-tests'), { recursive: true })
const file = path.join(root, `.cache/sync-tests/${crypto.randomUUID()}.mjs`)
await writeFile(file, code.outputFiles[0].text)
const { route, cleanupR2Objects } = await import(pathToFileURL(file).href)
await unlink(file)
const schema = await readFile(new URL('../schema.sql', import.meta.url), 'utf8')
function deferred() {
  let resolve
  const promise = new Promise((r) => (resolve = r))
  return { promise, resolve }
}
function database(t) {
  const db = new DatabaseSync(':memory:')
  t.after(() => db.close())
  db.exec(schema)
  for (const id of ['u', 'peer'])
    db.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, 1)').run(id, id, 'unused')
  let hold = null,
    inject = null
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
  const env = {
    DB: {
      prepare: (sql) => statement(sql),
      batch: async (statements) => {
        if (hold) {
          const p = hold
          hold = null
          p.entered.resolve()
          await p.release.promise
        }
        db.exec('BEGIN')
        try {
          const results = statements.map((s) => {
            if (inject?.(s.sql)) {
              inject = null
              throw new Error('injected write failure')
            }
            return /^\s*SELECT\b/i.test(s.sql)
              ? { results: db.prepare(s.sql).all(...s.args), meta: { changes: 0 } }
              : { meta: { changes: Number(db.prepare(s.sql).run(...s.args).changes) } }
          })
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
  const cache = new Map()
  globalThis.caches = {
    default: {
      match: async (key) => cache.get(key)?.clone(),
      put: async (key, value) => cache.set(key, value.clone()),
      delete: async (key) => cache.delete(key)
    }
  }
  const request = (url, method = 'POST', body, headers = {}) =>
    route(
      new Request('https://local.invalid' + url, {
        method,
        headers,
        ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) })
      }),
      env
    )
  const api = async (url, body) => (await request(url, 'POST', body)).json()
  return {
    db,
    env,
    api,
    request,
    pauseNextBatch() {
      hold = { entered: deferred(), release: deferred() }
      return hold
    },
    failWhen(fn) {
      inject = fn
    }
  }
}
const rec = (id, updatedAt, minutes = 10) => ({ id, subjectId: 'math', date: '2026-09-26', minutes, updatedAt })
const push = (api, records) => api('/api/data/push', { domains: { records: { upserts: records, deletes: [] } } })

test('a delayed commit gets a fresh sequence and cannot disappear behind an advanced cursor', async (t) => {
  const { db, api, pauseNextBatch } = database(t)
  const pause = pauseNextBatch()
  const slow = push(api, [rec('slow', 100)])
  await pause.entered.promise
  await push(api, [rec('fast', 200)])
  const initial = await api('/api/data/pull', { cursors: { records: 0 } })
  assert.equal(initial.changes.records.seq, 1)
  pause.release.resolve()
  await slow
  const next = await api('/api/data/pull', { cursors: { records: initial.changes.records.seq } })
  assert.deepEqual(
    next.changes.records.upserts.map((r) => r.id),
    ['slow']
  )
  assert.equal(next.changes.records.seq, 2)
  assert.equal(db.prepare('SELECT count(*) AS n FROM study_records').get().n, 2)
})

test('a stale last-write-wins decision is re-read after a concurrent update', async (t) => {
  const { db, api, pauseNextBatch } = database(t)
  const pause = pauseNextBatch()
  const stale = push(api, [rec('same', 100, 10)])
  await pause.entered.promise
  await push(api, [rec('same', 200, 20)])
  pause.release.resolve()
  const response = await stale
  assert.equal(db.prepare('SELECT minutes FROM study_records').get().minutes, 20)
  assert.equal(response.rejected.length, 1)
})

test('a concurrent tombstone prevents an old upsert from resurrecting a record', async (t) => {
  const { db, api, pauseNextBatch } = database(t)
  await push(api, [rec('same', 50)])
  const pause = pauseNextBatch()
  const stale = push(api, [rec('same', 100)])
  await pause.entered.promise
  await api('/api/data/push', { domains: { records: { upserts: [], deletes: [{ key: 'same', deletedAt: 200 }] } } })
  pause.release.resolve()
  await stale
  assert.equal(db.prepare('SELECT count(*) AS n FROM study_records').get().n, 0)
})

test('concurrent achievement unions retain both sets', async (t) => {
  const { db, api, pauseNextBatch } = database(t)
  const pause = pauseNextBatch()
  const slow = api('/api/data/push', { achievements: ['slow-achievement'] })
  await pause.entered.promise
  await api('/api/data/push', { achievements: ['fast-achievement'] })
  pause.release.resolve()
  await slow
  assert.deepEqual(
    new Set(JSON.parse(db.prepare('SELECT achievements FROM gamification').get().achievements)),
    new Set(['slow-achievement', 'fast-achievement'])
  )
})

test('a failed business write rolls back versions, records, and rewards together', async (t) => {
  const { db, api, failWhen } = database(t)
  failWhen((sql) => sql.includes('INSERT INTO study_records'))
  await assert.rejects(push(api, [rec('failed', 100)]), /injected/)
  for (const table of ['sync_domain_versions', 'study_records', 'points_log'])
    assert.equal(db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n, 0)
  await push(api, [rec('failed', 100)])
  assert.equal(db.prepare("SELECT version FROM sync_domain_versions WHERE domain='records'").get().version, 1)
})

test('fabricated point events and revoke-all cannot mint or remove authoritative rewards', async (t) => {
  const { api } = database(t)
  const fake = await api('/api/data/push', {
    points: Array.from({ length: 100 }, (_, i) => ({
      op: 'award',
      refId: `fabricated-${i}`,
      reason: '每日打卡',
      points: 10,
      date: '2026-09-27'
    }))
  })
  assert.ok(fake.gamification.points <= 10)
  const replay = await api('/api/data/push', { points: [{ op: 'revoke', all: true }] })
  assert.equal(replay.gamification.points, fake.gamification.points)
})

test('a note deleted during body upload cannot leave a resurrected body', async (t) => {
  const { db, api, request, pauseNextBatch } = database(t)
  const pause = pauseNextBatch()
  const upload = request('/api/note-bodies/note1', 'PUT', 'body', { 'X-Updated-At': '100' })
  await pause.entered.promise
  await api('/api/data/push', { domains: { notes: { upserts: [], deletes: [{ key: 'note1', deletedAt: 200 }] } } })
  pause.release.resolve()
  await assert.rejects(upload, (e) => e.status === 409)
  assert.equal(db.prepare('SELECT count(*) AS n FROM note_body_chunks').get().n, 0)
})

test('PDF replacement bypasses an older PoP cache using the committed database revision', async (t) => {
  const { request } = database(t)
  await request('/api/pdfs/pdf1', 'PUT', '%PDF-old')
  assert.equal(await (await request('/api/pdfs/pdf1', 'GET')).text(), '%PDF-old')
  await request('/api/pdfs/pdf1', 'PUT', '%PDF-new')
  assert.equal(await (await request('/api/pdfs/pdf1', 'GET')).text(), '%PDF-new')
  await request('/api/pdfs/pdf1', 'DELETE')
  await assert.rejects(request('/api/pdfs/pdf1', 'GET'), (e) => e.status === 404)
})

test('failed R2 removal stays queued for a later successful cleanup', async (t) => {
  const { db, env } = database(t)
  db.exec("INSERT INTO r2_cleanup_jobs VALUES ('immutable-generation',1)")
  env.IMAGES.delete = async () => {
    throw new Error('R2 offline')
  }
  await assert.rejects(cleanupR2Objects(env), /R2 cleanup failed/)
  assert.equal(db.prepare('SELECT count(*) AS n FROM r2_cleanup_jobs').get().n, 1)
  env.IMAGES.delete = async () => {}
  await cleanupR2Objects(env)
  assert.equal(db.prepare('SELECT count(*) AS n FROM r2_cleanup_jobs').get().n, 0)
})

test('a transaction crossing UTC+8 midnight uses one reward day and reports every actual award', async (t) => {
  const { db, env, api } = database(t)
  const originalNow = Date.now
  let current = Date.parse('2026-09-27T15:59:59.900Z')
  Date.now = () => current
  t.after(() => {
    Date.now = originalNow
  })
  const prepare = env.DB.prepare
  env.DB.prepare = (sql) => {
    if (sql === 'SELECT id, points FROM points_log WHERE user_id = ? AND date = ?')
      current = Date.parse('2026-09-27T16:00:00.100Z')
    return prepare(sql)
  }
  const result = await api('/api/data/push', {
    domains: { records: { upserts: [{ ...rec('midnight', 100, 60), date: '2026-09-27' }], deletes: [] } },
    points: [{ op: 'award', reason: '每日打卡', refId: 'irrelevant', points: 999 }]
  })
  assert.deepEqual(
    db
      .prepare('SELECT DISTINCT date FROM points_log')
      .all()
      .map((row) => row.date),
    ['2026-09-27']
  )
  assert.equal(
    result.awarded.reduce((sum, award) => sum + award.points, 0),
    19
  )
  assert.equal(db.prepare('SELECT spent FROM study_reward_daily_usage').get().spent, 19)
  const next = await api('/api/data/push', { points: [{ op: 'award', reason: '每日打卡' }] })
  assert.equal(
    next.awarded.reduce((sum, award) => sum + award.points, 0),
    10
  )
  assert.equal(db.prepare("SELECT spent FROM study_reward_daily_usage WHERE date='2026-09-28'").get().spent, 10)
})

test('pomodoro completion survives sync and legacy edits; forged completion intents cannot reward early stops', async (t) => {
  const { db, api } = database(t)
  const date = '2026-10-02'
  const record = (id, completed, updatedAt) => ({
    key: `rec:${id}`,
    updatedAt,
    value: { date, time: 1, minutes: completed === false ? 2 : 25, description: '', source: 'solo', completed }
  })
  const upserts = [record('done', true, 100), record('early', false, 100), record('legacy', undefined, 100)]
  const result = await api('/api/data/push', { domains: { pomodoro: { upserts, deletes: [] } } })
  assert.equal(result.gamification.points, 10)
  assert.deepEqual(
    db
      .prepare('SELECT id,completed FROM pomodoro_records ORDER BY id')
      .all()
      .map((r) => [r.id, r.completed]),
    [
      ['done', 1],
      ['early', 0],
      ['legacy', 1]
    ]
  )
  const pulled = await api('/api/data/pull', { full: true })
  const records = new Map(
    pulled.changes.pomodoro.upserts.filter((r) => r.key.startsWith('rec:')).map((r) => [r.key, r.value])
  )
  assert.equal(records.get('rec:early').completed, false)
  assert.equal(records.get('rec:done').completed, true)
  assert.equal(records.get('rec:legacy').completed, true)
  const oldClientEdit = record('early', undefined, 200)
  oldClientEdit.value.description = '旧设备编辑描述'
  const edited = await api('/api/data/push', {
    domains: { pomodoro: { upserts: [oldClientEdit], deletes: [] } },
    points: [{ op: 'award', reason: '完成番茄钟', refId: 'early', points: 999 }]
  })
  assert.equal(db.prepare("SELECT completed FROM pomodoro_records WHERE id='early'").get().completed, 0)
  assert.equal(edited.gamification.points, 10)
  const replay = await api('/api/data/push', {
    domains: { pomodoro: { upserts, deletes: [] } },
    points: [{ op: 'award', reason: '完成番茄钟', refId: 'early', points: 999 }]
  })
  assert.equal(replay.gamification.points, 10)
  assert.equal(db.prepare('SELECT count(*) AS n FROM points_log').get().n, 2)
})

test('a nonboolean pomodoro completion marker rejects every domain before writes', async (t) => {
  const { db, request } = database(t)
  await assert.rejects(
    request('/api/data/push', 'POST', {
      domains: {
        records: { upserts: [rec('must-not-save', 100)], deletes: [] },
        pomodoro: {
          upserts: [
            { key: 'rec:bad', updatedAt: 100, value: { date: '2026-10-02', time: 1, minutes: 2, completed: 'false' } }
          ],
          deletes: []
        }
      }
    }),
    (error) => error.status === 400 && /completed/.test(error.message)
  )
  assert.equal(db.prepare('SELECT count(*) AS n FROM study_records').get().n, 0)
  assert.equal(db.prepare('SELECT count(*) AS n FROM pomodoro_records').get().n, 0)
})

test('0005 preserves old pomodoro rows and persists new early-stop markers', async (t) => {
  const db = new DatabaseSync(':memory:')
  t.after(() => db.close())
  db.exec(
    "CREATE TABLE pomodoro_records (id TEXT PRIMARY KEY, minutes REAL NOT NULL); INSERT INTO pomodoro_records VALUES ('old',25);"
  )
  db.exec(await readFile(new URL('../migrations/0005_pomodoro_completed.sql', import.meta.url), 'utf8'))
  assert.equal(db.prepare("SELECT completed FROM pomodoro_records WHERE id='old'").get().completed, 1)
  db.exec("INSERT INTO pomodoro_records (id,minutes,completed) VALUES ('early',2,0)")
  assert.equal(db.prepare("SELECT completed FROM pomodoro_records WHERE id='early'").get().completed, 0)
  assert.throws(() => db.exec("INSERT INTO pomodoro_records (id,minutes,completed) VALUES ('invalid',2,2)"), /CHECK/)
})
