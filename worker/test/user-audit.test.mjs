import test, { beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdir, writeFile, unlink } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { deferred, settle } from './refactor-harness.mjs'

const storage = new Map()
globalThis.localStorage = {
  get length() {
    return storage.size
  },
  key: (index) => [...storage.keys()][index] ?? null,
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key)
}
globalThis.window = Object.assign(new EventTarget(), { location: { hash: '#/math' } })
globalThis.sessionStorage = { getItem: () => null, removeItem() {} }
globalThis.__auditUser = { value: { id: 'a' } }

const result = await build({
  stdin: {
    contents: `export * from './src/utils/date'; export * from './src/utils/studyValidation';
      export * from './src/api/client'; export * from './src/utils/session';
      export * from './src/stores/app/sync'; export * from './src/services/syncOutbox';
      export * from './src/data/defaults';
      export { isValidBackup, parseBackup, importExportActions } from './src/stores/app/importExport';
      export { settingsActions } from './src/stores/app/settings';
      export { settingsBodySchema } from './worker/src/api/settings';
      export * from './src/stores/app/english';
      export { readingMapping, listeningMapping } from './worker/src/api/english';
      export { vocabMapping } from './worker/src/api/vocab';
      export { examsMapping } from './worker/src/api/exams';
      export { recordsMapping } from './worker/src/api/records';
      export { problemsMapping } from './worker/src/api/problems';`,
    resolveDir: process.cwd()
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  external: ['vue'],
  define: { __DESKTOP_BUILD__: 'false', 'import.meta.env.VITE_API_BASE': '"http://audit.local"' },
  plugins: [
    {
      name: 'audit-boundaries',
      setup(builder) {
        builder.onResolve({ filter: /(?:services\/(auth|noteBodies)|api\/(sync|errorImages))$/ }, (args) => ({
          path: args.path,
          namespace: 'audit'
        }))
        builder.onLoad({ filter: /.*/, namespace: 'audit' }, ({ path }) => {
          if (path.endsWith('/auth')) return { contents: 'export const sessionUser = globalThis.__auditUser;' }
          if (path.endsWith('/sync'))
            return {
              contents:
                'export const syncApi = new Proxy({}, { get: (_, key) => (...args) => globalThis.__auditApi[key](...args) });'
            }
          if (path.endsWith('/errorImages')) return { contents: 'export const clearErrorImageCache = () => {};' }
          return {
            contents: `export const setNoteBodyUser = async () => {};
        export const getNoteBody = () => ''; export const queueNoteBody = () => {}; export const clearAllNoteBodies = () => {};
        export const reconcileNoteBodies = async () => {};
        export const hasPendingNoteBodies = () => false;
        export const isNoteRestorePending=()=>false; export const finishNoteRestore=()=>{};
        export const flushPendingNoteBodies = () => globalThis.__auditApi.bodies();`
          }
        })
      }
    }
  ]
})
await mkdir('.cache/audit-tests', { recursive: true })
const filename = `.cache/audit-tests/${crypto.randomUUID()}.mjs`
await writeFile(filename, result.outputFiles[0].text)
const app = await import(pathToFileURL(`${process.cwd()}/${filename}`).href)
await unlink(filename)

function makeStore() {
  const store = {
    ...app.createDefaultState(),
    ...app.syncActions,
    migrateErrorImages() {},
    $patch(data) {
      Object.assign(this, data)
    }
  }
  Object.defineProperty(store, '$state', { get: () => store })
  return store
}
beforeEach(() => {
  makeStore().resetState()
  storage.clear()
  globalThis.__auditUser.value = { id: 'a' }
  globalThis.__auditApi = {
    pullChanges: async () => ({ changes: {}, gamification: { pointsLog: [] } }),
    pushChanges: async () => ({ applied: {} }),
    bodies: async () => ({ revisions: new Map(), failures: [] })
  }
})

test('统计分钟：舍入后进位，非有限值不污染展示', () => {
  assert.equal(app.formatMinutes(119.6), '2小时')
  assert.equal(app.formatMinutes(59.9), '1小时')
  assert.equal(app.formatMinutes(NaN), '0分钟')
})

test('导入：合法备份可用，损坏的数值/正文/积分数组在覆盖之前被拒绝', () => {
  const valid = app.createDefaultState()
  assert.equal(app.isValidBackup(valid), true)
  for (const change of [
    { records: [{ minutes: -10 }] },
    { exams: [{ title: '试卷', score: 180, totalScore: 150, minutes: 120 }] },
    { problemSessions: [{ total: 1, correct: 2 }] },
    { notes: [{ content: { invalid: true } }] },
    { noteBodies: { n: { content: 12, updatedAt: 100 } } },
    { gamification: { ...valid.gamification, pointsLog: [null] } }
  ])
    assert.equal(app.isValidBackup({ ...valid, ...change }), false)
})

test('设置：非法目标或超长引言在本地写入和暂存前被拒绝，合法目标同步习惯', () => {
  app.setOutboxUser('a')
  const store = { ...app.createDefaultState(), save() {} }
  for (const key of ['dailyGoalMinutes', 'wordGoal', 'problemGoal']) {
    const previous = store.settings[key]
    for (const value of [NaN, Infinity, -1, 0, 1.5, '']) {
      assert.throws(() => app.settingsActions.updateSettings.call(store, { [key]: value }))
      assert.equal(store.settings[key], previous)
      assert.equal(app.takeForFlush(), null)
      if (value !== 0 && value !== 1.5) assert.equal(app.settingsBodySchema.safeParse({ [key]: value }).success, false)
    }
  }
  assert.equal(app.settingsBodySchema.safeParse({ dailyGoalMinutes: 0, wordGoal: 1.5 }).success, true)
  assert.throws(() => app.settingsActions.updateSettings.call(store, { dailyGoalMinutes: 1441 }))
  assert.throws(() => app.settingsActions.updateQuotes.call(store, ['引'.repeat(201)]))
  assert.equal(app.takeForFlush(), null)
  app.settingsActions.updateSettings.call(store, { dailyGoalMinutes: 1440, wordGoal: 60, problemGoal: 40 })
  assert.equal(store.settings.dailyGoalMinutes, 1440)
  assert.equal(store.habits.find((h) => h.id === 'h2').target, 60)
  assert.equal(store.habits.find((h) => h.id === 'h3').target, 40)
  assert.ok(app.takeForFlush().upserts.settings.self)
})

test('备份：嵌套结构、重复id、日期与设置异常在任何旧数据删除前被拒绝', () => {
  const valid = app.createDefaultState()
  const cases = [
    { subjects: [{ ...valid.subjects[0], chapters: {} }] },
    { subjects: [{ ...valid.subjects[0], chapters: [{ id: 'c', name: '章', topics: [null] }] }] },
    { subjects: [{ ...valid.subjects[0], mastery: { topic: 6 } }] },
    { habits: [{ ...valid.habits[0], records: [] }] },
    { habits: [{ ...valid.habits[0], records: { '2026-02-30': 1 } }] },
    { habits: [valid.habits[0], valid.habits[0]] },
    { todos: [{ id: 't', date: 'not-a-date', text: '任务', done: false, order: 0 }] },
    { records: [{ subjectId: 'math', date: '2026-10-02', minutes: 20 }] },
    { settings: { ...valid.settings, dailyGoalMinutes: -10 } },
    { settings: { ...valid.settings, dndMutedTypes: {} } },
    { settings: { ...valid.settings, quotes: [null] } },
    { summaries: { '2026-10-02': { date: '2026-10-01', mood: '', harvest: '', improve: '', plan: '' } } },
    { pomodoro: { ...valid.pomodoro, daily: { '2026-10-02': null } } },
    { notes: [{ id: 'n', title: '笔记', subjectId: 'math', updatedAt: 1, tags: [null] }] }
  ]
  for (const change of cases) {
    const backup = { ...valid, ...change }
    assert.equal(app.isValidBackup(backup), false, JSON.stringify(change))
    const store = {
      ...app.createDefaultState(),
      $patch() {
        throw new Error('must not mutate')
      }
    }
    assert.equal(app.importExportActions.importJSON.call(store, JSON.stringify(backup)), false)
    assert.equal(app.takeForFlush(), null)
  }
})

test('备份：保留旧版科目id迁移、英文记录id迁移及缺失偏好的默认值', () => {
  const backup = app.createDefaultState()
  delete backup.subjects[0].id
  delete backup.subjects[0].topicImportance
  delete backup.settings.dndMutedTypes
  backup.settings.dailyGoalMinutes = 0
  backup.settings.wordGoal = 1.5
  backup.english.reading.push({ date: '2026-10-02', wpm: 80, accuracy: 0 })
  backup.habits.push({ id: 'minutes', name: '专注', type: 'minutes', target: 10, records: { '2026-10-02': 1.5 } })
  assert.equal(app.isValidBackup(backup), true)
  assert.deepEqual(app.parseBackup(JSON.stringify(backup)).settings.dndMutedTypes, [])
})

test('备份：错题排期校验真实日期和毫秒时间戳，非法排期不会覆盖原数据', () => {
  const question = {
    id: 'scheduled',
    subjectId: 'math',
    date: '2026-10-05',
    type: '选择',
    content: '排期题',
    reviewCount: 1,
    mastered: false,
    createdAt: 1
  }
  const backup = { ...app.createDefaultState(), errorQuestions: [question] }
  assert.equal(app.isValidBackup(backup), true)
  assert.equal(
    app.isValidBackup({
      ...backup,
      errorQuestions: [{ ...question, lastReviewedAt: 1791217800000, nextReviewDate: '2028-02-29' }]
    }),
    true
  )
  for (const schedule of [
    { lastReviewedAt: 'bad' },
    { lastReviewedAt: -1 },
    { lastReviewedAt: 1.5 },
    { nextReviewDate: '2026-02-29' },
    { nextReviewDate: '2026-02-30' },
    { nextReviewDate: '2026-99-99' }
  ]) {
    const invalid = { ...backup, errorQuestions: [{ ...question, ...schedule }] }
    assert.equal(app.isValidBackup(invalid), false)
    const store = {
      ...app.createDefaultState(),
      $patch() {
        throw new Error('must not mutate')
      }
    }
    assert.equal(app.importExportActions.importJSON.call(store, JSON.stringify(invalid)), false)
    assert.equal(app.takeForFlush(), null)
  }
})

test('真题/时长：空白、空数值、负值、无穷、超过总分被前后端同时拒绝', () => {
  const valid = { title: '模拟卷', score: 0, totalScore: 150, minutes: 120, subjectId: 'math', date: '2026-09-19' }
  for (const change of [
    { title: ' ' },
    { score: '' },
    { score: -1 },
    { score: 151 },
    { totalScore: 0 },
    { minutes: -10 },
    { minutes: Infinity }
  ]) {
    const invalid = { ...valid, ...change }
    assert.ok(app.examError(invalid))
    assert.equal(app.examsMapping.mapping.schema.safeParse(invalid).success, false)
  }
  assert.equal(app.examError(valid), null)
  assert.equal(app.examsMapping.mapping.schema.safeParse(valid).success, true)
  for (const minutes of ['', 0, -1, Infinity, 1441]) assert.ok(app.studyMinutesError(minutes))
  assert.equal(app.recordsMapping.mapping.schema.safeParse({ ...valid, minutes: -1 }).success, false)
  assert.equal(app.problemsMapping.mapping.schema.safeParse({ ...valid, total: 5, correct: 6 }).success, false)
})

test('新账号默认科目/习惯首次入队，刷新后有持久化数据可读', async () => {
  const store = makeStore()
  let payload
  globalThis.__auditApi.pushChanges = async (data) => {
    payload = data
    return { applied: {} }
  }
  await store.hydrate()
  assert.equal(payload.domains.subjects.upserts.length, 2)
  assert.ok(payload.domains.habits.upserts.length > 0)
  assert.equal(app.size(), 0)
})

test('退出后迟到的 hydrate 不回写状态、不清除新账号队列', async () => {
  const store = makeStore(),
    response = deferred()
  globalThis.__auditApi.pullChanges = () => response.promise
  const pending = store.hydrate()
  await settle()
  store.resetState()
  globalThis.__auditUser.value = { id: 'b' }
  app.setOutboxUser('b')
  app.stageUpsert('todos', 'new', { id: 'new', text: '新账号' }, 100)
  response.resolve({ changes: {}, gamification: { points: 999 } })
  await assert.rejects(pending, /登录状态已改变/)
  assert.equal(store.gamification.points, 0)
  assert.equal(app.size(), 1)
})

test('退出后迟到的 push 不确认新账号 outbox，不覆盖新账号积分', async () => {
  const store = makeStore()
  await store.hydrate()
  app.stageUpsert('todos', 'shared', { id: 'shared', text: '任务' }, 100)
  const response = deferred()
  globalThis.__auditApi.pushChanges = () => response.promise
  const pending = store.flushOutbox()
  await settle()
  store.resetState()
  globalThis.__auditUser.value = { id: 'b' }
  app.setOutboxUser('b')
  app.stageUpsert('todos', 'shared', { id: 'shared', text: '任务' }, 100)
  response.resolve({ applied: {}, gamification: { points: 999 } })
  assert.equal((await pending).ok, false)
  assert.equal(app.size(), 1)
  assert.equal(store.gamification.points, 0)
})

test('正文保存失败即使没有元数据队列也不能返回同步成功', async () => {
  const store = makeStore()
  await store.hydrate()
  globalThis.__auditApi.bodies = async () => ({
    revisions: new Map(),
    failures: [{ noteId: 'n', reason: '正文同步失败' }]
  })
  assert.equal(await store.saveAsync(), false)
  assert.match(app.syncIssue.value, /正文同步失败/)
})

test('GET：普通请求去重；带取消信号/请求头/超时的调用互不影响', async () => {
  const response = deferred()
  let calls = 0
  globalThis.fetch = async () => {
    calls++
    await response.promise
    return Response.json({ ok: true })
  }
  const a = app.request('/ordinary'),
    b = app.request('/ordinary')
  assert.equal(a, b)
  const c = app.request('/custom', { signal: new AbortController().signal })
  const d = app.request('/custom', { signal: new AbortController().signal })
  const e = app.request('/custom', { headers: { 'X-Filter': 'one' } })
  const f = app.request('/custom', {}, 2000)
  await settle()
  assert.equal(calls, 5)
  response.resolve()
  await Promise.all([a, b, c, d, e, f])
})

test('旧账号的迟到 401 不会登出新账号', async () => {
  const response = deferred()
  globalThis.fetch = () => response.promise
  app.markSessionActive()
  const pending = app.request('/private')
  await settle()
  app.clearSession()
  app.markSessionActive()
  response.resolve(new Response('{}', { status: 401 }))
  await assert.rejects(pending, /登录状态已改变/)
  assert.equal(app.hasActiveSession(), true)
})

test('keepalive 上限按中文 UTF-8 字节数判断', () => {
  let calls = 0
  globalThis.fetch = async () => {
    calls++
    return Response.json({})
  }
  app.requestKeepalive('/sync', { text: '学'.repeat(21000) })
  assert.equal(calls, 0)
  app.requestKeepalive('/sync', { text: '学习' })
  assert.equal(calls, 1)
})

test('并发队列中旧账号的写请求在切号后不能发出', async () => {
  const response = deferred()
  const sent = []
  globalThis.fetch = async (url) => {
    sent.push(url)
    await response.promise
    return Response.json({ ok: true })
  }
  const requests = Array.from({ length: 6 }, (_, i) => app.request(`/busy/${i}`))
  const queued = app.request('/old-mutation', { method: 'POST', body: '{}' })
  const settled = Promise.allSettled([...requests, queued])
  await settle()
  assert.equal(sent.length, 6)
  app.clearSession()
  app.markSessionActive()
  response.resolve()
  const results = await settled
  assert.equal(sent.length, 6)
  assert.ok(results.every((r) => r.status === 'rejected' && /登录状态已改变/.test(r.reason.message)))
})

test('JSON 响应体解析期间切号也不返回旧账号数据', async () => {
  const body = deferred()
  globalThis.fetch = async () => ({ ok: true, status: 200, json: () => body.promise })
  const pending = app.request('/slow-body')
  await settle()
  app.clearSession()
  app.markSessionActive()
  body.resolve({ privateData: 'old-user' })
  await assert.rejects(pending, /登录状态已改变/)
})

test('英语专项：空正确率、越界数值在 store 和服务端被拒绝，合法零正确率可保存', () => {
  const store = { ...makeStore(), ...app.englishActions, addPoints() {} }
  for (const accuracy of ['', -1, 101, Infinity]) {
    assert.ok(app.readingError(80, accuracy))
    assert.throws(() => store.addReadingRecord(80, accuracy))
    assert.equal(app.readingMapping.mapping.schema.safeParse({ date: '2026-09-19', wpm: 80, accuracy }).success, false)
  }
  assert.equal(app.readingError(80, 0), null)
  store.addReadingRecord(80, 0)
  assert.equal(store.english.reading.length, 1)
  for (const minutes of ['', -1, 0, Infinity, 1441]) {
    assert.throws(() => store.addListeningRecord(minutes, '材料', '精听'))
    assert.equal(
      app.listeningMapping.mapping.schema.safeParse({ date: '2026-09-19', minutes, material: '材料', mode: '精听' })
        .success,
      false
    )
  }
  for (const newWords of [-1, 1.5, Infinity]) {
    assert.throws(() => store.addVocabRecord(newWords, 20))
    assert.equal(
      app.vocabMapping.mapping.schema.safeParse({ date: '2026-09-19', newWords, reviewWords: 20 }).success,
      false
    )
  }
  const backup = app.createDefaultState()
  assert.equal(
    app.isValidBackup({ ...backup, english: { ...backup.english, reading: [{ wpm: 80, accuracy: 101 }] } }),
    false
  )
})
