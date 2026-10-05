import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { readFile, mkdir, writeFile, unlink } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { reactive, ref, nextTick } from 'vue'

const root = process.cwd()
globalThis.defineProps = () => globalThis.__studyProps
globalThis.defineEmits = () => () => {}
globalThis.window = new EventTarget()
globalThis.document = new EventTarget()
globalThis.requestAnimationFrame = (callback) => setTimeout(() => callback(performance.now()), 0)
globalThis.cancelAnimationFrame = (frame) => clearTimeout(frame)
const storage = new Map()
globalThis.localStorage = {
  get length() {
    return storage.size
  },
  key: (i) => [...storage.keys()][i],
  getItem: (k) => storage.get(k) ?? null,
  setItem: (k, v) => storage.set(k, v),
  removeItem: (k) => storage.delete(k)
}
const settle = () => new Promise((resolve) => setImmediate(resolve))
function deferred() {
  let resolve
  return {
    promise: new Promise((r) => {
      resolve = r
    }),
    resolve: (v) => resolve(v)
  }
}

async function load(file, names, t) {
  globalThis.__studyUser = ref({ id: 'u' })
  globalThis.__studyProps = reactive({ subjectId: 'math', words: [] })
  globalThis.__studyRoute = reactive({ query: {} })
  globalThis.__studyRouter = { replace: async () => {}, push: async () => {} }
  globalThis.__studyHooks = []
  globalThis.__studyToasts = []
  globalThis.__studyCharts = []
  globalThis.__studyConfirm = async () => true
  globalThis.__studyStore = reactive({
    subjects: [{ id: 'math', name: '数学', color: '#123456', chapters: [] }],
    notes: [],
    todos: [],
    errorQuestions: [],
    habits: [],
    materials: [],
    records: [],
    problemSessions: [],
    summaries: {},
    pomodoro: { daily: {}, interruptions: [], records: [] },
    english: { vocab: [], reading: [], listening: [], templates: [] },
    settings: { maimemoConnected: true, quotes: [] },
    gamification: { points: 0, pointsLog: [], achievements: [] },
    level: { min: 0 },
    todayKey: '2026-10-02',
    get subjectMap() {
      return Object.fromEntries(this.subjects.map((s) => [s.id, s]))
    },
    get minutesByDate() {
      const out = {}
      for (const r of this.records) out[r.date] = (out[r.date] || 0) + r.minutes
      return out
    },
    addMaterial(m) {
      this.materials.push(m)
    },
    updateMaterial(id, m) {
      Object.assign(
        this.materials.find((x) => x.id === id),
        m
      )
    },
    recordHabit(id, date, value) {
      this.habits.find((h) => h.id === id).records[date] = value
    },
    updateHabitTarget(id, value) {
      this.habits.find((h) => h.id === id).target = value
    },
    toggleBadHabitCheckin(id, date) {
      const h = this.habits.find((h) => h.id === id)
      h.checkins ||= {}
      if (h.checkins[date]) delete h.checkins[date]
      else {
        h.checkins[date] = 1
        delete h.records[date]
      }
    },
    importNotes(subjectId, items) {
      this.notes.push(...items.map((n) => ({ ...n, subjectId })))
    },
    saveNote(n) {
      const id = n.id || 'new-note'
      this.notes = [{ ...n, id }]
      return id
    },
    saveAsync: async () => true,
    saveEssayTemplate(tpl) {
      this.english.templates.push(tpl)
    },
    get todayPomodoro() {
      return this.pomodoro.daily[this.todayKey] || { count: 0, minutes: 0 }
    },
    recordInterruption(reason) {
      this.pomodoro.interruptions.push({ reason })
    }
  })
  const source = (await readFile(`${root}/${file}`, 'utf8')).match(/<script setup[^>]*>([\s\S]*?)<\/script>/)[1]
  const result = await build({
    stdin: {
      contents: source + `\nexport { ${names.join(',')} };`,
      resolveDir: `${root}/${file.split('/').slice(0, -1).join('/')}`,
      loader: 'ts'
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    plugins: [
      {
        name: 'study-ui-boundaries',
        setup(b) {
          b.onResolve({ filter: /\.vue$/ }, () => ({ path: 'component', namespace: 'mock' }))
          b.onResolve({ filter: /^vue$/ }, (args) =>
            args.namespace === 'mock' ? { path: args.path, external: true } : { path: 'vue', namespace: 'mock' }
          )
          b.onResolve(
            {
              filter:
                /(?:stores\/(?:app|studyTimer)|composables\/(?:useToast|useConfirm|useMarkdownHtml|useChart|useClock|useWallpaperRotation|useOverlayDismiss)|services\/(?:auth|noteBodies|maimemo)|stores\/app\/sync|api\/(?:pdfs|community\/partners))$/
            },
            (args) => ({ path: args.path, namespace: 'mock' })
          )
          b.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path }) => {
            if (path === 'component') return { contents: 'export default {};' }
            if (path === 'vue')
              return {
                contents: `export {ref,computed,watch} from 'vue'; export const nextTick=(callback)=>Promise.resolve().then(callback); export const onMounted=()=>{}; export const onUnmounted=(f)=>globalThis.__studyHooks.push(f);`
              }
            if (path.endsWith('/app')) return { contents: 'export const useAppStore=()=>globalThis.__studyStore;' }
            if (path.endsWith('/studyTimer'))
              return { contents: 'export const useStudyTimerStore=()=>({session:null});' }
            if (path.endsWith('/sync')) return { contents: 'export const MAX_FIELD_CHARS=1000000;' }
            if (path.endsWith('/useToast'))
              return { contents: 'export const useToast=()=>s=>globalThis.__studyToasts.push(s);' }
            if (path.endsWith('/useConfirm'))
              return { contents: 'export const useConfirm=()=>(...args)=>globalThis.__studyConfirm(...args);' }
            if (path.endsWith('/useOverlayDismiss'))
              return {
                contents:
                  'export const OVERLAY_LAYER={modal:"z-50"}; export const useOverlayDismiss=()=>({onOverlayMousedown(){},onOverlayClick(){}});'
              }
            if (path.endsWith('/useClock'))
              return {
                contents: `import {ref} from 'vue';export const useClock=()=>({now:ref(new Date('2026-10-02T12:00:00Z')),clockText:ref('20:00'),dateText:ref('2026-10-02')});`
              }
            if (path.endsWith('/useWallpaperRotation'))
              return {
                contents: `import {ref} from 'vue';export const useWallpaperRotation=()=>({bgUrl:ref(''),startBgRotation(){},stopBgRotation(){}});`
              }
            if (path.endsWith('/partners'))
              return { contents: 'export const partnersApi={activeStudySession:async()=>({session:null})};' }
            if (path.endsWith('/useMarkdownHtml'))
              return { contents: `import {ref} from 'vue'; export const useMarkdownHtml=()=>ref('');` }
            if (path.endsWith('/useChart'))
              return {
                contents: `import {ref} from 'vue'; export const chartTextColor=()=>''; export const chartColor=()=>''; export const useChart=(option,deps=[])=>{globalThis.__studyCharts.push({option,deps});return {el:ref(),status:ref('ready'),retry(){}}};`
              }
            if (path.endsWith('/auth')) return { contents: 'export const sessionUser=globalThis.__studyUser;' }
            if (path.endsWith('/pdfs'))
              return {
                contents:
                  'export const PDF_MAX_BYTES=30000000,PDF_MAX_MB=30; export const uploadPdf=(...a)=>globalThis.__studyPdf(...a); export const fetchPdf=async()=>new Uint8Array();'
              }
            if (path.endsWith('/maimemo'))
              return {
                contents:
                  'export const fetchMaimemoToday=async()=>({newWords:0,reviewWords:0});export const fetchMaimemoTodayDetail=async()=>[];'
              }
            return {
              contents: `import {ref} from 'vue'; export const getNoteBody=()=>''; export const noteBodyExcerpt=()=>'';export const noteBodyIncludes=()=>false;export const noteBodyIndexVersion=ref(0);export const pendingNoteBodyIds=ref(new Set());`
            }
          })
          b.onResolve({ filter: /^vue-router$/ }, () => ({ path: 'router', namespace: 'router' }))
          b.onLoad({ filter: /.*/, namespace: 'router' }, () => ({
            contents:
              'export const useRoute=()=>globalThis.__studyRoute;export const useRouter=()=>globalThis.__studyRouter;export const onBeforeRouteLeave=()=>{};'
          }))
        }
      }
    ]
  })
  await mkdir(`${root}/.cache/study-experience`, { recursive: true })
  const filename = `${root}/.cache/study-experience/${crypto.randomUUID()}.mjs`
  await writeFile(filename, result.outputFiles[0].text)
  const app = await import(pathToFileURL(filename).href)
  await unlink(filename)
  t.after(() => {
    for (const f of globalThis.__studyHooks) f()
  })
  return app
}

