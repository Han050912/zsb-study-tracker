import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { reactive, nextTick } from 'vue'
import * as Vue from 'vue'
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const modules = {
  vue: `export {ref,computed,watch} from 'vue'; export const onUnmounted=fn=>globalThis.__flowUnmount.push(fn);`,
  'vue-router': `export const useRoute=()=>globalThis.__flowRoute; export const useRouter=()=>({replace:path=>globalThis.__flowRoutes.push(path)});`,
  '@lucide/vue': 'export const ChevronUp={},ChevronDown={};',
  app: 'export const useAppStore=()=>globalThis.__flowStore;',
  auth: 'export const sessionUser=globalThis.__flowUser;',
  useToast: 'export const useToast=()=>message=>globalThis.__flowToasts.push(message);',
  useConfirm: 'export const useConfirm=()=>async()=>true;',
  useOverlayDismiss: 'export const OVERLAY_LAYER={guide:""}; export const useOverlayDismiss=()=>({});',
  errorImages: 'export const ERROR_IMAGE_PREFIX="r2:"; export const uploadErrorImage=async()=>"unused";',
  component: 'export default {};'
}
await mkdir('.cache/study-flow', { recursive: true })
const files = []
async function component(path, exports) {
  const source = await readFile(path, 'utf8')
  const script = source.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]
  const compiled = await build({
    stdin: {
      contents: `const defineEmits=()=> (...args)=>globalThis.__flowEmits.push(args);\n${script}\nexport {${exports}};`,
      resolveDir: `${process.cwd()}/${path.split('/').slice(0, -1).join('/')}`,
      loader: 'ts'
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
    plugins: [
      {
        name: 'study-ui-boundaries',
        setup(builder) {
          builder.onResolve({ filter: /^vue$/ }, ({ namespace }) =>
            namespace === 'boundary' ? { path: 'vue', external: true } : { path: 'vue', namespace: 'boundary' }
          )
          builder.onResolve(
            {
              filter:
                /^(vue-router|@lucide\/vue)$|stores\/app$|services\/auth$|composables\/(useToast|useConfirm|useOverlayDismiss)$|api\/errorImages$|\.vue$/
            },
            ({ path }) => ({
              path: path.endsWith('.vue') ? 'component' : path === '@lucide/vue' ? path : path.split('/').at(-1),
              namespace: 'boundary'
            })
          )
          builder.onLoad({ filter: /.*/, namespace: 'boundary' }, ({ path }) => ({ contents: modules[path] }))
        }
      }
    ]
  })
  const file = `.cache/study-flow/interaction-${crypto.randomUUID()}.mjs`
  await writeFile(file, compiled.outputFiles[0].text)
  files.push(file)
  return import(pathToFileURL(`${process.cwd()}/${file}`).href)
}
after(async () => {
  for (const file of files) await unlink(file)
})

function setup() {
  globalThis.__flowRoute = reactive({ query: {} })
  globalThis.__flowUser = reactive({ value: { id: 'user-a' } })
  globalThis.__flowRoutes = []
  globalThis.__flowEmits = []
  globalThis.__flowToasts = []
  globalThis.__flowUnmount = []
  const subjects = [
    {
      id: 'math',
      name: '数学',
      weight: 50,
      icon: 'BookOpen',
      chapters: [{ id: 'limits', name: '极限', topics: [] }],
      mastery: {}
    }
  ]
  globalThis.__flowStore = reactive({
    settings: { examDate: '', dailyGoalMinutes: 60, onboarded: false },
    subjects,
    subjectMap: { math: subjects[0] },
    todayKey: '2026-10-11',
    todos: [],
    records: [],
    pomodoro: { records: [], daily: {} },
    errorQuestions: [],
    problemSessions: [],
    reviews: [],
    updateSettings(value) {
      Object.assign(this.settings, value)
    },
    updateSubjectWeight(id, weight) {
      this.subjects.find((s) => s.id === id).weight = weight
    },
    addTodo(text, schedule, date, links = {}) {
      this.todos.push({ id: crypto.randomUUID(), text, date, done: false, ...links })
    },
    reviewError(id, result) {
      this.reviews.push({ id, result })
      this.errorQuestions.find((q) => q.id === id).nextReviewDate = '2026-10-12'
    }
  })
  return globalThis.__flowStore
}

