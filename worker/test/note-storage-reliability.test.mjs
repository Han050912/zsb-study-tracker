import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdir, writeFile, unlink } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { noteStorageFixture } from './note-storage-fixture.mjs'

const bundle = await build({
  entryPoints: ['src/services/noteBodies.ts'],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  external: ['vue'],
  plugins: [
    {
      name: 'body-api',
      setup(b) {
        b.onResolve({ filter: /api\/noteBodies$/ }, () => ({ path: 'api', namespace: 'mock' }))
        b.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({
          contents: `
      export const fetchNoteBodyLimit = async () => 1000000;
      export const putNoteBody = (...a) => globalThis.__bodyApi.put(...a);
      export const pullNoteBodies = (...a) => globalThis.__bodyApi.pull(...a);`
        }))
      }
    }
  ]
})
await mkdir('.cache/note-storage-tests', { recursive: true })
const file = resolve('.cache/note-storage-tests', `${crypto.randomUUID()}.mjs`)
await writeFile(file, bundle.outputFiles[0].text)
after(() => unlink(file))
const settle = () => new Promise((resolve) => setImmediate(resolve))
function deferred() {
  let resolve
  return {
    promise: new Promise((r) => {
      resolve = r
    }),
    resolve: (value) => resolve(value)
  }
}
async function fixture() {
  const storage = noteStorageFixture()
  globalThis.indexedDB = storage.indexedDB
  const api = (globalThis.__bodyApi = {
    put: async (_, __, updatedAt) => ({ applied: true, updatedAt }),
    pull: async () => []
  })
  const app = await import(`${pathToFileURL(file).href}?test=${crypto.randomUUID()}`)
  await app.setNoteBodyUser('A')
  return { app, storage, api }
}

test('open failure retains memory content, reports it, and retry opens a fresh database and survives reloading the account', async () => {
  const { app, storage } = await fixture()
  await app.retryNoteBodyStorage()
  storage.failWrite = true
  app.queueNoteBody('n', '离线正文不能丢', 10)
  assert.equal(app.noteBodySaveState('n'), 'saving')
  assert.equal(app.hasVolatileNoteBodies(), true)
  await settle()
  assert.equal(app.noteBodySaveState('n'), 'memory')
  assert.match(app.noteBodyStorageIssue.value, /仅保留在当前页面/)
  storage.failWrite = false
  storage.failOpen = true
  assert.equal(await app.retryNoteBodyStorage(), false)
  assert.equal(app.getNoteBody('n'), '离线正文不能丢')
  const failedOpens = storage.opens
  storage.failOpen = false
  assert.equal(await app.retryNoteBodyStorage(), true)
  assert.ok(storage.opens > failedOpens)
  assert.equal(app.noteBodySaveState('n'), 'local')
  assert.equal(app.hasVolatileNoteBodies(), false)
  assert.equal(app.noteBodyStorageIssue.value, null)
  await app.setNoteBodyUser(null)
  await app.setNoteBodyUser('A')
  assert.equal(app.getNoteBody('n'), '离线正文不能丢')
})

test('an older successful transaction cannot mark a newer unfinished revision as durable', async () => {
  const { app, storage } = await fixture()
  storage.holdWrites = true
  app.queueNoteBody('n', 'first', 10)
  app.queueNoteBody('n', 'second', 11)
  await settle()
  storage.pending.shift()()
  await settle()
  assert.equal(app.hasVolatileNoteBodies(), true)
  assert.equal(app.noteBodySaveState('n'), 'saving')
  storage.failWrite = true
  storage.pending.shift()()
  await settle()
  assert.equal(app.getNoteBody('n'), 'second')
  assert.equal(app.noteBodySaveState('n'), 'memory')
})

test('forced account changes isolate and retain failed local writes for their owner', async () => {
  const { app, storage } = await fixture()
  storage.failWrite = true
  app.queueNoteBody('same-id', 'A private', 10)
  await settle()
  await app.setNoteBodyUser('B')
  assert.equal(app.getNoteBody('same-id'), '')
  assert.equal(app.hasVolatileNoteBodies(), false)
  assert.equal(app.hasVolatileNoteBodies(true), true)
  assert.equal(app.noteBodyStorageIssue.value, null)
  await app.setNoteBodyUser('A')
  assert.equal(app.getNoteBody('same-id'), 'A private')
  assert.equal(app.hasVolatileNoteBodies(), true)
})