test('资料页空页数净化、负值和超页拒绝，读取中的附件不会保存或写错表单', async (t) => {
  const app = await load(
    'src/pages/Materials.vue',
    ['open', 'form', 'save', 'readMaterialFile', 'setLinkMode', 'fileReading'],
    t
  )
  app.open()
  app.form.value = { title: '书籍', type: 'book', totalPages: '', readPages: '' }
  app.save()
  assert.equal(globalThis.__studyStore.materials[0].totalPages, undefined)
  assert.equal(globalThis.__studyStore.materials[0].readPages, undefined)
  app.open()
  app.form.value = { title: '书籍', totalPages: 10, readPages: 11 }
  app.save()
  assert.equal(globalThis.__studyStore.materials.length, 1)
  const readers = []
  globalThis.FileReader = class {
    constructor() {
      readers.push(this)
    }
    readAsDataURL() {}
    abort() {}
  }
  app.setLinkMode('file')
  app.readMaterialFile({ name: 'old.txt', size: 10 })
  const reader = readers.at(-1)
  app.save()
  assert.equal(globalThis.__studyStore.materials.length, 1)
  app.open({ id: 'different', title: '另一份资料' })
  reader.result = 'data:text/plain;base64,eA=='
  reader.onload()
  assert.equal(app.form.value.fileName, undefined)
  assert.equal(app.form.value.title, '另一份资料')
  assert.equal(app.fileReading.value, false)
})