test('skipping first-run setup leaves a visible checklist and completing it creates one linked first task', async () => {
  const store = setup()
  const guide = await component(
    'src/components/Onboarding.vue',
    'skip,advance,step,examDate,dailyMinutes,task,taskSubject,error'
  )
  guide.skip()
  assert.equal(store.settings.onboarded, true)
  assert.equal(store.todos.length, 0)
  const checklist = await component('src/components/SetupChecklist.vue', 'missing,open')
  assert.deepEqual(checklist.missing.value, ['考试日期', '第一项任务'])
  const resumed = await component(
    'src/components/Onboarding.vue',
    'advance,step,examDate,dailyMinutes,task,taskSubject,error'
  )
  resumed.examDate.value = '2026-12-01'
  resumed.advance()
  resumed.dailyMinutes.value = 45
  resumed.advance()
  resumed.task.value = '极限错题 5 道'
  resumed.advance()
  resumed.advance()
  assert.equal(store.todos.length, 1)
  assert.equal(store.todos[0].subjectId, 'math')
  assert.equal(store.settings.dailyGoalMinutes, 45)
  assert.deepEqual(checklist.missing.value, [])
})

test('applying the same plan twice is idempotent and stale chapter choices create no tasks', async () => {
  const store = setup()
  const planner = await component(
    'src/components/LearningPathCard.vue',
    'openPlanner,applyPlan,choices,planDate,planError'
  )
  planner.openPlanner()
  planner.applyPlan()
  planner.openPlanner()
  planner.applyPlan()
  assert.equal(store.todos.length, 1)
  assert.equal(store.todos[0].chapterId, 'limits')
  planner.openPlanner()
  planner.planDate.value = '2026-10-12'
  store.subjects[0].chapters = []
  planner.applyPlan()
  assert.match(planner.planError.value, /变更/)
  assert.equal(store.todos.length, 1)
})

test('onboarding rejects a subject removed while the final step is open before making any edits', async () => {
  const store = setup()
  const english = { id: 'english', name: '英语', weight: 50, chapters: [], mastery: {} }
  store.subjects.push(english)
  store.subjectMap.english = english
  const guide = await component('src/components/Onboarding.vue', 'advance,step,examDate,task,taskSubject,error')
  guide.examDate.value = '2026-12-01'
  guide.advance()
  guide.advance()
  guide.task.value = '完成练习'
  store.subjects = store.subjects.filter((s) => s.id !== 'math')
  delete store.subjectMap.math
  guide.advance()
  assert.match(guide.error.value, /变更/)
  assert.equal(store.todos.length, 0)
  assert.equal(store.settings.examDate, '')
  assert.equal(guide.taskSubject.value, 'english')
  guide.advance()
  assert.equal(store.todos[0].subjectId, 'english')
})

