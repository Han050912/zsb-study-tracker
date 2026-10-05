import test, { beforeEach, afterEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { build } from 'esbuild'
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const root = fileURLToPath(new URL('../../', import.meta.url))
const directory = path.join(root, '.cache', 'onboarding-tests')
await mkdir(directory, { recursive: true })
const files = []
async function compile(options) {
  const result = await build({ bundle: true, format: 'esm', platform: 'node', write: false, ...options })
  const file = path.join(directory, `${crypto.randomUUID()}.mjs`)
  await writeFile(file, result.outputFiles[0].text)
  files.push(file)
  return pathToFileURL(file).href
}
const frontend = await compile({
  stdin: {
    contents: `export * from './src/stores/app/sync'; export * from './src/stores/app/settings';
      export * from './src/stores/app/importExport'; export * from './src/services/syncOutbox';
      export * from './src/data/defaults'; export * from './src/services/onboarding';
      export { sessionUser } from './src/services/auth'; export { syncApi } from './src/api/sync';`,
    resolveDir: root
  },
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
          if (path.endsWith('/auth')) return { contents: 'export const sessionUser = {value:{id:"user-a"}};' }
          if (path.endsWith('/sync'))
            return {
              contents: `export const syncApi = {pullChanges:async()=>({full:true,versions:{},changes:{}}),
                pushChanges:async()=>({applied:{}}),pushChangesBeacon:()=>{}};`
            }
          if (path.endsWith('/client'))
            return {
              contents:
                'export class ApiError extends Error {constructor(message,status){super(message);this.status=status}}'
            }
          if (path.endsWith('/errorImages')) return { contents: 'export const clearErrorImageCache = ()=>{};' }
          return {
            contents: `export const setNoteBodyUser=async()=>{}; export const reconcileNoteBodies=async()=>{};
              export const flushPendingNoteBodies=async()=>({revisions:new Map(),failures:[]});
              export const hasPendingNoteBodies=()=>false; export const getNoteBody=()=>'';
              export const queueNoteBody=()=>{}; export const clearAllNoteBodies=()=>{};`
          }
        })
      }
    }
  ]
})
const backend = await compile({
  stdin: {
    contents: `export { settingsRecordStatements, getSettings } from './worker/src/api/settings';
      import { registerSyncRoutes } from './worker/src/api/sync';
      export { route } from './worker/src/router'; registerSyncRoutes();`,
    resolveDir: root
  },
  plugins: [
    {
      name: 'server-auth-boundaries',
      setup(builder) {
        builder.onResolve({ filter: /middleware\/(?:auth|rateLimit)$/ }, ({ path }) => ({
          path,
          namespace: 'boundary'
        }))
        builder.onLoad({ filter: /.*/, namespace: 'boundary' }, ({ path }) => ({
          contents: path.endsWith('/auth')
            ? `export const resolveAuth=async()=>({userId:'user-a',role:'user'});
              export const tryGetAuth=resolveAuth; export const isDbAdmin=async()=>false;`
            : `export const rateLimit=async()=>{};`
        }))
      }
    }
  ]
})
const { settingsRecordStatements, getSettings, route } = await import(backend)
const schema = await readFile(new URL('../schema.sql', import.meta.url), 'utf8')
const data = new Map()
let failStorage = false
globalThis.localStorage = {
  get length() {
    return data.size
  },
  key: (index) => [...data.keys()][index] ?? null,
  getItem(key) {
    if (failStorage) throw new Error('storage unavailable')
    return data.get(key) ?? null
  },
  setItem(key, value) {
    if (failStorage) throw new Error('storage unavailable')
    data.set(key, value)
  },
  removeItem: (key) => data.delete(key)
}
const tabs = []
async function tab(userId = 'user-a') {
  const app = await import(`${frontend}?tab=${crypto.randomUUID()}`)
  app.sessionUser.value = { id: userId }
  const store = Object.assign(app.createDefaultState(), app.syncActions, app.settingsActions, app.importExportActions, {
    migrateErrorImages() {},
    $patch(patch) {
      Object.assign(this, patch)
    }
  })
  Object.defineProperty(store, '$state', { get: () => store })
  tabs.push(store)
  return { app, store }
}
function remoteSettings(value, updatedAt = Date.now() + 10_000) {
  return {
    full: true,
    versions: {},
    changes: { settings: { seq: 1, upserts: [{ key: 'self', value, updatedAt }], deletes: [] } }
  }
}
function server() {
  const db = new DatabaseSync(':memory:')
  db.exec(schema)
  db.exec("INSERT INTO users (id, username, password_hash, created_at) VALUES ('user-a', '考生', 'unused', 1)")
  function statement(sql, args = []) {
    return {
      sql,
      bind: (...values) => statement(sql, values),
      first: async () => db.prepare(sql).get(...args) ?? null,
      all: async () => ({ results: db.prepare(sql).all(...args) }),
      run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...args).changes) } })
    }
  }
  const env = {
    DB: {
      prepare: statement,
      batch: async (statements) => {
        db.exec('BEGIN')
        try {
          const results = []
          for (const item of statements) results.push(await (/^\s*SELECT\b/i.test(item.sql) ? item.all() : item.run()))
          db.exec('COMMIT')
          return results
        } catch (error) {
          db.exec('ROLLBACK')
          throw error
        }
      }
    },
    JWT_SECRET: 'onboarding-test-secret',
    IMAGES: { delete: async () => {} }
  }
  async function save(value, updatedAt = Date.now()) {
    const statements = await settingsRecordStatements(env, 'user-a', value, { updatedAt, seq: updatedAt })
    for (const item of statements) await item.run()
  }
  async function request(endpoint, payload) {
    const response = await route(
      new Request(`https://onboarding.invalid${endpoint}`, { method: 'POST', body: JSON.stringify(payload) }),
      env
    )
    const result = await response.json()
    assert.equal(response.status, 200, JSON.stringify(result))
    return result
  }
  return { db, env, save, request }
}
beforeEach(() => {
  data.clear()
  failStorage = false
})
afterEach(() => {
  failStorage = false
  for (const store of tabs.splice(0)) store.resetState()
})
after(async () => {
  for (const file of files) await unlink(file)
})

