import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { build } from 'esbuild'
import { readFile, mkdir, writeFile, unlink } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const root = fileURLToPath(new URL('../../', import.meta.url))
const compiled = await build({
  stdin: {
    contents: `export { createDefaultState } from './src/data/defaults';
      export { importExportActions } from './src/stores/app/importExport';
      export { habitsActions } from './src/stores/app/habits';
      export { today, businessDate } from './src/utils/date';
      export { serializeChanges } from './src/services/syncDomains';
      export { setOutboxUser, takeForFlush, ack } from './src/services/syncOutbox';
      import { registerSyncRoutes } from './worker/src/api/sync';
      export { route } from './worker/src/router'; registerSyncRoutes();`,
    resolveDir: root
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  external: ['vue'],
  write: false,
  plugins: [
    {
      name: 'browser-and-auth-boundaries',
      setup(builder) {
        builder.onResolve({ filter: /(?:services\/(?:auth|noteBodies)|middleware\/(?:auth|rateLimit))$/ }, (args) => ({
          path: args.path,
          namespace: 'boundary'
        }))
        builder.onLoad({ filter: /.*/, namespace: 'boundary' }, ({ path: name }) => ({
          contents: name.endsWith('services/auth')
            ? `export const sessionUser = { value: { id: 'u' } };`
            : name.endsWith('/auth')
              ? `export async function resolveAuth() { return { userId: 'u', role: 'user' } }; export const tryGetAuth = resolveAuth; export const isDbAdmin = async () => false;`
              : name.endsWith('/rateLimit')
                ? `export async function rateLimit() {}`
                : `export const getNoteBody = () => ''; export const queueNoteBody = () => {}; export const clearAllNoteBodies = () => {};`
        }))
      }
    }
  ]
})
await mkdir(path.join(root, '.cache/legacy-habit-tests'), { recursive: true })
const filename = path.join(root, `.cache/legacy-habit-tests/${crypto.randomUUID()}.mjs`)
await writeFile(filename, compiled.outputFiles[0].text)
const app = await import(pathToFileURL(filename).href)
await unlink(filename)
const schema = await readFile(new URL('../schema.sql', import.meta.url), 'utf8')
const storage = new Map()
globalThis.localStorage = {
  get length() {
    return storage.size
  },
  key: (i) => [...storage.keys()][i] ?? null,
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key)
}