test('习惯空输入/负数/小数保留原打卡，显式零允许清空；非法目标不改为1', async (t) => {
  const app = await load('src/pages/Habits.vue', ['record', 'saveTarget', 'startEditTarget', 'editingTargetValue'], t)
  const date = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)
  const h = reactive({ id: 'h', type: 'count', target: 2, records: { [date]: 2 } })
  globalThis.__studyStore.habits = [h]
  for (const v of ['', ' ', -1, 1.5]) {
    app.record(h, v)
    assert.equal(h.records[date], 2)
  }
  app.record(h, '0')
  assert.equal(h.records[date], 0)
  app.startEditTarget(h)
  app.editingTargetValue.value = -10
  app.saveTarget(h)
  assert.equal(h.target, 2)
})

test('重复勾选先确认，拒绝或等待确认保留打卡；确认后才撤销', async (t) => {
  const app = await load('src/pages/Habits.vue', ['toggleHabit'], t)
  const date = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)
  const h = reactive({ id: 'check', type: 'checkbox', records: {} })
  globalThis.__studyStore.habits = [h]
  const prompts = []
  globalThis.__studyConfirm = async (...args) => {
    prompts.push(args)
    return false
  }
  await app.toggleHabit(h)
  assert.equal(h.records[date], 1)
  assert.equal(prompts.length, 0)
  await app.toggleHabit(h)
  assert.equal(h.records[date], 1)
  assert.equal(prompts.length, 1)
  assert.equal(prompts[0][1].danger, true)
  const confirmation = deferred()
  globalThis.__studyConfirm = () => confirmation.promise
  const pending = app.toggleHabit(h)
  await app.toggleHabit(h)
  assert.equal(h.records[date], 1)
  confirmation.resolve(true)
  await pending
  assert.equal(h.records[date], 0)
  assert.equal(globalThis.__studyToasts.at(-1), '已取消打卡')
})

