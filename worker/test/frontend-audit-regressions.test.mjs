import test, { after, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdir, writeFile, unlink } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createPinia, setActivePinia } from 'pinia'

const data = new Map()
globalThis.localStorage = {
  get length() {
    return data.size
  },
  key(i) {
    return [...data.keys()][i] ?? null
  },
  getItem: (key) => data.get(key) ?? null,
  setItem: (key, value) => data.set(key, String(value)),
  removeItem: (key) => data.delete(key)
}
globalThis.document = { hidden: false, addEventListener() {}, removeEventListener() {} }
globalThis.window = { addEventListener() {}, removeEventListener() {} }
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } })
globalThis.fetch = async () => ({ ok: true, status: 200, json: () => globalThis.__frontendFix.uploadJson() })
const built = await build({
  stdin: {
    contents: `export * from './src/services/noteBodies'; export * from './src/services/syncOutbox';
      export * from './src/stores/app/errors'; export * from './src/stores/app/importExport';
      export * from './src/stores/app/subjects'; export * from './src/stores/app/pomodoro';
      export * from './src/stores/app/notes';
      export * from './src/stores/app/sync'; export * from './src/utils/session';
      export * from './src/stores/studyTimer'; export * from './src/data/defaults';`,
    resolveDir: process.cwd()
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  external: ['vue', 'pinia'],
  define: { __DESKTOP_BUILD__: 'false', 'import.meta.env': '{"VITE_API_BASE":"https://test.invalid"}' },
  plugins: [
    {
      name: 'isolated-network',
      setup(b) {
        b.onResolve(
          { filter: /(?:api\/(?:noteBodies|sync|community\/partners)|services\/auth|^\.\/app)$/ },
          ({ path }) => ({ path, namespace: 'boundary' })
        )
        b.onLoad({ filter: /.*/, namespace: 'boundary' }, ({ path }) => {
          if (path.endsWith('auth')) return { contents: `export const sessionUser=globalThis.__frontendFix.user;` }
          if (path.endsWith('/app'))
            return { contents: `export const useAppStore=()=>globalThis.__frontendFix.timerApp;` }
          if (path.endsWith('/partners'))
            return {
              contents: `export const partnersApi={endStudySession:async()=>({ok:true}),updateStudySession:(...a)=>globalThis.__frontendFix.partnerUpdate(...a)};`
            }
          if (path.endsWith('/sync'))
            return {
              contents: `export const syncApi={pushChanges:(...a)=>globalThis.__frontendFix.push(...a),pullChanges:(...a)=>globalThis.__frontendFix.pullChanges(...a),pushChangesBeacon(){}};`
            }
          return {
            contents: `export const fetchNoteBodyLimit=async()=>1048576; export const putNoteBody=(...a)=>globalThis.__frontendFix.put(...a); export const pullNoteBodies=(...a)=>globalThis.__frontendFix.pull(...a);`
          }
        })
      }
    }
  ]
})
await mkdir('.cache/frontend-audit-tests', { recursive: true })
const file = resolve('.cache/frontend-audit-tests', `${crypto.randomUUID()}.mjs`)
await writeFile(file, built.outputFiles[0].text)
after(() => unlink(file))
const stores = []
afterEach(() => {
  for (const store of stores.splice(0)) store.resetState?.()
})
const settle = () => new Promise((r) => setImmediate(r))
function deferred() {
  let resolve
  const promise = new Promise((r) => {
    resolve = r
  })
  return { promise, resolve }
}
async function fixture() {
  data.clear()
  globalThis.__frontendFix = {
    user: { value: { id: 'A' } },
    uploadJson: async () => ({ id: 'image-id' }),
    put: async (_, __, at) => ({ applied: true, updatedAt: at }),
    pull: async () => [],
    partnerUpdate: async () => ({ session: { status: 'active' } }),
    push: async () => ({ applied: {}, rejected: [] }),
    pullChanges: async () => ({ full: true, versions: {}, changes: {} })
  }
  const app = await import(`${pathToFileURL(file).href}?fixture=${crypto.randomUUID()}`)
  app.setOutboxUser('A')
  app.markSessionActive('A')
  await app.setNoteBodyUser('A')
  return { app, hooks: globalThis.__frontendFix }
}

test('legacy image migration cannot stage old private questions or upload the next image after switching accounts', async () => {
  const { app, hooks } = await fixture()
  const pending = deferred()
  let uploads = 0
  hooks.uploadJson = () => {
    uploads++
    return pending.promise
  }
  const questions = [1, 2].map((i) => ({
    id: `private-A-${i}`,
    image: 'data:image/png;base64,AA==',
    content: 'private A'
  }))
  const store = {
    errorQuestions: questions,
    save() {
      throw new Error('stale save')
    }
  }
  const migration = app.errorsActions.migrateErrorImages.call(store)
  await settle()
  app.setOutboxUser('B')
  app.markSessionActive('B')
  hooks.user.value = { id: 'B' }
  store.errorQuestions = []
  pending.resolve({ id: 'image-A' })
  await migration
  assert.equal(app.takeForFlush(), null)
  assert.equal(uploads, 1)
  assert.ok(questions.every((q) => q.image.startsWith('data:')))
})

for (const deleted of [false, true])
  test(`late note conflict pull preserves a ${deleted ? 'deletion' : 'new edit'}`, async () => {
    const { app, hooks } = await fixture()
    const pending = deferred()
    hooks.put = async () => ({ applied: false, updatedAt: 200 })
    hooks.pull = () => pending.promise
    app.queueNoteBody('note', 'old local', 100)
    const flight = app.flushPendingNoteBodies()
    await settle()
    if (deleted) app.removeNoteBody('note')
    else app.queueNoteBody('note', 'new edit', 300)
    pending.resolve([{ id: 'note', content: 'old remote', updatedAt: 200 }])
    await flight
    assert.equal(app.getNoteBody('note'), deleted ? '' : 'new edit')
    assert.equal(app.pendingNoteBodyIds.value.has('note'), !deleted)
  })

function importStore(app, previous) {
  const store = Object.assign(app.createDefaultState(), app.importExportActions, {
    notes: previous,
    save() {},
    $patch(p) {
      Object.assign(this, p)
    }
  })
  Object.defineProperty(store, '$state', { get: () => store })
  return store
}
for (const empty of [false, true])
  test(`restoring an old ${empty ? 'empty' : 'nonempty'} note creates newer metadata and body revisions`, async () => {
    const { app, hooks } = await fixture()
    const old = { id: 'note', subjectId: 'math', title: 'old backup', tags: [], updatedAt: 100, bodyUpdatedAt: 100 }
    const backup = app.createDefaultState()
    backup.notes = [old]
    backup.noteBodies = { note: { content: empty ? '' : 'backup body', updatedAt: 100 } }
    const newer = Date.now() + 1000
    const store = importStore(app, [{ ...old, title: 'current', updatedAt: newer, bodyUpdatedAt: newer }])
    assert.equal(store.importJSON(JSON.stringify(backup)), true)
    const note = app.takeForFlush().upserts.notes.note
    assert.ok(note.updatedAt > newer)
    let uploaded
    hooks.put = async (_, content, at) => {
      uploaded = { content, at }
      return { applied: true, updatedAt: at }
    }
    assert.equal((await app.flushPendingNoteBodies()).failures.length, 0)
    assert.equal(uploaded.content, empty ? '' : 'backup body')
    assert.equal(uploaded.at, note.updatedAt)
    const exported = JSON.parse(await store.exportJSON())
    assert.equal(exported.noteBodies.note.content, uploaded.content)
  })

test('a rejected backup body keeps recovery content, reports failure and retries past the authoritative tombstone', async () => {
  const { app, hooks } = await fixture()
  app.queueNoteBody('restore', 'backup survives', 100, true)
  hooks.put = async () => ({ applied: false, updatedAt: Date.now() + 1000 })
  const rejected = await app.flushPendingNoteBodies()
  assert.equal(rejected.failures.length, 1)
  assert.match(rejected.failures[0].reason, /保留待重试/)
  assert.equal(app.getNoteBody('restore'), 'backup survives')
  assert.equal(app.pendingNoteBodyIds.value.has('restore'), true)
  assert.ok(rejected.revisions.get('restore').to > Date.now())
  hooks.put = async (_, __, at) => ({ applied: true, updatedAt: at })
  assert.equal((await app.flushPendingNoteBodies()).failures.length, 0)
  assert.equal(app.getNoteBody('restore'), 'backup survives')
})

test('a rejected backup metadata restore remains queued and saveAsync reports failure, then completes on retry', async () => {
  const { app, hooks } = await fixture()
  const store = Object.assign(importStore(app, []), app.syncActions, { migrateErrorImages() {} })
  stores.push(store)
  await store.hydrate()
  const backup = app.createDefaultState()
  backup.notes = [
    { id: 'restore', subjectId: 'math', title: 'backup title', tags: [], updatedAt: 100, bodyUpdatedAt: 100 }
  ]
  backup.noteBodies = { restore: { content: 'backup survives', updatedAt: 100 } }
  assert.equal(store.importJSON(JSON.stringify(backup)), true)
  const tombstone = Date.now() + 2000
  hooks.push = async () => ({ applied: {}, rejected: [{ domain: 'notes', key: 'restore', reason: 'deleted' }] })
  hooks.pullChanges = async () => ({
    full: true,
    versions: {},
    changes: { notes: { seq: 10, upserts: [], deletes: [{ key: 'restore', deletedAt: tombstone }] } }
  })
  assert.equal(await store.saveAsync(), false)
  assert.match(app.syncIssue.value, /备份笔记.*保留/)
  assert.equal(store.notes.find((n) => n.id === 'restore').title, 'backup title')
  assert.ok(app.takeForFlush().upserts.notes.restore.updatedAt > tombstone)
  assert.equal(app.getNoteBody('restore'), 'backup survives')
  hooks.push = async () => ({ applied: { notes: 1 }, rejected: [] })
  assert.equal(await store.saveAsync(), true)
  assert.equal(app.isNoteRestorePending('restore'), false)
})

test('removing English stages template tombstones along with the other English collections', async () => {
  const { app } = await fixture()
  const store = Object.assign(app.createDefaultState(), { save() {}, revokePointsByRef() {} })
  store.english.templates = [{ id: 'template', title: 'saved', content: 'body', level: 1 }]
  app.subjectsActions.removeSubject.call(store, 'english')
  assert.equal(store.english.templates.length, 0)
  assert.equal(typeof app.takeForFlush().deletes.english['template:template'], 'number')
})

for (const duringPush of [false, true])
  for (const deleted of duringPush ? [false] : [false, true])
    test(`metadata recovery ${duringPush ? 'push' : 'pull'} preserves a ${deleted ? 'new deletion' : 'new title and body edit'}`, async () => {
      const { app, hooks } = await fixture()
      const store = Object.assign(importStore(app, []), app.syncActions, app.notesActions, { migrateErrorImages() {} })
      stores.push(store)
      await store.hydrate()
      const backup = app.createDefaultState()
      backup.notes = [
        { id: 'restore', subjectId: 'math', title: 'old backup', tags: [], updatedAt: 100, bodyUpdatedAt: 100 }
      ]
      backup.noteBodies = { restore: { content: 'old body', updatedAt: 100 } }
      assert.equal(store.importJSON(JSON.stringify(backup)), true)
      const pending = deferred()
      const rejected = { applied: {}, rejected: [{ domain: 'notes', key: 'restore', reason: 'deleted' }] }
      const remote = {
        full: true,
        versions: {},
        changes: { notes: { seq: 10, upserts: [], deletes: [{ key: 'restore', deletedAt: Date.now() + 2000 }] } }
      }
      hooks.push = () => (duringPush ? pending.promise : Promise.resolve(rejected))
      hooks.pullChanges = () => (duringPush ? Promise.resolve(remote) : pending.promise)
      const flight = store.saveAsync()
      await settle()
      if (deleted) store.deleteNote('restore')
      else store.saveNote({ id: 'restore', subjectId: 'math', title: 'NEW title', content: 'NEW body' })
      pending.resolve(duringPush ? rejected : remote)
      assert.equal(await flight, false)
      if (deleted) {
        assert.equal(store.notes.length, 0)
        assert.equal(typeof app.takeForFlush().deletes.notes.restore, 'number')
        assert.equal(app.getNoteBody('restore'), '')
      } else {
        assert.equal(store.notes.find((n) => n.id === 'restore').title, 'NEW title')
        assert.equal(app.getNoteBody('restore'), 'NEW body')
        assert.equal(app.takeForFlush().upserts.notes.restore.value.title, 'NEW title')
      }
    })

for (const mode of ['countdown', 'countup'])
  for (const partnerEnds of [false, true]) {
    test(`${mode} ended after two minutes by ${partnerEnds ? 'the partner' : 'this user'} settles completion consistently`, async () => {
      const { app, hooks } = await fixture()
      const awards = []
      hooks.timerApp = Object.assign(app.createDefaultState(), app.pomodoroActions, {
        save() {},
        addPoints(...args) {
          awards.push(args)
        }
      })
      if (partnerEnds) hooks.partnerUpdate = async () => ({ session: { status: 'done' } })
      setActivePinia(createPinia())
      const timer = app.useStudyTimerStore()
      timer.enterSession({
        id: 'session',
        mode,
        focusMinutes: 25,
        myState: 'focus',
        myElapsedSeconds: 120,
        partnerName: 'peer'
      })
      if (partnerEnds) await new Promise((r) => setTimeout(r, 20))
      else await timer.endSession()
      const record = hooks.timerApp.pomodoro.records[0]
      assert.equal(record.minutes, 2)
      assert.equal(record.completed, mode === 'countup')
      assert.equal(Object.values(hooks.timerApp.pomodoro.daily)[0].count, mode === 'countup' ? 1 : 0)
      assert.equal(awards.length, mode === 'countup' ? 1 : 0)
      timer.finishSession()
    })
  }
