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
    import { registerTeamRoutes } from './worker/src/api/teams';
    export { route } from './worker/src/router';
    export { cleanupR2Objects } from './worker/src/r2Cleanup';
    export { applyChanges, serializeChanges } from './src/services/syncDomains';
    registerSyncRoutes(); registerNoteBodyRoutes(); registerPdfRoutes(); registerTeamRoutes();`,
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
const { route, cleanupR2Objects, applyChanges, serializeChanges } = await import(pathToFileURL(file).href)
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

test('serial problem saves retain the same total, accuracy and history on repeated cold and incremental pulls', async (t) => {
  const { db, api, request } = database(t)
  const session = {
    id: 'two-questions',
    subjectId: 'math',
    date: '2026-10-05',
    total: 2,
    correct: 1,
    types: { choice: 2 },
    updatedAt: 100
  }
  const payload = { domains: { problemSessions: { upserts: [session], deletes: [] } } }
  await api('/api/data/push', payload)
  await api('/api/data/push', payload)
  let cursor = 0
  for (let reload = 0; reload < 3; reload++) {
    const full = await api('/api/data/pull', { full: true })
    const records = full.changes.problemSessions.upserts
    assert.equal(records.length, 1)
    assert.deepEqual([records[0].total, records[0].correct, records[0].types.choice], [2, 1, 2])
    const total = records.reduce((sum, record) => sum + record.total, 0)
    const correct = records.reduce((sum, record) => sum + record.correct, 0)
    assert.deepEqual([total, Math.round((correct / total) * 100)], [2, 50])
    cursor = full.changes.problemSessions.seq
  }
  const incremental = await api('/api/data/pull', { cursors: { problemSessions: cursor } })
  assert.equal(incremental.changes.problemSessions, undefined)
  const otherUser = await (await request('/api/data/pull', 'POST', { full: true }, { 'X-Test-User': 'peer' })).json()
  assert.deepEqual(otherUser.changes.problemSessions.upserts, [])
  assert.equal(db.prepare('SELECT count(*) AS n FROM problem_sessions').get().n, 1)
})

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
  assert.deepEqual(await (await upload).json(), { applied: false, updatedAt: 200, clamped: false })
  assert.equal(db.prepare('SELECT count(*) AS n FROM note_body_chunks').get().n, 0)
})

test('a body-only commit advances discovery while preserving a newer title and preventing body version rollback', async (t) => {
  const { db, api, request } = database(t)
  const note = { id: 'body-race', subjectId: 'math', title: 'old', tags: [], updatedAt: 100, bodyUpdatedAt: 100 }
  await request('/api/note-bodies/body-race', 'PUT', 'old body', { 'X-Updated-At': '100' })
  await api('/api/data/push', { domains: { notes: { upserts: [note], deletes: [] } } })
  await api('/api/data/push', {
    domains: { notes: { upserts: [{ ...note, title: 'new title', updatedAt: 300 }], deletes: [] } }
  })
  const cursor = (await api('/api/data/pull', { full: true })).changes.notes.seq
  assert.equal(
    (await (await request('/api/note-bodies/body-race', 'PUT', 'new body', { 'X-Updated-At': '200' })).json()).applied,
    true
  )
  const rejected = await api('/api/data/push', {
    domains: { notes: { upserts: [{ ...note, updatedAt: 200, bodyUpdatedAt: 200 }], deletes: [] } }
  })
  assert.equal(rejected.rejected[0].reason, 'older')
  const incremental = await api('/api/data/pull', { cursors: { notes: cursor } })
  assert.deepEqual(
    incremental.changes.notes.upserts.map((n) => [n.title, n.bodyUpdatedAt]),
    [['new title', 200]]
  )
  const otherDevice = { notes: [{ ...note, title: 'new title', updatedAt: 300 }] }
  applyChanges('notes', otherDevice, incremental.changes.notes)
  assert.equal(otherDevice.notes[0].bodyUpdatedAt, 200)
  otherDevice.notes[0].title = 'local edit'
  otherDevice.notes[0].updatedAt = 500
  applyChanges('notes', otherDevice, {
    upserts: [{ ...note, title: 'cloud title', updatedAt: 400, bodyUpdatedAt: 250 }],
    deletes: []
  })
  assert.deepEqual([otherDevice.notes[0].title, otherDevice.notes[0].bodyUpdatedAt], ['local edit', 250])
  await api('/api/data/push', {
    domains: { notes: { upserts: [{ ...note, title: 'latest title', updatedAt: 400 }], deletes: [] } }
  })
  assert.equal(db.prepare('SELECT body_updated_at FROM notes').get().body_updated_at, 200)
})

test('cleared time habits and legacy numeric zero survive reload and a later check-in with an unrelated todo', async (t) => {
  const { db, api } = database(t)
  const habit = { id: 'sleep', name: 'sleep', type: 'time', records: { '2026-10-05': '' } }
  await api('/api/data/push', {
    domains: { habits: { upserts: [{ key: 'sleep', value: habit, updatedAt: 100 }], deletes: [] } }
  })
  const restored = (await api('/api/data/pull', { full: true })).changes.habits.upserts[0].value
  assert.equal(restored.records['2026-10-05'], '')
  restored.records['2026-10-04'] = 0
  restored.records['2026-10-06'] = '23:00'
  await api('/api/data/push', {
    domains: {
      habits: { upserts: [{ key: 'sleep', value: restored, updatedAt: 200 }], deletes: [] },
      todos: { upserts: [{ id: 'valid', date: '2026-10-06', text: 'todo', updatedAt: 200 }], deletes: [] }
    }
  })
  assert.equal(db.prepare('SELECT count(*) n FROM todos').get().n, 1)
  const after = (await api('/api/data/pull', { full: true })).changes.habits.upserts[0].value.records
  assert.deepEqual(after, { '2026-10-04': '', '2026-10-05': '', '2026-10-06': '23:00' })
})

test('two devices merge unique focus records and interruptions even when their daily snapshots and clocks differ', async (t) => {
  const { db, api, pauseNextBatch } = database(t)
  const date = '2026-10-06'
  const wrap = (key, value, updatedAt) => ({ key, value, updatedAt })
  const device = (id, stamp) => ({
    domains: {
      pomodoro: {
        upserts: [
          wrap(`day:${date}`, { count: 1, minutes: 25, interruptions: 1 }, stamp),
          wrap(`rec:${id}`, { id, date, time: stamp, minutes: 25, completed: true }, stamp),
          wrap(`itr:${date}`, [{ id: `break-${id}`, reason: 'phone', time: 123 }], stamp)
        ],
        deletes: []
      }
    }
  })
  const pause = pauseNextBatch()
  const slow = api('/api/data/push', device('a', 100))
  await pause.entered.promise
  await api('/api/data/push', device('b', 200))
  pause.release.resolve()
  await slow
  const replay = await api('/api/data/push', device('a', 100))
  assert.deepEqual(replay.versions, {})
  assert.equal(replay.applied.pomodoro ?? 0, 0)
  const daily = db.prepare('SELECT count,minutes,interruptions FROM pomodoro_daily').get()
  assert.deepEqual({ ...daily }, { count: 2, minutes: 50, interruptions: 2 })
  assert.equal(db.prepare('SELECT count(*) n FROM pomodoro_interruptions').get().n, 2)
  const pulled = await api('/api/data/pull', { cursors: { pomodoro: 1 } })
  assert.equal(pulled.changes.pomodoro.upserts.find((row) => row.key.startsWith('itr:')).value.length, 2)
  const otherDevice = {
    pomodoro: {
      daily: { [date]: { count: 1, minutes: 25, interruptions: 1, updatedAt: 200 } },
      interruptions: [{ id: 'break-b', date, reason: 'phone', time: 123, updatedAt: 200 }],
      records: []
    }
  }
  applyChanges('pomodoro', otherDevice, pulled.changes.pomodoro)
  assert.deepEqual(
    [
      otherDevice.pomodoro.daily[date].count,
      otherDevice.pomodoro.daily[date].minutes,
      otherDevice.pomodoro.interruptions.length
    ],
    [2, 50, 2]
  )
  const wire = serializeChanges(
    'pomodoro',
    { [`itr:${date}`]: { value: otherDevice.pomodoro.interruptions, updatedAt: 300 } },
    {}
  )
  assert.deepEqual(new Set(wire.upserts[0].value.map((item) => item.id)), new Set(['break-a', 'break-b']))
  await api('/api/data/push', { domains: { pomodoro: { upserts: [], deletes: [{ key: 'rec:a', deletedAt: 300 }] } } })
  assert.deepEqual({ ...db.prepare('SELECT count,minutes FROM pomodoro_daily').get() }, { count: 1, minutes: 25 })
})

test('old interruption lists union by stable event identity and never remove another device event', async (t) => {
  const { db, api } = database(t)
  const value = (time) => [{ reason: 'old client', time }]
  for (const [time, updatedAt] of [
    [1, 200],
    [2, 100],
    [1, 300]
  ])
    await api('/api/data/push', {
      domains: { pomodoro: { upserts: [{ key: 'itr:2026-10-06', value: value(time), updatedAt }], deletes: [] } }
    })
  assert.equal(db.prepare('SELECT count(*) n FROM pomodoro_interruptions').get().n, 2)
  assert.equal(db.prepare('SELECT interruptions FROM pomodoro_daily').get().interruptions, 2)
})

test('long historical interruption reasons use short stable IDs and round-trip alongside new interruptions', async (t) => {
  const { db, api } = database(t)
  const date = '2026-10-06'
  const reason = '历史原因'.repeat(150_000)
  const send = (value, updatedAt) =>
    api('/api/data/push', {
      domains: { pomodoro: { upserts: [{ key: `itr:${date}`, value, updatedAt }], deletes: [] } }
    })
  await send(
    [
      { reason, time: 100 },
      { reason: 'duplicate legacy', time: 110 },
      { reason: 'duplicate legacy', time: 110 }
    ],
    100
  )
  assert.equal(db.prepare('SELECT count(*) n FROM pomodoro_interruptions').get().n, 2)
  const restored = (await api('/api/data/pull', { full: true })).changes.pomodoro.upserts.find((item) =>
    item.key.startsWith('itr:')
  ).value
  assert.ok(restored[0].id.length < 60)
  restored.push({ id: 'new-event', reason: 'phone', time: 200, independent: true })
  await send(restored, 200)
  assert.equal(db.prepare('SELECT count(*) n FROM pomodoro_interruptions').get().n, 3)
  const replay = await send([{ reason, time: 100 }], 300)
  assert.deepEqual(replay.versions, {})
})

test('daily snapshots compute after details in either payload order, and legacy snapshots consume only late matching details', async (t) => {
  const { db, api } = database(t)
  const send = (upserts, deletes = []) => api('/api/data/push', { domains: { pomodoro: { upserts, deletes } } })
  const wrap = (key, value, updatedAt) => ({ key, value, updatedAt })
  for (const [date, reverse] of [
    ['2026-10-01', false],
    ['2026-10-02', true]
  ]) {
    const values = [
      wrap(`day:${date}`, { count: 1, minutes: 25, interruptions: 0 }, 100),
      wrap(`rec:${date}`, { date, time: 100, minutes: 25, completed: true }, 100)
    ]
    await send(reverse ? values.reverse() : values)
    assert.deepEqual(
      { ...db.prepare('SELECT count,minutes FROM pomodoro_daily WHERE date=?').get(date) },
      { count: 1, minutes: 25 }
    )
  }
  const date = '2026-10-03'
  await send([wrap(`day:${date}`, { count: 3, minutes: 75, interruptions: 1 }, 100)])
  // A missing detail from that summary arrives separately: it consumes the gap instead of doubling it.
  await send([
    wrap('rec:late', { date, time: 90, minutes: 25, completed: true }, 200),
    wrap(`itr:${date}`, [{ id: 'late-break', reason: 'phone', time: 90 }], 200)
  ])
  assert.deepEqual(
    { ...db.prepare('SELECT count,minutes,interruptions FROM pomodoro_daily WHERE date=?').get(date) },
    { count: 3, minutes: 75, interruptions: 1 }
  )
  // A genuinely new focus adds to old daily-only history. A modern derived summary cannot move the legacy cutoff.
  await send([
    wrap(`day:${date}`, { count: 4, minutes: 100, interruptions: 1, derived: true }, 300),
    wrap('rec:new', { date, time: 300, minutes: 25, completed: true }, 300)
  ])
  await send([wrap('rec:new-other-device', { date, time: 250, minutes: 25, completed: true }, 400)])
  assert.deepEqual(
    { ...db.prepare('SELECT count,minutes FROM pomodoro_daily WHERE date=?').get(date) },
    { count: 5, minutes: 125 }
  )
  await send([], [{ key: 'rec:late', deletedAt: 500 }])
  assert.deepEqual(
    { ...db.prepare('SELECT count,minutes FROM pomodoro_daily WHERE date=?').get(date) },
    { count: 4, minutes: 100 }
  )
})

test('explicit backup replacement can reduce a legacy summary and full reset removes both baselines and details', async (t) => {
  const { db, api } = database(t)
  const date = '2026-10-06'
  const day = (count, minutes, updatedAt, replace = false) => ({
    key: `day:${date}`,
    value: { count, minutes, interruptions: 0, replace },
    updatedAt
  })
  const send = (upserts, deletes = []) => api('/api/data/push', { domains: { pomodoro: { upserts, deletes } } })
  await send([day(3, 75, 100)])
  await send([day(1, 25, 200, true)])
  assert.deepEqual({ ...db.prepare('SELECT count,minutes FROM pomodoro_daily').get() }, { count: 1, minutes: 25 })
  await send([], [{ key: `day:${date}`, deletedAt: 300 }])
  assert.equal(db.prepare('SELECT count(*) n FROM pomodoro_daily').get().n, 0)
  await send([day(0, 0, 400, true)])
  assert.deepEqual({ ...db.prepare('SELECT count,minutes FROM pomodoro_daily').get() }, { count: 0, minutes: 0 })
})

test('a modern focus with an older device clock adds to daily-only history without consuming its legacy baseline', async (t) => {
  const { db, api } = database(t)
  const date = '2026-10-06'
  const send = (upserts) => api('/api/data/push', { domains: { pomodoro: { upserts, deletes: [] } } })
  await send([{ key: `day:${date}`, value: { count: 3, minutes: 75, interruptions: 1 }, updatedAt: 100 }])
  await send([
    { key: `day:${date}`, value: { count: 4, minutes: 100, interruptions: 2, derived: true }, updatedAt: 200 },
    { key: 'rec:old-clock', value: { date, time: 90, minutes: 25, completed: true }, updatedAt: 200 },
    { key: `itr:${date}`, value: [{ id: 'old-clock-break', reason: 'phone', time: 90 }], updatedAt: 200 }
  ])
  assert.deepEqual({ ...db.prepare('SELECT count,minutes FROM pomodoro_daily').get() }, { count: 4, minutes: 100 })
  assert.equal(db.prepare('SELECT interruptions FROM pomodoro_daily').get().interruptions, 2)
  // A record sent separately from its derived day carries its own modern event marker.
  await send([
    {
      key: 'rec:split-old-clock',
      value: { date, time: 80, minutes: 25, completed: true, independent: true },
      updatedAt: 300
    }
  ])
  assert.deepEqual({ ...db.prepare('SELECT count,minutes FROM pomodoro_daily').get() }, { count: 5, minutes: 125 })
  await send([
    {
      key: `itr:${date}`,
      value: [{ id: 'split-old-clock-break', reason: 'phone', time: 80, independent: true }],
      updatedAt: 300
    }
  ])
  assert.equal(db.prepare('SELECT interruptions FROM pomodoro_daily').get().interruptions, 3)
  await api('/api/data/push', {
    domains: {
      pomodoro: {
        upserts: [],
        deletes: [
          { key: `day:${date}`, deletedAt: 500 },
          { key: `itr:${date}`, deletedAt: 500 },
          { key: 'rec:old-clock', deletedAt: 500 },
          { key: 'rec:split-old-clock', deletedAt: 500 }
        ]
      }
    }
  })
  for (const table of ['pomodoro_daily', 'pomodoro_interruptions', 'pomodoro_records'])
    assert.equal(db.prepare(`SELECT count(*) n FROM ${table}`).get().n, 0)
  const stale = await send([
    { key: 'rec:old-clock', value: { date, time: 90, minutes: 25, completed: true, independent: true }, updatedAt: 400 }
  ])
  assert.equal(stale.rejected[0].reason, 'deleted')
  assert.equal(db.prepare('SELECT count(*) n FROM pomodoro_daily').get().n, 0)
})

test('subject deletion removes records unseen by the deleting device, publishes tombstones, and blocks newer orphan uploads', async (t) => {
  const { db, api, request } = database(t)
  const subject = { id: 's', name: 'subject', icon: 'x', color: 'blue', chapters: [], mastery: {}, topicImportance: {} }
  const note = { id: 'unseen-note', title: 'note', subjectId: 's', updatedAt: 300, bodyUpdatedAt: 0 }
  await api('/api/data/push', {
    domains: {
      subjects: { upserts: [{ key: 's', value: subject, updatedAt: 100 }], deletes: [] },
      records: {
        upserts: [
          { ...rec('seen', 100), subjectId: 's' },
          { ...rec('unseen', 300, 20), subjectId: 's' }
        ],
        deletes: []
      },
      notes: { upserts: [note], deletes: [] },
      materials: {
        upserts: [{ id: 'keep-file', title: 'file', type: 'link', subjectId: 's', updatedAt: 300 }],
        deletes: []
      }
    }
  })
  await request('/api/note-bodies/unseen-note', 'PUT', 'body', { 'X-Updated-At': '300' })
  const baseline = await api('/api/data/pull', { full: true })
  await api('/api/data/push', { domains: { subjects: { upserts: [], deletes: [{ key: 's', deletedAt: 200 }] } } })
  assert.equal(db.prepare('SELECT count(*) n FROM study_records').get().n, 0)
  assert.equal(db.prepare('SELECT count(*) n FROM notes').get().n, 0)
  assert.equal(db.prepare('SELECT count(*) n FROM note_body_chunks').get().n, 0)
  assert.equal(db.prepare('SELECT points FROM gamification').get().points, 0)
  assert.equal(db.prepare('SELECT subject_id FROM materials').get().subject_id, null)
  const delta = await api('/api/data/pull', {
    cursors: { records: baseline.changes.records.seq, notes: baseline.changes.notes.seq }
  })
  assert.equal(delta.changes.records.deletes.length, 2)
  assert.ok(delta.changes.notes.deletes[0].deletedAt > 300)
  const stale = await api('/api/data/push', {
    domains: { records: { upserts: [{ ...rec('new-orphan', 500), subjectId: 's' }], deletes: [] } }
  })
  assert.deepEqual(stale.rejected, [{ domain: 'records', key: 'new-orphan', reason: 'deleted' }])
  await api('/api/data/push', {
    domains: {
      subjects: { upserts: [{ key: 's', value: subject, updatedAt: 600 }], deletes: [] },
      records: { upserts: [{ ...rec('restored', 600), subjectId: 's' }], deletes: [] }
    }
  })
  assert.equal(db.prepare('SELECT count(*) n FROM study_records').get().n, 1)
})

test('deleting English also cascades server-only vocabulary, reading, listening and templates', async (t) => {
  const { db, api } = database(t)
  db.exec(`INSERT INTO vocab_records(id,user_id,date,new_words,review_words,updated_at) VALUES ('v','u','2026-10-06',20,0,300);
    INSERT INTO reading_records(id,user_id,date,wpm,accuracy,updated_at) VALUES ('r','u','2026-10-06',100,1,300);
    INSERT INTO listening_records(id,user_id,date,minutes,material,mode,updated_at) VALUES ('l','u','2026-10-06',10,'material','精听',300);
    INSERT INTO essay_templates(id,user_id,title,content,updated_at) VALUES ('t','u','essay','body',300);`)
  await api('/api/data/push', { domains: { subjects: { upserts: [], deletes: [{ key: 'english', deletedAt: 200 }] } } })
  const snapshot = await api('/api/data/pull', { full: true })
  assert.deepEqual(
    new Set(snapshot.changes.english.deletes.map((item) => item.key)),
    new Set(['vocab:v', 'reading:r', 'listening:l', 'template:t'])
  )
  for (const table of ['vocab_records', 'reading_records', 'listening_records', 'essay_templates'])
    assert.equal(db.prepare(`SELECT count(*) n FROM ${table}`).get().n, 0)
})

test('a study record committed during subject deletion is included when the cascade retries its snapshot', async (t) => {
  const { db, api, pauseNextBatch } = database(t)
  await api('/api/data/push', {
    domains: {
      subjects: {
        upserts: [{ key: 'math', value: { name: 'math', icon: 'x', color: 'blue' }, updatedAt: 100 }],
        deletes: []
      }
    }
  })
  const pause = pauseNextBatch()
  const deleting = api('/api/data/push', {
    domains: { subjects: { upserts: [], deletes: [{ key: 'math', deletedAt: 200 }] } }
  })
  await pause.entered.promise
  await push(api, [rec('raced-record', 300)])
  pause.release.resolve()
  await deleting
  assert.equal(db.prepare('SELECT count(*) n FROM study_records').get().n, 0)
  assert.equal(db.prepare("SELECT deleted_at FROM sync_deletions WHERE domain='records'").get().deleted_at, 301)
})

test('challenge creation reads members inside its batch and joining failure rolls back membership and progress', async (t) => {
  const { db, api, request, pauseNextBatch, failWhen } = database(t)
  const date = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10)
  const team = await api('/api/teams', { name: 'study', isPublic: true })
  const pause = pauseNextBatch()
  const creating = api(`/api/teams/${team.id}/challenges`, {
    type: 'minutes',
    target: 50,
    durationDays: 7,
    startDate: date
  })
  await pause.entered.promise
  await request(`/api/teams/${team.id}/join`, 'POST', {}, { 'X-Test-User': 'peer' })
  pause.release.resolve()
  const challenge = await creating
  assert.equal(db.prepare('SELECT count(*) n FROM team_challenge_progress WHERE challenge_id=?').get(challenge.id).n, 2)
  db.exec("INSERT INTO users(id,username,password_hash,created_at) VALUES ('third','third','unused',1)")
  failWhen((sql) => sql.includes('INSERT OR IGNORE INTO team_challenge_progress'))
  await assert.rejects(request(`/api/teams/${team.id}/join`, 'POST', {}, { 'X-Test-User': 'third' }), /injected/)
  assert.equal(db.prepare("SELECT count(*) n FROM team_members WHERE user_id='third'").get().n, 0)
  assert.equal(db.prepare('SELECT member_count FROM study_teams').get().member_count, 2)
})

test('challenge sync repairs historical missing progress for current members before applying real study minutes', async (t) => {
  const { db, api, request } = database(t)
  const date = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10)
  const team = await api('/api/teams', { name: 'study', isPublic: true })
  await request(`/api/teams/${team.id}/join`, 'POST', {}, { 'X-Test-User': 'peer' })
  const challenge = await api(`/api/teams/${team.id}/challenges`, {
    type: 'minutes',
    target: 50,
    durationDays: 7,
    startDate: date
  })
  db.exec('DELETE FROM team_challenge_progress')
  db.prepare('INSERT INTO study_records(id,user_id,subject_id,date,minutes,created_at) VALUES (?,?,?,?,?,1)').run(
    'study',
    'peer',
    'math',
    date,
    20
  )
  const result = await (
    await request(`/api/teams/challenges/${challenge.id}/sync`, 'POST', {}, { 'X-Test-User': 'peer' })
  ).json()
  assert.equal(result.currentValue, 20)
  assert.equal(db.prepare('SELECT count(*) n FROM team_challenge_progress').get().n, 2)
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

test('0011 publishes repaired totals and historical event identities to an already synchronized frontend', async (t) => {
  const { db, api } = database(t)
  db.exec(`DROP INDEX idx_pomodoro_interruption_event;
    ALTER TABLE pomodoro_interruptions DROP COLUMN event_id;
    ALTER TABLE pomodoro_daily DROP COLUMN legacy_count;
    ALTER TABLE pomodoro_daily DROP COLUMN legacy_minutes;
    ALTER TABLE pomodoro_daily DROP COLUMN legacy_interruptions;
    ALTER TABLE pomodoro_daily DROP COLUMN legacy_updated_at;
    INSERT INTO pomodoro_daily(user_id,date,count,minutes,interruptions,updated_at,server_seq)
      VALUES ('u','2026-10-05',1,25,2,100,6);
    INSERT INTO pomodoro_records(id,user_id,date,time,minutes,updated_at,server_seq)
      VALUES ('a','u','2026-10-05',1,25,220,8),('b','u','2026-10-05',2,25,200,8);
    INSERT INTO pomodoro_interruptions(user_id,date,reason,time,updated_at,server_seq)
      VALUES ('u','2026-10-05','phone',1,160,9),('u','2026-10-05','phone',1,150,9);
    INSERT INTO sync_deletions(user_id,domain,record_key,deleted_at,seq)
      VALUES ('u','pomodoro','day:2026-10-07',230,12);
    INSERT INTO sync_domain_versions(user_id,domain,version,updated_at)
      VALUES ('u','pomodoro',4,1),('u','__push__',10,1);`)
  const frontend = {
    pomodoro: {
      daily: { '2026-10-05': { count: 1, minutes: 25, interruptions: 2, updatedAt: 100 } },
      records: [],
      interruptions: [
        { date: '2026-10-05', reason: 'phone', time: 1, updatedAt: 160 },
        { date: '2026-10-05', reason: 'phone', time: 1, updatedAt: 160 }
      ]
    }
  }
  const tombstonesBefore = db.prepare('SELECT * FROM sync_deletions').all()
  db.exec(await readFile(new URL('../migrations/0011_data_integrity.sql', import.meta.url), 'utf8'))
  assert.equal(db.prepare("SELECT version FROM sync_domain_versions WHERE domain='pomodoro'").get().version, 13)
  assert.deepEqual(db.prepare('SELECT * FROM sync_deletions').all(), tombstonesBefore)
  assert.equal(db.prepare("SELECT COUNT(*) n FROM pomodoro_daily WHERE date='2026-10-07'").get().n, 0)
  assert.equal(db.prepare('SELECT legacy_updated_at FROM pomodoro_daily').get().legacy_updated_at, 100)
  assert.equal(db.prepare('SELECT updated_at FROM pomodoro_daily').get().updated_at, 221)
  assert.deepEqual(
    db
      .prepare('SELECT updated_at FROM pomodoro_interruptions')
      .all()
      .map((row) => row.updated_at),
    [221, 221]
  )
  const delta = await api('/api/data/pull', { cursors: { pomodoro: 12 } })
  assert.equal(delta.changes.pomodoro.seq, 13)
  assert.equal(applyChanges('pomodoro', frontend, delta.changes.pomodoro), 2)
  assert.deepEqual(frontend.pomodoro.daily['2026-10-05'], { count: 2, minutes: 50, interruptions: 2, updatedAt: 221 })
  assert.deepEqual(
    frontend.pomodoro.interruptions.map((item) => item.id),
    ['legacy:1', 'legacy:2']
  )
  assert.equal(applyChanges('pomodoro', frontend, delta.changes.pomodoro), 0)
})