test('an open setup guide stays mounted when reactive checklist requirements become complete', async () => {
  const store = setup()
  store.settings.onboarded = true
  const checklist = await component('src/components/SetupChecklist.vue', 'missing,open')
  const source = await readFile('src/components/SetupChecklist.vue', 'utf8')
  const render = Vue.compile(source.match(/<template>([\s\S]*?)<\/template>/)[1])
  let mounts = 0,
    unmounts = 0
  const make = (type, text = '') => ({ type, text, children: [], parent: null })
  const remove = (node) => {
    if (node.parent) {
      const siblings = node.parent.children
      siblings.splice(siblings.indexOf(node), 1)
      node.parent = null
    }
  }
  const renderer = Vue.createRenderer({
    createElement: make,
    createText: (text) => make('text', text),
    createComment: (text) => make('comment', text),
    setText: (node, text) => {
      node.text = text
    },
    setElementText: (node, text) => {
      node.text = text
    },
    patchProp: () => {},
    parentNode: (node) => node.parent,
    nextSibling: (node) => node.parent?.children[node.parent.children.indexOf(node) + 1] || null,
    remove,
    insert(node, parent, anchor) {
      remove(node)
      node.parent = parent
      const index = anchor ? parent.children.indexOf(anchor) : -1
      if (index < 0) parent.children.push(node)
      else parent.children.splice(index, 0, node)
    }
  })
  const app = renderer.createApp({
    setup: () => ({ store, open: checklist.open, missing: checklist.missing }),
    render,
    components: {
      Onboarding: {
        setup() {
          mounts++
          Vue.onUnmounted(() => unmounts++)
          return () => Vue.h('div', 'guide')
        }
      }
    }
  })
  app.mount(make('root'))
  try {
    checklist.open.value = true
    await nextTick()
    assert.equal(mounts, 1)
    store.settings.examDate = '2026-12-01'
    store.todos.push({ id: 'new', text: 'first task' })
    await nextTick()
    assert.deepEqual(checklist.missing.value, [])
    assert.equal(unmounts, 0, 'the modal owns its close event even if the checklist disappears')
    checklist.open.value = false
    await nextTick()
    assert.equal(unmounts, 1)
  } finally {
    app.unmount()
  }
})

function questions(store) {
  store.errorQuestions = [
    {
      id: 'q1',
      subjectId: 'math',
      date: '2026-10-01',
      nextReviewDate: '2026-10-10',
      mastered: false,
      reviewCount: 0,
      content: 'first'
    },
    {
      id: 'q2',
      subjectId: 'math',
      date: '2026-10-01',
      nextReviewDate: '2026-10-11',
      mastered: false,
      reviewCount: 0,
      content: 'second'
    }
  ]
}

test('a review needs a fresh answer reveal for every question; double activation cannot rate the next one', async () => {
  const store = setup()
  questions(store)
  const book = await component('src/pages/ErrorBook.vue', 'startReview,rateReview,revealAnswer,currentReview')
  book.startReview(5)
  book.rateReview('good')
  assert.equal(store.reviews.length, 0)
  book.revealAnswer.value = true
  book.rateReview('good')
  book.rateReview('good')
  assert.equal(store.reviews.length, 1)
  assert.equal(book.currentReview.value.id, 'q2')
  assert.equal(book.revealAnswer.value, false)
})

test('review state cannot rate a replacement account question with the same imported ID', async () => {
  const store = setup()
  questions(store)
  const book = await component('src/pages/ErrorBook.vue', 'startReview,rateReview,revealAnswer')
  book.startReview(5)
  book.revealAnswer.value = true
  globalThis.__flowUser.value = { id: 'user-b' }
  store.errorQuestions = [{ ...store.errorQuestions[0], content: 'different account' }]
  book.rateReview('good')
  assert.equal(store.reviews.length, 0, 'an old review must not write into the next account')
})

test('same-page navigation updates review filters', async () => {
  const store = setup()
  questions(store)
  const book = await component('src/pages/ErrorBook.vue', 'filterSubject,reviewFilter')
  globalThis.__flowRoute.query = { subject: 'math', review: 'due' }
  await nextTick()
  assert.equal(book.filterSubject.value, 'math')
  assert.equal(book.reviewFilter.value, 'due')
})

test('replacing or deleting a revealed question cannot transfer the old answer reveal to the next question', async () => {
  const store = setup()
  questions(store)
  const book = await component('src/pages/ErrorBook.vue', 'startReview,rateReview,revealAnswer,currentReview')
  book.startReview(5)
  book.revealAnswer.value = true
  store.errorQuestions[0] = { ...store.errorQuestions[0], content: 'new imported question' }
  assert.equal(book.currentReview.value.id, 'q2')
  assert.equal(book.revealAnswer.value, false)
  book.rateReview('good')
  assert.equal(store.reviews.length, 0)
  book.revealAnswer.value = true
  for (const unmount of globalThis.__flowUnmount) unmount()
  book.rateReview('good')
  assert.equal(store.reviews.length, 0)
})