function fixture(t) {
  storage.clear()
  app.setOutboxUser('u')
  const db = new DatabaseSync(':memory:')
  t.after(() => db.close())
  db.exec(schema)
  db.prepare('INSERT INTO users(id,username,password_hash,created_at) VALUES (?,?,?,1)').run('u', 'u', 'unused')
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
        db.exec('BEGIN')
        try {
          const results = statements.map((s) =>
            /^\s*SELECT\b/i.test(s.sql)
              ? { results: db.prepare(s.sql).all(...s.args), meta: { changes: 0 } }
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
  const request = (url, body) =>
    app.route(
      new Request('https://local.invalid' + url, {
        method: 'POST',
        body: JSON.stringify(body)
      }),
      env
    )
  const store = {
    ...app.createDefaultState(),
    ...app.importExportActions,
    ...app.habitsActions,
    $patch(value) {
      Object.assign(this, value)
    },
    save() {},
    addPoints() {},
    revokePointsByRef() {}
  }
  Object.defineProperty(store, '$state', { get: () => store })
  const flush = async () => {
    const pending = app.takeForFlush()
    assert.ok(pending)
    const domains = Object.fromEntries(
      [...new Set([...Object.keys(pending.upserts), ...Object.keys(pending.deletes)])].map((domain) => [
        domain,
        app.serializeChanges(domain, pending.upserts[domain] ?? {}, pending.deletes[domain] ?? {})
      ])
    )
    const response = await request('/api/data/push', {
      domains,
      points: pending.points,
      achievements: pending.achievements
    })
    assert.equal(response.status, 200)
    app.ack(pending)
    return response.json()
  }
  return { db, store, request, flush }
}

test('旧小数/零目标备份导入后，合法新打卡与其它域经真实同步路由落 SQLite', async (t) => {
  const { db, store, request, flush } = fixture(t)
  const date = app.today(),
    past = app.businessDate(Date.now() - 86400_000)
  const backup = app.createDefaultState()
  backup.settings.wordGoal = 1.5
  backup.settings.problemGoal = 0
  backup.habits.push(
    { id: 'stretch', name: '拉伸', type: 'minutes', target: 1.5, records: {} },
    { id: 'sleep', name: '睡觉', type: 'time', target: 1.5, records: {} },
    { id: 'check', name: '复盘', type: 'checkbox', target: 1.5, records: {} }
  )
  backup.habits.find((h) => h.id === 'h2').target = 1.5
  backup.habits.find((h) => h.id === 'h2').records[past] = 1.5
  backup.habits.find((h) => h.id === 'h3').target = 0
  backup.todos.push({ id: 'task', date, text: '其它域仍可同步', done: false, order: 0 })
  assert.equal(store.importJSON(JSON.stringify(backup)), true)
  for (const [id, value] of [
    ['stretch', 2],
    ['sleep', '23:30'],
    ['check', 1],
    ['h2', 2],
    ['h3', 2]
  ])
    store.recordHabit(id, date, value)
  const result = await flush()
  assert.equal(result.rejected.length, 0)
  assert.equal(db.prepare('SELECT target FROM habits WHERE id=?').get('stretch').target, 1.5)
  assert.equal(db.prepare('SELECT target FROM habits WHERE id=?').get('sleep').target, 1.5)
  assert.equal(db.prepare('SELECT target FROM habits WHERE id=?').get('h2').target, 1.5)
  assert.equal(db.prepare('SELECT target FROM habits WHERE id=?').get('h3').target, 0)
  assert.equal(db.prepare('SELECT value FROM habit_records WHERE habit_id=? AND date=?').get('h2', past).value, '1.5')
  assert.equal(db.prepare('SELECT value FROM habit_records WHERE habit_id=? AND date=?').get('h2', date).value, '2')
  assert.equal(
    db.prepare('SELECT value FROM habit_records WHERE habit_id=? AND date=?').get('sleep', date).value,
    '23:30'
  )
  assert.equal(db.prepare('SELECT text FROM todos WHERE id=?').get('task').text, '其它域仍可同步')
  const pulled = await (await request('/api/data/pull', { full: true })).json()
  const restored = pulled.changes.habits.upserts.find((h) => h.key === 'h2').value
  assert.equal(restored.target, 1.5)
  assert.equal(restored.records[past], 1.5)
  assert.equal(restored.records[date], 2)
  assert.equal(app.takeForFlush(), null)
})

test('过去小数次数仅可保留历史，新录入与今日/未来小数仍在写入前拒绝', async (t) => {
  const { db, store, request } = fixture(t)
  const date = app.today(),
    past = app.businessDate(Date.now() - 86400_000),
    future = app.businessDate(Date.now() + 86400_000)
  const habit = { id: 'old', name: '做题', type: 'count', target: 1.5, records: { [past]: 1.5 } }
  store.habits = [structuredClone(habit)]
  for (const day of [past, date, future]) {
    assert.throws(() => store.recordHabit('old', day, 1.5), /次数需为非负整数/)
    if (day !== past) assert.equal(store.habits[0].records[day], undefined)
  }
  for (const target of [0, 1.5, -1]) assert.throws(() => store.updateHabitTarget('old', target), /大于 0 的整数/)
  assert.equal(store.habits[0].target, 1.5)
  assert.equal(app.takeForFlush(), null)
  for (const day of [date, future, '2000-02-30']) {
    const invalid = { ...habit, records: { [day]: 1.5 } }
    const backup = app.createDefaultState()
    backup.habits.push(invalid)
    assert.equal(store.importJSON(JSON.stringify(backup)), false)
    assert.equal(app.takeForFlush(), null)
    await assert.rejects(
      request('/api/data/push', {
        domains: {
          habits: { upserts: [{ key: invalid.id, value: invalid, updatedAt: Date.now() }], deletes: [] },
          todos: {
            upserts: [{ id: 'blocked', date, text: '不能部分落库', done: false, order: 0, updatedAt: Date.now() }],
            deletes: []
          }
        }
      }),
      (error) => error.status === 400
    )
    assert.equal(db.prepare('SELECT count(*) AS n FROM todos').get().n, 0)
    assert.equal(db.prepare('SELECT count(*) AS n FROM habits').get().n, 0)
  }
})

test('兼容目标不扩大非法字段接受范围，负分钟/页数和超总页数备份仍不覆盖', (t) => {
  const { store } = fixture(t)
  const invalidBackups = [
    (b) => b.habits.push({ id: 'negative-target', name: '专注', type: 'minutes', target: -1, records: {} }),
    (b) =>
      b.habits.push({
        id: 'negative-record',
        name: '专注',
        type: 'minutes',
        target: 1.5,
        records: { [app.today()]: -1 }
      }),
    (b) =>
      b.habits.push({
        id: 'negative-history',
        name: '做题',
        type: 'count',
        target: 1.5,
        records: { [app.businessDate(Date.now() - 86400_000)]: -1.5 }
      }),
    (b) => b.habits.push({ id: 'invalid-target', name: '睡觉', type: 'time', target: '1.5', records: {} }),
    (b) => b.materials.push({ id: 'negative', title: '教材', type: 'book', totalPages: -1 }),
    (b) => b.materials.push({ id: 'over', title: '教材', type: 'book', totalPages: 100, readPages: 101 })
  ]
  for (const corrupt of invalidBackups) {
    const backup = app.createDefaultState()
    corrupt(backup)
    assert.equal(store.importJSON(JSON.stringify(backup)), false)
    assert.equal(store.materials.length, 0)
    assert.equal(app.takeForFlush(), null)
  }
})