test('ordinary conflict keeps an exact durable local copy while accepting the remote body, also after restart', async () => {
  const { app, api } = await fixture()
  app.queueNoteBody('n', '本机版本\n公式 $x^2$', 10)
  api.put = async () => ({ applied: false, updatedAt: 20 })
  api.pull = async () => [{ id: 'n', content: 'other device', updatedAt: 20 }]
  assert.deepEqual((await app.flushPendingNoteBodies()).failures, [])
  assert.equal(app.getNoteBody('n'), 'other device')
  assert.equal(app.noteConflicts.value.length, 1)
  assert.equal(app.noteConflicts.value[0].content, '本机版本\n公式 $x^2$')
  assert.equal(app.noteConflicts.value[0].persisted, true)
  await app.setNoteBodyUser('B')
  assert.deepEqual(app.noteConflicts.value, [])
  await app.setNoteBodyUser('A')
  assert.equal(app.noteConflicts.value[0].content, '本机版本\n公式 $x^2$')
  assert.equal(app.noteBodySaveState('n'), 'synced')
})

test('a conflict copy that cannot be persisted keeps the leave protection active even after remote adoption', async () => {
  const { app, storage, api } = await fixture()
  app.queueNoteBody('n', 'only local', 10)
  await settle()
  api.put = async () => ({ applied: false, updatedAt: 20 })
  api.pull = async () => {
    storage.failWrite = true
    return [{ id: 'n', content: 'cloud', updatedAt: 20 }]
  }
  await app.flushPendingNoteBodies()
  assert.equal(app.noteBodySaveState('n'), 'synced')
  assert.equal(app.noteConflicts.value[0].persisted, false)
  assert.equal(app.hasVolatileNoteBodies(), true)
  storage.failWrite = false
  await app.retryNoteBodyStorage()
  assert.equal(app.hasVolatileNoteBodies(), false)
})

test('pull and remote deletion retain displaced dirty bodies as conflict copies', async () => {
  const { app, api } = await fixture()
  app.queueNoteBody('newer', 'older local draft', 10)
  app.queueNoteBody('deleted', 'deleted remotely but valuable', 10)
  api.pull = async () => [{ id: 'newer', content: 'new remote', updatedAt: 20 }]
  await app.reconcileNoteBodies([{ id: 'newer', bodyUpdatedAt: 20 }])
  assert.equal(app.getNoteBody('newer'), 'new remote')
  assert.equal(app.noteConflicts.value.length, 2)
  assert.ok(app.noteConflicts.value.some((copy) => copy.content === 'deleted remotely but valuable'))
})

test('an edit made while a conflict response is loading remains current and is not replaced', async () => {
  const { app, api } = await fixture()
  app.queueNoteBody('n', 'first', 10)
  const pull = deferred()
  api.put = async () => ({ applied: false, updatedAt: 20 })
  api.pull = () => pull.promise
  const flushing = app.flushPendingNoteBodies()
  await settle()
  app.queueNoteBody('n', 'latest user edit', 30)
  pull.resolve([{ id: 'n', content: 'remote', updatedAt: 20 }])
  await flushing
  assert.equal(app.getNoteBody('n'), 'latest user edit')
  assert.equal(app.noteConflicts.value.length, 0)
})

test('strict backup export distinguishes real empty content, missing bodies, stale bodies and account changes', async () => {
  const { app, api } = await fixture()
  const note = { id: 'n', title: '笔记', bodyUpdatedAt: 20 }
  await assert.rejects(() => app.exportNoteBody(note), /尚未完整读取/)
  api.pull = async () => [{ id: 'n', content: '', updatedAt: 20 }]
  assert.deepEqual(await app.exportNoteBody(note), { content: '', updatedAt: 20 })
  api.pull = async () => [{ id: 'n', content: 'stale', updatedAt: 21 }]
  await assert.rejects(() => app.exportNoteBody({ ...note, bodyUpdatedAt: 30 }), /尚未完整读取/)
  const pull = deferred()
  api.pull = () => pull.promise
  const exportFlight = app.exportNoteBody({ ...note, bodyUpdatedAt: 30 })
  await app.setNoteBodyUser('B')
  pull.resolve([{ id: 'n', content: 'private A', updatedAt: 30 }])
  await assert.rejects(() => exportFlight, /账号已改变/)
  assert.equal(app.getNoteBody('n'), '')
})