test('skip persists after logout/login even when a newer cloud settings row has false', async () => {
  const { app, store } = await tab()
  app.syncApi.pullChanges = async () => remoteSettings({ onboarded: false, theme: 'light' })
  await store.hydrate()
  assert.equal(store.settings.onboarded, false)
  store.updateSettings({ onboarded: true })
  assert.equal(data.get('zsb_onboarded_v1:user-a'), '1')
  assert.equal(await store.saveAsync(), true)
  app.sessionUser.value = null
  store.resetState()
  assert.equal(store.settings.onboarded, false)
  app.sessionUser.value = { id: 'user-a' }
  app.syncApi.pullChanges = async () => remoteSettings({ onboarded: false, theme: 'dark' })
  await store.hydrate()
  assert.equal(store.settings.onboarded, true)
  assert.equal(store.settings.theme, 'dark')
})

test('a fresh page restores completion with an omitted cloud flag and pending sync failure', async () => {
  const first = await tab()
  await first.store.hydrate()
  first.store.updateSettings({ onboarded: true })
  first.app.syncApi.pushChanges = async () => {
    throw new Error('offline')
  }
  assert.equal(await first.store.saveAsync(), false)
  first.store.resetState()
  const second = await tab()
  second.app.syncApi.pullChanges = async () => remoteSettings({ theme: 'dark' })
  await second.store.hydrate()
  assert.equal(second.store.settings.onboarded, true)
  assert.equal(second.store.settings.theme, 'dark')
})

test('cloud completion is remembered and never leaks to a different account', async () => {
  const first = await tab()
  first.app.syncApi.pullChanges = async () => remoteSettings({ onboarded: true })
  await first.store.hydrate()
  first.store.resetState()
  const second = await tab('user-b')
  second.app.syncApi.pullChanges = async () => remoteSettings({ onboarded: false })
  await second.store.hydrate()
  assert.equal(second.store.settings.onboarded, false)
  second.store.resetState()
  second.app.sessionUser.value = { id: 'user-a' }
  await second.store.hydrate()
  assert.equal(second.store.settings.onboarded, true)
})

test('cold browser remembers cloud completion before newer pending settings restore false', async () => {
  const { app, store } = await tab()
  const remoteStamp = Date.now()
  const pendingStamp = remoteStamp + 1000
  app.setOutboxUser('user-a')
  app.stageUpsert('settings', 'self', { ...store.settings, onboarded: false, theme: 'dark' }, pendingStamp)
  assert.equal(data.has('zsb_onboarded_v1:user-a'), false)
  app.syncApi.pullChanges = async () => remoteSettings({ onboarded: true, theme: 'light' }, remoteStamp)
  let uploaded
  app.syncApi.pushChanges = async (payload) => {
    uploaded = payload.domains.settings.upserts[0]
    return { applied: {} }
  }
  await store.hydrate()
  assert.equal(store.settings.onboarded, true)
  assert.equal(store.settings.theme, 'dark')
  assert.equal(uploaded.value.onboarded, true)
  assert.equal(uploaded.value.theme, 'dark')
  assert.ok(uploaded.updatedAt > pendingStamp)
  assert.equal(data.get('zsb_onboarded_v1:user-a'), '1')
})

test('equal or older cloud settings still contribute completed onboarding without replacing local preferences', async () => {
  for (const offset of [0, -1000]) {
    const { app, store } = await tab(`user-${offset}`)
    await store.hydrate()
    store.updateSettings({ theme: 'dark' })
    await store.saveAsync()
    assert.equal(store.settings.onboarded, false)
    assert.equal(data.has(`zsb_onboarded_v1:user-${offset}`), false)
    const localStamp = store.settings.updatedAt
    app.syncApi.pullChanges = async () => remoteSettings({ onboarded: true, theme: 'light' }, localStamp + offset)
    await store.syncNow()
    assert.equal(store.settings.onboarded, true)
    assert.equal(store.settings.theme, 'dark')
    const repair = app.takeForFlush().upserts.settings.self
    assert.equal(repair.value.onboarded, true)
    assert.equal(repair.value.theme, 'dark')
    assert.ok(repair.updatedAt > localStamp)
    await store.saveAsync()
  }
})