test('取消克制或覆盖发生记录先确认，拒绝时保留原始次数和标记', async (t) => {
  const app = await load('src/pages/Habits.vue', ['toggleCheckin'], t)
  const date = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)
  const h = reactive({ id: 'bad', type: 'count', bad: true, records: { [date]: 2 }, checkins: {} })
  globalThis.__studyStore.habits = [h]
  globalThis.__studyConfirm = async () => false
  await app.toggleCheckin(h)
  assert.equal(h.records[date], 2)
  assert.equal(h.checkins[date], undefined)
  globalThis.__studyConfirm = async () => true
  await app.toggleCheckin(h)
  assert.equal(h.records[date], undefined)
  assert.equal(h.checkins[date], 1)
  globalThis.__studyConfirm = async () => false
  await app.toggleCheckin(h)
  assert.equal(h.checkins[date], 1)
})

test('打卡确认跨午夜或原始记录已改变时，不改写新日或覆盖新数据', async (t) => {
  const app = await load('src/pages/Habits.vue', ['toggleHabit', 'toggleCheckin'], t)
  const originalNow = Date.now
  let stamp = Date.parse('2026-10-05T15:59:50Z')
  Date.now = () => stamp
  t.after(() => {
    Date.now = originalNow
  })
  const date = '2026-10-05',
    next = '2026-10-06'
  const good = reactive({ id: 'good', type: 'checkbox', records: { [date]: 1, [next]: 1 } })
  const bad = reactive({ id: 'bad', type: 'count', bad: true, records: { [date]: 2, [next]: 3 }, checkins: {} })
  globalThis.__studyStore.habits = [good, bad]
  let confirmation = deferred()
  globalThis.__studyConfirm = () => confirmation.promise
  const pending = app.toggleHabit(good)
  stamp += 20000
  confirmation.resolve(true)
  await pending
  assert.equal(good.records[date], 1)
  assert.equal(good.records[next], 1)
  assert.match(globalThis.__studyToasts.at(-1), /日期已切换/)
  stamp -= 20000
  confirmation = deferred()
  const badPending = app.toggleCheckin(bad)
  stamp += 20000
  confirmation.resolve(true)
  await badPending
  assert.equal(bad.records[date], 2)
  assert.equal(bad.records[next], 3)
  assert.deepEqual(bad.checkins, {})
  stamp -= 20000
  confirmation = deferred()
  const changedPending = app.toggleCheckin(bad)
  bad.records[date] = 4
  confirmation.resolve(true)
  await changedPending
  assert.equal(bad.records[date], 4)
  assert.deepEqual(bad.checkins, {})
  assert.match(globalThis.__studyToasts.at(-1), /记录已更新/)
})

test('总结按业务日聚合任务、当前待复习错题、笔记和未分科目专注时长', async (t) => {
  const app = await load('src/pages/DailySummary.vue', ['aggregateDay', 'dayData', 'editDate'], t)
  const store = globalThis.__studyStore
  const date = '2026-10-05'
  store.todos = [
    { id: 'task', date, text: 'QA 提醒测试任务', done: false },
    { id: 'done', date, text: '复习极限', done: true },
    { id: 'past', date: '2026-10-04', text: '昨天任务', done: true }
  ]
  store.errorQuestions = [
    { date, mastered: false },
    { date: '2026-10-04', mastered: false },
    { date, mastered: true },
    { date: '2026-10-06', mastered: false }
  ]
  store.notes = [
    { id: 'note-a', updatedAt: Date.parse('2026-10-04T16:01:00Z') },
    { id: 'note-b', updatedAt: Date.parse('2026-10-05T15:59:00Z') },
    { id: 'past', updatedAt: Date.parse('2026-10-04T15:59:00Z') }
  ]
  store.records = [{ date, minutes: 4, subjectId: 'math' }]
  store.pomodoro.daily[date] = { count: 1, minutes: 1 }
  store.pomodoro.records = [{ date, minutes: 1, completed: true }]
  const day = app.aggregateDay(date)
  assert.equal(day.minutes, 5)
  assert.equal(day.focusMinutes, 1)
  assert.equal(day.bySubject.math, 4)
  assert.equal(day.tasks.length, 2)
  assert.equal(day.tasks[0].text, 'QA 提醒测试任务')
  assert.equal(day.completedTasks, 1)
  assert.equal(day.pendingErrors, 2)
  assert.equal(day.updatedNotes, 2)
  app.editDate.value = date
  store.todos[0].done = true
  store.errorQuestions[0].mastered = true
  assert.equal(app.dayData.value.completedTasks, 2)
  assert.equal(app.dayData.value.pendingErrors, 1)
})

