import test, { beforeEach, afterEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdir, writeFile, unlink } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const data = new Map()
let failWrite = false,
  failRead = false
const tabs = []
globalThis.localStorage = {
  get length() {
    if (failRead) throw new Error('storage unavailable')
    return data.size
  },
  key(index) {
    return [...data.keys()][index] ?? null
  },
  getItem(key) {
    if (failRead) throw new Error('storage unavailable')
    return data.get(key) ?? null
  },
  setItem(key, value) {
    if (failWrite) throw new Error('quota exceeded')
    data.set(key, value)
  },
  removeItem(key) {
    data.delete(key)
  }
}
const result = await build({
  stdin: {
    contents: `export * from './src/stores/app/sync'; export * from './src/services/syncOutbox';
    export * from './src/stores/app/staging'; export * from './src/data/defaults';
    export * from './src/stores/app/importExport';
    export * from './src/stores/app/problems'; export * from './src/stores/app/pomodoro';
    export * from './src/utils/studyTime';
    export { sessionUser } from './src/services/auth'; export { syncApi } from './src/api/sync';
    export { bodyHooks } from './src/services/noteBodies'; export { ApiError } from './src/api/client';`,
    resolveDir: process.cwd()
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  external: ['vue'],
  plugins: [
    {
      name: 'frontend-boundaries',
      setup(builder) {
        builder.onResolve({ filter: /(?:services\/(auth|noteBodies)|api\/(sync|client|errorImages))$/ }, (args) => ({
          path: args.path.split('/').slice(-2).join('/'),
          namespace: 'boundary'
        }))
        builder.onLoad({ filter: /.*/, namespace: 'boundary' }, ({ path }) => {
          if (path.endsWith('/auth')) return { contents: 'export const sessionUser = {value:{id:"u"}};' }
          if (path.endsWith('/sync'))
            return {
              contents: `export const syncApi = {pullChanges:async()=>({full:true,versions:{},changes:{}}),pushChanges:async()=>({applied:{}}),pushChangesBeacon:()=>{}};`
            }
          if (path.endsWith('/client'))
            return {
              contents:
                'export class ApiError extends Error { constructor(message,status){super(message);this.status=status} }'
            }
          if (path.endsWith('/errorImages')) return { contents: 'export const clearErrorImageCache = ()=>{};' }
          return {
            contents: `export const bodyHooks={reconcile:async()=>{},flush:async()=>({revisions:new Map(),failures:[]})};
        export const setNoteBodyUser=async()=>{}; export const reconcileNoteBodies=(notes)=>bodyHooks.reconcile(notes);
        export const flushPendingNoteBodies=()=>bodyHooks.flush(); export const hasPendingNoteBodies=()=>false;
        export const getNoteBody=()=>'';export const queueNoteBody=()=>{};export const clearAllNoteBodies=()=>{};`
          }
        })
      }
    }
  ]
})
await mkdir('.cache/frontend-sync-tests', { recursive: true })
const filename = `.cache/frontend-sync-tests/${crypto.randomUUID()}.mjs`
await writeFile(filename, result.outputFiles[0].text)
const url = pathToFileURL(`${process.cwd()}/${filename}`).href
async function tab() {
  const app = await import(`${url}?tab=${crypto.randomUUID()}`)
  const store = Object.assign(
    app.createDefaultState(),
    app.syncActions,
    app.importExportActions,
    app.problemsActions,
    app.pomodoroActions,
    {
      addPoints() {},
      revokePointsByRef() {},
      migrateErrorImages() {},
      $patch(patch) {
        Object.assign(this, patch)
      }
    }
  )
  Object.defineProperty(store, '$state', { get: () => store })
  tabs.push({ app, store })
  return { app, store }
}
function deferred() {
  let resolve
  const promise = new Promise((r) => {
    resolve = r
  })
  return { promise, resolve }
}
const settle = () => new Promise((resolve) => setImmediate(resolve))
const remote = (upserts = [], deletes = []) => ({
  full: true,
  versions: {},
  changes: { records: { seq: 10, upserts, deletes } }
})
beforeEach(() => {
  data.clear()
  failWrite = false
  failRead = false
})
afterEach(() => {
  for (const { store } of tabs.splice(0)) store.resetState()
})
after(() => unlink(filename))

test('default chapters and topics are isolated across state factories and restore-defaults', async () => {
  const { app } = await tab()
  const a = app.createDefaultState(),
    b = app.createDefaultState()
  for (let i = 0; i < 2; i++) {
    a.subjects[i].chapters[0].name = 'private account A'
    a.subjects[i].chapters[0].topics.push('private topic')
    assert.notEqual(b.subjects[i].chapters[0].name, 'private account A')
    assert.ok(!app.defaultSubjects()[i].chapters[0].topics.includes('private topic'))
  }
})

test('two offline tabs preserve different records across reload; ACK only removes captured operations', async () => {
  const a = (await tab()).app,
    b = (await tab()).app
  a.setOutboxUser('u')
  b.setOutboxUser('u')
  a.stageUpsert('records', 'a', { id: 'a' }, 100)
  b.stageUpsert('records', 'b', { id: 'b' }, 101)
  const snapshot = a.takeForFlush()
  assert.deepEqual(Object.keys(snapshot.upserts.records).sort(), ['a', 'b'])
  b.stageUpsert('records', 'b', { id: 'b', minutes: 50 }, 102)
  a.ack(snapshot)
  const reloaded = (await tab()).app
  reloaded.setOutboxUser('u')
  assert.equal(reloaded.takeForFlush().upserts.records.b.value.minutes, 50)
  assert.equal(reloaded.size(), 1)
})

test('same-millisecond edits have stable order, detach mutable inputs, and coexist with tombstones', async () => {
  const { app } = await tab()
  app.setOutboxUser('u')
  const input = { id: 'r', text: 'first' }
  app.stageUpsert('records', 'r', input, 100)
  input.text = 'not staged'
  assert.equal(app.takeForFlush().upserts.records.r.value.text, 'first')
  app.stageDelete('records', 'r', 100)
  assert.equal(app.takeForFlush().deletes.records.r, 100)
  app.stageUpsert('records', 'r', { id: 'r', text: 'last' }, 100)
  const snapshot = app.takeForFlush()
  assert.equal(snapshot.upserts.records.r.value.text, 'last')
  assert.equal(snapshot.deletes.records, undefined)
  const reloaded = (await tab()).app
  reloaded.setOutboxUser('u')
  assert.equal(reloaded.takeForFlush().upserts.records.r.value.text, 'last')
})

test('account switch rejects stale ACK and never mixes queue buckets', async () => {
  const { app } = await tab()
  app.setOutboxUser('a')
  app.stageUpsert('records', 'r', { id: 'r', owner: 'a' }, 100)
  const old = app.takeForFlush()
  app.setOutboxUser('b')
  app.stageUpsert('records', 'r', { id: 'r', owner: 'b' }, 101)
  app.ack(old)
  assert.equal(app.takeForFlush().upserts.records.r.value.owner, 'b')
  app.setOutboxUser('a')
  assert.equal(app.takeForFlush().upserts.records.r.value.owner, 'a')
})

test('legacy queue migration survives quota failure and repeated migration without duplicate points', async () => {
  const legacy = {
    upserts: { records: { r: { value: { id: 'r' }, updatedAt: 100 } } },
    deletes: {},
    points: [{ op: 'award', refId: 'checkin:2026-09-27', points: 10 }],
    achievements: ['first'],
    savedAt: 100
  }
  const original = JSON.stringify(legacy)
  data.set('zsb_sync_outbox_v1:u', original)
  failWrite = true
  const a = (await tab()).app
  a.setOutboxUser('u')
  assert.equal(data.get('zsb_sync_outbox_v1:u'), original)
  assert.match(a.outboxIssue.value, /本地存储不可用/)
  failWrite = false
  const b = (await tab()).app
  b.setOutboxUser('u')
  assert.equal(data.has('zsb_sync_outbox_v1:u'), false)
  assert.equal(b.takeForFlush().points.length, 1)
  assert.equal(a.takeForFlush().points.length, 1)
  b.ack(b.takeForFlush())
  assert.equal(a.size(), 0)
})

test('storage failure remains visible and volatile edits can be saved after storage recovers', async () => {
  const { app } = await tab()
  app.setOutboxUser('u')
  failWrite = true
  app.stageUpsert('records', 'r', { id: 'r' }, 100)
  assert.equal(app.hasVolatileOutboxChanges(), true)
  assert.match(app.syncIssue.value, /仅保留在当前页面/)
  assert.equal(app.takeForFlush().upserts.records.r.value.id, 'r')
  failWrite = false
  app.takeForFlush()
  assert.equal(app.hasVolatileOutboxChanges(), false)
  assert.equal(app.syncIssue.value, null)
  const reload = (await tab()).app
  reload.setOutboxUser('u')
  assert.equal(reload.size(), 1)
})

test('corrupt or inaccessible storage is preserved and reported, not silently reset', async () => {
  const { app } = await tab()
  data.set('zsb_sync_outbox_v2:u:corrupt', '{')
  app.setOutboxUser('u')
  assert.match(app.outboxIssue.value, /无法读取/)
  assert.equal(data.get('zsb_sync_outbox_v2:u:corrupt'), '{')
  failRead = true
  assert.equal(app.takeForFlush(), null)
  assert.match(app.outboxIssue.value, /无法读取/)
})

test('cursor advancement in tab A does not make tab B skip unseen server changes', async () => {
  const a = (await tab()).app,
    b = (await tab()).app
  a.saveCursors('u', { records: 10 })
  b.saveCursors('u', { records: 10 })
  a.saveCursors('u', { records: 11 })
  assert.equal(b.loadCursors('u').records, 10)
  const returned = b.loadCursors('u')
  returned.records = 999
  assert.equal(b.loadCursors('u').records, 10)
  assert.equal((await tab()).app.loadCursors('u').records, undefined)
})

test('hydrate restores pending create/edit/delete and note metadata before body reconcile', async () => {
  const { app, store } = await tab()
  app.setOutboxUser('u')
  app.stageUpsert('records', 'r', { id: 'r', minutes: 50 }, 200)
  app.stageUpsert('records', 'new', { id: 'new', minutes: 30 }, 201)
  app.stageDelete('records', 'gone', 201)
  app.stageUpsert('notes', 'note', { id: 'note', title: 'offline', bodyUpdatedAt: 200 }, 200)
  app.bodyHooks.reconcile = async (notes) => assert.equal(notes[0].id, 'note')
  app.syncApi.pullChanges = async () =>
    remote([
      { id: 'r', minutes: 10, updatedAt: 100 },
      { id: 'gone', updatedAt: 100 }
    ])
  await store.hydrate()
  assert.equal(store.records.find((r) => r.id === 'r').minutes, 50)
  assert.equal(store.records.find((r) => r.id === 'new').minutes, 30)
  assert.ok(!store.records.some((r) => r.id === 'gone'))
  assert.equal(app.size(), 0)
})

test('hydrate never resurrects an older pending record over a newer remote tombstone', async () => {
  const { app, store } = await tab()
  app.setOutboxUser('u')
  app.stageUpsert('records', 'r', { id: 'r', minutes: 50 }, 100)
  app.syncApi.pullChanges = async () => remote([], [{ key: 'r', deletedAt: 200 }])
  await store.hydrate()
  assert.ok(!store.records.some((r) => r.id === 'r'))
})

test('two questions keep their history and aggregates through failed sync, cold reload and later cloud reload', async () => {
  const first = await tab()
  await first.store.hydrate()
  first.app.syncApi.pushChanges = async () => {
    throw new first.app.ApiError('offline', 503)
  }
  first.store.addProblemSession({ subjectId: 'math', date: '2026-10-05', total: 2, correct: 1, types: { choice: 2 } })
  const id = first.store.problemSessions[0].id
  assert.equal((await first.store.flushOutbox()).ok, false)
  assert.equal(first.app.takeForFlush().upserts.problemSessions[id].value.total, 2)
  first.store.resetState()

  const second = await tab()
  let cloud = [],
    coldRequest
  second.app.syncApi.pullChanges = async (request) => {
    coldRequest = request
    return { full: true, versions: {}, changes: { problemSessions: { seq: 0, upserts: cloud, deletes: [] } } }
  }
  second.app.syncApi.pushChanges = async (payload) => {
    cloud = payload.domains.problemSessions?.upserts ?? cloud
    return { applied: { problemSessions: cloud.length } }
  }
  await second.store.hydrate()
  assert.deepEqual(coldRequest, { full: true })
  assert.equal(second.store.problemSessions.length, 1)
  assert.equal(second.store.problemSessions[0].id, id)
  assert.deepEqual([second.store.problemSessions[0].total, second.store.problemSessions[0].correct], [2, 1])
  assert.equal(second.app.size(), 0)

  second.store.resetState()
  const third = await tab()
  third.app.syncApi.pullChanges = async (request) => {
    assert.deepEqual(request, { full: true })
    return {
      full: true,
      versions: { problemSessions: 1 },
      changes: { problemSessions: { seq: 1, upserts: cloud, deletes: [] } }
    }
  }
  await third.store.hydrate()
  assert.equal(third.store.problemSessions.length, 1)
  const total = third.store.problemSessions.reduce((sum, session) => sum + session.total, 0)
  const correct = third.store.problemSessions.reduce((sum, session) => sum + session.correct, 0)
  assert.deepEqual([total, Math.round((correct / total) * 100)], [2, 50])
})

test('a settled focus minute survives cold reload and contributes to study time once', async () => {
  const first = await tab()
  await first.store.hydrate()
  first.app.syncApi.pushChanges = async () => {
    throw new first.app.ApiError('offline', 503)
  }
  first.store.recordPomodoro(1, '自然完成')
  assert.equal(first.app.totalStudyMinutes(first.store), 1)
  first.store.resetState()
  const second = await tab()
  await second.store.hydrate()
  const day = second.store.pomodoro.records[0].date
  assert.deepEqual([second.store.pomodoro.daily[day].count, second.app.studyMinutesOn(second.store, day)], [1, 1])
  assert.equal(second.app.studyMinutesByDate(second.store)[day], 1)
  second.store.records.push({ id: 'manual', subjectId: 'math', date: day, minutes: 4 })
  assert.equal(second.app.totalStudyMinutes(second.store), 5)
})

test('new-user defaults do not overwrite pending customizations or deleted default subjects', async () => {
  const { app, store } = await tab()
  app.setOutboxUser('u')
  const subject = { ...store.subjects[0], name: 'pending custom math' }
  app.stageUpsert('subjects', subject.id, subject, 200)
  app.stageDelete('subjects', 'english', 201)
  let sent
  app.syncApi.pushChanges = async (payload) => {
    sent = payload
    return { applied: {} }
  }
  await store.hydrate()
  assert.equal(sent.domains.subjects.upserts.find((r) => r.key === subject.id).updatedAt, 200)
  assert.equal(store.subjects.find((r) => r.id === subject.id).name, 'pending custom math')
  assert.ok(!store.subjects.some((r) => r.id === 'english'))
})

test('flush is single-flight; saveAsync drains edits staged during the preceding request', async () => {
  const { app, store } = await tab()
  await store.hydrate()
  app.stageUpsert('records', 'a', { id: 'a' }, 100)
  const response = deferred()
  let calls = 0
  app.syncApi.pushChanges = async () => {
    calls++
    if (calls === 1) await response.promise
    return { applied: {} }
  }
  const first = store.flushOutbox()
  await settle()
  app.stageUpsert('records', 'b', { id: 'b' }, 101)
  const second = store.saveAsync()
  await settle()
  assert.equal(calls, 1)
  response.resolve()
  await first
  assert.equal(await second, true)
  assert.equal(calls, 2)
  assert.equal(app.size(), 0)
})

test('push/pull 409 conflicts retry at most three times and retain pending state on exhaustion', async () => {
  const { app, store } = await tab()
  let pulls = 0
  app.syncApi.pullChanges = async () => {
    if (++pulls < 3) throw new app.ApiError('conflict', 409)
    return remote()
  }
  await store.hydrate()
  assert.equal(pulls, 3)
  app.stageUpsert('records', 'r', { id: 'r' }, 100)
  let pushes = 0
  app.syncApi.pushChanges = async () => {
    pushes++
    throw new app.ApiError('conflict', 409)
  }
  assert.equal((await store.flushOutbox()).ok, false)
  assert.equal(pushes, 3)
  assert.equal(app.size(), 1)
})

test('old account response cannot ACK a new account operation', async () => {
  const { app, store } = await tab()
  await store.hydrate()
  app.stageUpsert('records', 'a', { id: 'a' }, 100)
  const response = deferred()
  app.syncApi.pushChanges = () => response.promise
  const pending = store.flushOutbox()
  await settle()
  store.resetState()
  app.sessionUser.value = { id: 'b' }
  app.setOutboxUser('b')
  app.stageUpsert('records', 'b', { id: 'b' }, 200)
  response.resolve({ applied: {}, gamification: { points: 999 } })
  assert.equal((await pending).ok, false)
  assert.equal(app.takeForFlush().upserts.records.b.value.id, 'b')
  assert.equal(store.gamification.points, 0)
})

test('backup import restores business facts but never stages arbitrary backup point awards', async () => {
  const { app, store } = await tab()
  app.setOutboxUser('u')
  const backup = app.createDefaultState()
  backup.gamification.points = 999999
  backup.gamification.pointsLog = [{ date: '2026-09-27', points: 999999, reason: 'fake reward', refId: 'fake' }]
  assert.equal(store.importJSON(JSON.stringify(backup)), true)
  const pending = app.takeForFlush()
  assert.ok(pending.points.every((event) => event.op !== 'award'))
  assert.ok(pending.upserts.subjects)
  assert.equal(store.gamification.points, 999999)
})

test('same-millisecond sequential writes in different tabs keep the later operation', async () => {
  const a = (await tab()).app,
    b = (await tab()).app
  a.setOutboxUser('u')
  b.setOutboxUser('u')
  const originalNow = Date.now
  Date.now = () => 1000
  try {
    a.stageUpsert('records', 'r', { id: 'r', text: 'a' }, 100)
    b.stageUpsert('records', 'r', { id: 'r', text: 'b' }, 100)
    assert.equal(a.takeForFlush().upserts.records.r.value.text, 'b')
    assert.equal(b.takeForFlush().upserts.records.r.value.text, 'b')
  } finally {
    Date.now = originalNow
  }
})

test('failed initial push still shows recovered edits and exposes a retryable error', async () => {
  const { app, store } = await tab()
  app.setOutboxUser('u')
  app.stageUpsert('records', 'r', { id: 'r', minutes: 50 }, 200)
  app.syncApi.pullChanges = async () => remote([{ id: 'r', minutes: 10, updatedAt: 100 }])
  app.syncApi.pushChanges = async () => {
    throw new app.ApiError('unavailable', 503)
  }
  await store.hydrate()
  assert.equal(store.records[0].minutes, 50)
  assert.equal(app.size(), 1)
  assert.match(app.syncIssue.value, /同步失败/)
})

test('rejected or clock-clamped edits adopt authoritative state while later pending edits survive', async () => {
  const { app, store } = await tab()
  await store.hydrate()
  app.stageUpsert('records', 'r', { id: 'r', minutes: 10 }, 100)
  app.syncApi.pushChanges = async () => {
    app.stageUpsert('records', 'later', { id: 'later', minutes: 30 }, 300)
    return { applied: {}, rejected: [{ domain: 'records', key: 'r', reason: 'older' }] }
  }
  app.syncApi.pullChanges = async () => remote([{ id: 'r', minutes: 50, updatedAt: 200 }])
  const result = await store.flushOutbox()
  assert.equal(result.rejected, 1)
  assert.equal(store.records.find((r) => r.id === 'r').minutes, 50)
  assert.equal(store.records.find((r) => r.id === 'later').minutes, 30)
  assert.equal(app.size(), 1)
})

test('409 retry is cancelled when the active account changes during backoff', async () => {
  const { app, store } = await tab()
  await store.hydrate()
  app.stageUpsert('records', 'r', { id: 'r' }, 100)
  let calls = 0
  app.syncApi.pushChanges = async () => {
    calls++
    throw new app.ApiError('conflict', 409)
  }
  const pending = store.flushOutbox()
  await settle()
  store.resetState()
  app.sessionUser.value = { id: 'other' }
  app.setOutboxUser('other')
  app.stageUpsert('records', 'other', { id: 'other' }, 200)
  assert.equal((await pending).ok, false)
  assert.equal(calls, 1)
  assert.equal(app.size(), 1)
})

test('partial legacy migration keeps the source bucket until every operation is durable', async () => {
  data.set(
    'zsb_sync_outbox_v1:u',
    JSON.stringify({
      upserts: { records: { r: { value: { id: 'r' }, updatedAt: 100 } } },
      deletes: {},
      points: [{ op: 'award', refId: 'daily', points: 10 }],
      achievements: [],
      savedAt: 100
    })
  )
  const originalSet = localStorage.setItem
  let writes = 0
  localStorage.setItem = (key, value) => {
    if (++writes === 2) throw new Error('quota')
    originalSet(key, value)
  }
  try {
    const a = (await tab()).app
    a.setOutboxUser('u')
    assert.equal(data.has('zsb_sync_outbox_v1:u'), true)
    localStorage.setItem = originalSet
    const b = (await tab()).app
    b.setOutboxUser('u')
    assert.equal(data.has('zsb_sync_outbox_v1:u'), false)
    assert.equal(b.takeForFlush().points.length, 1)
    assert.equal(b.size(), 2)
  } finally {
    localStorage.setItem = originalSet
  }
})

test('authority snapshot converges optimistic learning points to the server daily allowance', async () => {
  const { app, store } = await tab()
  await store.hydrate()
  store.gamification.points = 305
  store.gamification.pointsLog = [{ date: '2026-09-27', points: 305, reason: 'optimistic', refId: 'local' }]
  app.stagePoints({ op: 'award', refId: 'local', points: 5, reason: 'learning' })
  const authoritative = {
    ...app.createDefaultState().gamification,
    points: 300,
    pointsLog: [{ date: '2026-09-27', points: 300, reason: 'confirmed', refId: 'confirmed' }]
  }
  app.syncApi.pushChanges = async () => ({ applied: {}, awarded: [], gamification: authoritative })
  assert.equal((await store.flushOutbox()).ok, true)
  assert.deepEqual(store.gamification, authoritative)
})

test('concurrent manual syncs share one pull so older responses cannot rewind the state cursor', async () => {
  const { app, store } = await tab()
  await store.hydrate()
  const response = deferred()
  let pulls = 0
  app.syncApi.pullChanges = async () => {
    pulls++
    return response.promise
  }
  const a = store.syncNow(),
    b = store.syncNow()
  await settle()
  assert.equal(pulls, 1)
  response.resolve(remote([{ id: 'r', updatedAt: 100 }]))
  await Promise.all([a, b])
  assert.equal(store.records.length, 1)
})

test('delete-then-restore coalesces to the last intent even when backup metadata has an older timestamp', async () => {
  const { app } = await tab()
  app.setOutboxUser('u')
  app.stageDelete('notes', 'n', 200)
  app.stageUpsert('notes', 'n', { id: 'n', title: 'restored', updatedAt: 100 }, 100)
  const snapshot = app.takeForFlush()
  assert.equal(snapshot.deletes.notes, undefined)
  assert.equal(snapshot.upserts.notes.n.value.title, 'restored')
})

test('a large save drains more than four bounded batches and leaves edits staged during the drain queued', async () => {
  const { app, store } = await tab()
  await store.hydrate()
  for (let i = 0; i < 1050; i++) app.stageUpsert('records', `r${i}`, { id: `r${i}`, minutes: 10 }, 100)
  const persisted = new Set()
  let calls = 0
  app.syncApi.pushChanges = async (payload) => {
    calls++
    const records = payload.domains.records.upserts
    assert.ok(records.length <= 100)
    for (const record of records) persisted.add(record.id)
    // New work in another tab must not extend this save's target indefinitely.
    app.stageUpsert('records', `later${calls}`, { id: `later${calls}` }, 200)
    return { applied: { records: records.length } }
  }
  assert.equal(await store.saveAsync(), true)
  assert.equal(calls, 11)
  assert.equal(persisted.size, 1050)
  assert.equal(app.size(), 11)
  assert.ok(Object.keys(app.takeForFlush().upserts.records).every((key) => key.startsWith('later')))
})

test('a backup larger than the server request limit is split by UTF-8 bytes without truncating recovery snapshots', async () => {
  const { app, store } = await tab()
  await store.hydrate()
  for (let i = 0; i < 15; i++) app.stageUpsert('notes', `n${i}`, { id: `n${i}`, title: '备份'.repeat(125000) }, 100)
  const complete = app.takeForFlush()
  assert.equal(Object.keys(complete.upserts.notes).length, 15)
  assert.ok(new TextEncoder().encode(JSON.stringify(complete)).byteLength > 10 * 1024 * 1024)
  let calls = 0,
    applied = 0
  app.syncApi.pushChanges = async (payload) => {
    calls++
    assert.ok(new TextEncoder().encode(JSON.stringify(payload)).byteLength <= 2 * 1024 * 1024)
    applied += payload.domains.notes.upserts.length
    return { applied: { notes: payload.domains.notes.upserts.length } }
  }
  const result = await store.flushOutbox()
  assert.equal(result.ok, true)
  assert.equal(result.applied, 15)
  assert.equal(applied, 15)
  assert.ok(calls > 1)
  assert.equal(app.size(), 0)
})

test('pomodoro completion intents follow their business records across batch boundaries', async () => {
  const { app, store } = await tab()
  await store.hydrate()
  app.stagePoints({ op: 'award', refId: 'p', reason: '完成番茄钟', points: 5 })
  for (let i = 0; i < 150; i++) app.stageUpsert('records', `r${i}`, { id: `r${i}` }, 100)
  app.stageUpsert('pomodoro', 'rec:p', { id: 'p', minutes: 25 }, 100)
  let persisted = false,
    awarded = false
  app.syncApi.pushChanges = async (payload) => {
    if (payload.domains.pomodoro?.upserts.some((item) => item.key === 'rec:p')) persisted = true
    if (payload.points.some((event) => event.refId === 'p')) {
      assert.equal(persisted, true)
      awarded = true
    }
    return { applied: {} }
  }
  assert.equal((await store.flushOutbox()).ok, true)
  assert.equal(awarded, true)
  assert.equal(app.size(), 0)
})

test('rate limiting stops a drain after exact ACK and its remaining batches can resume', async () => {
  const { app, store } = await tab()
  await store.hydrate()
  for (let i = 0; i < 250; i++) app.stageUpsert('records', `r${i}`, { id: `r${i}` }, 100)
  let calls = 0
  app.syncApi.pushChanges = async (payload) => {
    if (++calls === 2) throw new app.ApiError('请求过于频繁，请稍后再试', 429)
    return { applied: { records: payload.domains.records.upserts.length } }
  }
  const result = await store.flushOutbox()
  assert.equal(result.ok, false)
  assert.equal(result.applied, 100)
  assert.equal(calls, 2)
  assert.equal(app.size(), 150)
  assert.match(app.syncIssue.value, /429/)
  assert.equal(await store.saveAsync(), true)
  assert.equal(calls, 4)
  assert.equal(app.size(), 0)
})

test('one aggregate larger than the target batch size remains eligible and ACK retains its newer revision', async () => {
  const { app } = await tab()
  app.setOutboxUser('u')
  app.stageUpsert('subjects', 's', { id: 's', chapters: 'x'.repeat(3 * 1024 * 1024) }, 100)
  app.stageUpsert('records', 'r', { id: 'r' }, 100)
  const complete = app.takeForFlush()
  const batch = app.takeForFlush({ keys: new Set(complete.receipt.keys), maxChanges: 100, maxBytes: 2 * 1024 * 1024 })
  assert.equal(Object.keys(batch.upserts.subjects).length, 1)
  assert.equal(batch.upserts.records, undefined)
  assert.equal(Object.keys(app.takeForFlush().upserts).length, 2)
  app.stageUpsert('subjects', 's', { id: 's', name: 'new revision' }, 200)
  app.ack(batch)
  assert.equal(app.size(), 2)
  assert.equal(app.takeForFlush().upserts.subjects.s.value.name, 'new revision')
})