test('manual sync uploads restored completion automatically and later settings edits retain it', async (t) => {
  const { app, store } = await tab()
  await store.hydrate()
  store.updateSettings({ onboarded: true })
  await store.saveAsync()
  let repairUploads = 0
  app.syncApi.pushChanges = async (payload) => {
    assert.equal(payload.domains.settings.upserts[0].value.onboarded, true)
    repairUploads++
    return { applied: {} }
  }
  t.mock.timers.enable({ apis: ['setTimeout'] })
  app.syncApi.pullChanges = async () => remoteSettings({ onboarded: false, userName: '云端昵称' })
  await store.syncNow()
  assert.equal(store.settings.onboarded, true)
  assert.equal(store.settings.userName, '云端昵称')
  t.mock.timers.tick(800)
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(repairUploads, 1)
  assert.equal(app.size(), 0)
  store.updateSettings({ theme: 'dark' })
  assert.equal(app.takeForFlush().upserts.settings.self.value.onboarded, true)
})

test('clearing learning data and importing an older backup retain completed onboarding', async () => {
  const { app, store } = await tab()
  await store.hydrate()
  store.updateSettings({ onboarded: true })
  store.clearAll()
  assert.equal(store.settings.onboarded, true)
  assert.equal(app.takeForFlush().upserts.settings.self.value.onboarded, true)
  const backup = app.createDefaultState()
  backup.settings.theme = 'dark'
  assert.equal(store.importJSON(JSON.stringify(backup)), true)
  assert.equal(store.settings.onboarded, true)
  assert.equal(store.settings.theme, 'dark')
})

test('unavailable local storage retains completion in this page without breaking the guide', async () => {
  const { app } = await tab()
  failStorage = true
  const skipped = app.createDefaultState().settings
  skipped.onboarded = true
  assert.doesNotThrow(() => app.restoreOnboarding('user-a', skipped))
  const restored = app.createDefaultState().settings
  app.restoreOnboarding('user-a', restored)
  assert.equal(restored.onboarded, true)
  const other = app.createDefaultState().settings
  app.restoreOnboarding('user-b', other)
  assert.equal(other.onboarded, false)
})

test('server completion survives newer false/omitted/default settings rows across devices', async () => {
  const { db, env, save } = server()
  let updatedAt = 1
  try {
    await save({ onboarded: false }, updatedAt++)
    assert.equal((await getSettings(env, 'user-a')).onboarded, false)
    // Legacy nullable values must still transition to completed.
    db.prepare('UPDATE user_settings SET onboarded = NULL WHERE user_id = ?').run('user-a')
    await save({ onboarded: true }, updatedAt++)
    assert.equal((await getSettings(env, 'user-a')).onboarded, true)
    const { app } = await tab()
    for (const value of [
      { onboarded: false, theme: 'dark' },
      { userName: '新昵称' },
      app.createDefaultState().settings
    ]) {
      await save(value, updatedAt++)
      assert.equal((await getSettings(env, 'user-a')).onboarded, true)
    }
  } finally {
    db.close()
  }
})

test('LWW rejection restages completion with current cloud settings and a fresh device sees it', async () => {
  const cloud = server()
  const first = await tab()
  first.app.syncApi.pullChanges = (options) => cloud.request('/api/data/pull', options)
  let rejected = 0
  first.app.syncApi.pushChanges = async (payload) => {
    const result = await cloud.request('/api/data/push', payload)
    rejected += result.rejected.length
    return result
  }
  try {
    await first.store.hydrate()
    first.store.updateSettings({ onboarded: true })
    const pendingStamp = first.store.settings.updatedAt
    // Another device edits the settings row after this browser skipped, before its upload.
    const remoteStamp = pendingStamp + 1000
    await cloud.save({ onboarded: false, theme: 'dark', userName: '新的云端设置' }, remoteStamp)
    const result = await first.store.flushOutbox()
    assert.equal(result.rejected, 1)
    assert.equal(rejected, 1)
    assert.equal(first.store.settings.onboarded, true)
    const repair = first.app.takeForFlush().upserts.settings.self
    assert.equal(repair.value.theme, 'dark')
    assert.equal(repair.value.userName, '新的云端设置')
    assert.equal(repair.value.onboarded, true)
    assert.ok(repair.updatedAt > remoteStamp)
    assert.equal(await first.store.saveAsync(), true)
    assert.equal((await getSettings(cloud.env, 'user-a')).onboarded, true)
    // A different browser has no local completion marker or shared outbox.
    data.clear()
    const second = await tab()
    second.app.syncApi.pullChanges = (options) => cloud.request('/api/data/pull', options)
    second.app.syncApi.pushChanges = (payload) => cloud.request('/api/data/push', payload)
    await second.store.hydrate()
    assert.equal(second.store.settings.onboarded, true)
    assert.equal(second.store.settings.theme, 'dark')
  } finally {
    cloud.db.close()
  }
})