test('总结只打开往日日期，今天和未来日期不会生成空卡片', async (t) => {
  const app = await load('src/pages/DailySummary.vue', ['openDayCard', 'cardDate', 'editDate'], t)
  const date = app.editDate.value
  const future = new Date(Date.parse(`${date}T00:00:00Z`) + 86400_000).toISOString().slice(0, 10)
  const past = new Date(Date.parse(`${date}T00:00:00Z`) - 86400_000).toISOString().slice(0, 10)
  app.openDayCard(future)
  assert.equal(app.cardDate.value, '')
  app.openDayCard(date)
  assert.equal(app.cardDate.value, '')
  app.openDayCard(past)
  assert.equal(app.cardDate.value, past)
})

test('笔记分享保存当前草稿且等待同步；失败不打开分享窗', async (t) => {
  const app = await load('src/pages/Notes.vue', ['draft', 'shareNote', 'shareNoteId', 'preparingShare'], t)
  app.draft.value = { id: 'n', subjectId: 'math', title: '新标题', content: '最新正文' }
  const pending = deferred()
  globalThis.__studyStore.saveAsync = () => pending.promise
  const share = app.shareNote()
  await settle()
  assert.equal(globalThis.__studyStore.notes[0].content, '最新正文')
  assert.equal(app.shareNoteId.value, '')
  assert.equal(app.preparingShare.value, true)
  pending.resolve(false)
  await share
  assert.equal(app.shareNoteId.value, '')
  globalThis.__studyStore.saveAsync = async () => true
  await app.shareNote()
  assert.equal(app.shareNoteId.value, 'n')
})

test('笔记异步导入固定原科目，账号切换或卸载后不写入新账号', async (t) => {
  const app = await load('src/pages/Notes.vue', ['draft', 'onFileChange', 'doSave'], t)
  app.draft.value = { subjectId: 'math', title: '原稿', content: '内容' }
  const first = deferred()
  app.onFileChange({ target: { files: [{ name: 'a.txt', size: 1, text: () => first.promise }] } })
  app.draft.value.subjectId = 'english'
  first.resolve('原科目内容')
  await settle()
  assert.equal(globalThis.__studyStore.notes[0].subjectId, 'math')
  const late = deferred()
  app.onFileChange({ target: { files: [{ name: 'b.txt', size: 1, text: () => late.promise }] } })
  globalThis.__studyUser.value = { id: 'another' }
  late.resolve('不应写入新账号')
  await settle()
  assert.equal(globalThis.__studyStore.notes.length, 1)
  assert.equal(app.doSave(), null)
})

test('学习统计数据依赖随云端新记录改变，成就日期跨午夜更新', async (t) => {
  await load('src/pages/Statistics.vue', ['days'], t)
  const charts = globalThis.__studyCharts
  const before = charts.map((c) => JSON.stringify(c.deps.map((d) => d.value)))
  const store = globalThis.__studyStore
  store.records.push({ subjectId: 'math', date: store.todayKey, minutes: 20 })
  store.problemSessions.push({ subjectId: 'math', date: store.todayKey, total: 10, correct: 8, types: {} })
  store.pomodoro.daily[store.todayKey] = { count: 1, minutes: 25 }
  store.summaries[store.todayKey] = { mood: '😊 开心' }
  await nextTick()
  for (const i of [0, 2, 4, 5]) assert.notEqual(JSON.stringify(charts[i].deps.map((d) => d.value)), before[i])
  const rewards = await load('src/pages/Rewards.vue', ['rankDays'], t)
  assert.equal(rewards.rankDays.value.at(-1), '2026-10-02')
  globalThis.__studyStore.todayKey = '2026-10-03'
  assert.equal(rewards.rankDays.value.at(-1), '2026-10-03')
})

test('英语畸形单词缓存过滤，跨日加载新日缓存；作答畸形双模式降级', async (t) => {
  storage.set(
    'maimemo-today-words:u:2026-10-02',
    JSON.stringify([null, {}, { vocId: 'one', spelling: 'one', meaning: '一', isNew: true, isFinished: true }])
  )
  const english = await load('src/pages/English.vue', ['todayWords'], t)
  assert.equal(english.todayWords.value.length, 1)
  globalThis.__studyStore.todayKey = '2026-10-03'
  await nextTick()
  assert.equal(english.todayWords.value.length, 0)
  const date = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)
  storage.set(
    `vocab-checkin:u:${date}`,
    JSON.stringify({ one: { zh: { answer: '一', validation: true, show: false } }, two: { zh: {} } })
  )
  const vocab = await load('src/components/VocabCheckList.vue', ['getWord'], t)
  assert.equal(vocab.getWord('one').en.validation, null)
  assert.equal(vocab.getWord('two').zh.answer, '')
})

test('资料及习惯服务端拒绝非法新写，合法空字段和时间仍可保存', async () => {
  const built = await build({
    stdin: {
      contents: `export {materialsMapping} from './worker/src/api/materials';export {habitBodySchema} from './worker/src/api/habits';export {utc8Today} from './worker/src/db';`,
      resolveDir: root
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false
  })
  const filename = `${root}/.cache/study-experience/${crypto.randomUUID()}.mjs`
  await writeFile(filename, built.outputFiles[0].text)
  const backend = await import(pathToFileURL(filename).href)
  await unlink(filename)
  const material = { title: '教材', type: 'book' }
  assert.equal(backend.materialsMapping.mapping.schema.safeParse(material).success, true)
  for (const invalid of [
    { title: ' ' },
    { totalPages: '' },
    { totalPages: -1 },
    { readPages: 1.5 },
    { totalPages: 2, readPages: 3 }
  ])
    assert.equal(backend.materialsMapping.mapping.schema.safeParse({ ...material, ...invalid }).success, false)
  const date = backend.utc8Today()
  const habit = { name: '做题', type: 'count', target: 2, records: { [date]: 2 } }
  assert.equal(backend.habitBodySchema.safeParse(habit).success, true)
  for (const value of ['', -1, 1.5, Infinity])
    assert.equal(backend.habitBodySchema.safeParse({ ...habit, records: { [date]: value } }).success, false)
  for (const target of [0, 1.5]) assert.equal(backend.habitBodySchema.safeParse({ ...habit, target }).success, true)
  assert.equal(backend.habitBodySchema.safeParse({ ...habit, target: -1 }).success, false)
  assert.equal(
    backend.habitBodySchema.safeParse({ name: '睡觉', type: 'time', records: { '2026-10-02': '23:30' } }).success,
    true
  )
  assert.equal(
    backend.habitBodySchema.safeParse({ name: '睡觉', type: 'time', records: { '2026-10-02': '25:70' } }).success,
    false
  )
})

test('提前结束计入每次专注平均，空中断原因不会记账且保存防重', async (t) => {
  const app = await load(
    'src/pages/Pomodoro.vue',
    ['averageFocusMinutes', 'showInterrupt', 'interruptReason', 'submitInterrupt'],
    t
  )
  const store = globalThis.__studyStore
  store.pomodoro.records = [
    { date: store.todayKey, minutes: 25, completed: true },
    { date: store.todayKey, minutes: 5, completed: false }
  ]
  store.pomodoro.daily[store.todayKey] = { count: 1, minutes: 30 }
  assert.equal(app.averageFocusMinutes.value, 15)
  store.pomodoro.records = []
  store.pomodoro.daily[store.todayKey] = { count: 2, minutes: 50 }
  assert.equal(app.averageFocusMinutes.value, 25)
  app.showInterrupt.value = true
  app.submitInterrupt()
  assert.equal(store.pomodoro.interruptions.length, 0)
  app.interruptReason.value = '看手机'
  app.submitInterrupt()
  app.submitInterrupt()
  assert.equal(store.pomodoro.interruptions.length, 1)
})
