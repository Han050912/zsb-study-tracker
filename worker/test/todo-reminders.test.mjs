import test, { after, afterEach, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import { createRenderer, h, nextTick, provide, reactive, ref } from 'vue'

const result = await build({
  stdin: {
    contents: `export { useReminders } from './src/composables/useReminders';
      export { APP_READY_KEY } from './src/composables/useAppBoot';
      export { TOAST_KEY } from './src/composables/useToast';
      export { default as TimeFieldCard } from './src/components/TimeFieldCard.vue';
      export * from './src/utils/todoTime';`,
    resolveDir: process.cwd()
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  external: ['vue'],
  plugins: [
    {
      name: 'reminder-boundaries',
      setup(builder) {
        builder.onResolve({ filter: /(?:stores\/app|services\/(?:auth|reminder|partnerReminder))$/ }, ({ path }) => ({
          path,
          namespace: 'boundary'
        }))
        builder.onLoad({ filter: /.*/, namespace: 'boundary' }, ({ path }) => {
          if (path.endsWith('stores/app'))
            return { contents: 'export const useAppStore = () => globalThis.__todoReminders.store;' }
          if (path.endsWith('/auth'))
            return { contents: 'import { ref } from "vue"; export const isLoggedIn = ref(false);' }
          if (path.endsWith('/reminder')) return { contents: 'export const restartReminder = () => {};' }
          return {
            contents: 'export const startPartnerReminder = () => {}; export const stopPartnerReminder = () => {};'
          }
        })
        builder.onLoad({ filter: /TimeFieldCard\.vue$/ }, async ({ path }) => {
          const descriptor = parse(await readFile(path, 'utf8'), { filename: path }).descriptor
          const script = compileScript(descriptor, { id: 'time-field-tests', genDefaultAs: 'TimeField' })
          const template = compileTemplate({
            source: descriptor.template.content,
            filename: path,
            id: 'time-field-tests',
            compilerOptions: { bindingMetadata: script.bindings }
          })
          assert.deepEqual(template.errors, [])
          return {
            contents: `${script.content}\n${template.code}\nTimeField.render = render; export default TimeField;`,
            loader: 'ts',
            resolveDir: resolve('src/components')
          }
        })
      }
    }
  ]
})
await mkdir('.cache/todo-reminder-tests', { recursive: true })
const filename = `.cache/todo-reminder-tests/${crypto.randomUUID()}.mjs`
await writeFile(filename, result.outputFiles[0].text)
const { useReminders, APP_READY_KEY, TOAST_KEY, TimeFieldCard, isValidTodoTime, todoTimeToTodayTs } = await import(
  pathToFileURL(resolve(filename)).href
)
after(() => unlink(filename))

function node(tag, text = '') {
  return { tag, text, props: {}, children: [], parent: null }
}
const renderer = createRenderer({
  createElement: (tag) => node(tag),
  createText: (text) => node('#text', text),
  createComment: (text) => node('#comment', text),
  setText: (element, text) => {
    element.text = text
  },
  setElementText: (element, text) => {
    element.children = []
    element.text = text
  },
  patchProp: (element, key, _previous, value) => {
    element.props[key] = value
  },
  insert(element, parent, anchor = null) {
    if (element.parent) element.parent.children.splice(element.parent.children.indexOf(element), 1)
    const index = anchor ? parent.children.indexOf(anchor) : -1
    parent.children.splice(index < 0 ? parent.children.length : index, 0, element)
    element.parent = parent
  },
  remove(element) {
    element.parent.children.splice(element.parent.children.indexOf(element), 1)
    element.parent = null
  },
  parentNode: (element) => element.parent,
  nextSibling: (element) => element.parent?.children[element.parent.children.indexOf(element) + 1] ?? null
})
const apps = []
function all(root) {
  return [root, ...root.children.flatMap(all)]
}
function field(root, label) {
  return all(root).find((element) => element.tag === 'input' && element.props['aria-label'] === label)
}
async function input(root, label, value) {
  field(root, label).props.onInput({ target: { value } })
  await nextTick()
}
const text = (element) => element.text + element.children.map(text).join('')

beforeEach(() => {
  globalThis.window = {}
  globalThis.document = Object.assign(new EventTarget(), { visibilityState: 'visible' })
  globalThis.__todoReminders = {
    messages: [],
    store: reactive({
      settings: { reminderEnabled: false, reminderTime: '08:00', doNotDisturb: false },
      todos: [],
      markTodosNotified(ids, kind) {
        for (const todo of this.todos) if (ids.includes(todo.id)) todo[`${kind}NotifiedAt`] = Date.now()
      }
    })
  }
})
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount()
  delete globalThis.Notification
})

function allowNotification(permission) {
  globalThis.Notification = class {
    static permission = permission
    constructor() {
      throw new Error('No OS notification available')
    }
  }
  window.Notification = globalThis.Notification
}
async function mountReminders(ready = ref(true)) {
  const ToastSink = {
    setup(_props, { expose }) {
      expose({ show: (message) => globalThis.__todoReminders.messages.push(message) })
      return () => h('div')
    }
  }
  const ReminderOwner = {
    setup() {
      const toastRef = ref()
      const toast = (message) => toastRef.value?.show(message)
      // Match App.vue: the provider owns the reminder composable in the same setup.
      provide(TOAST_KEY, toast)
      useReminders(toast)
      return () => (ready.value ? h(ToastSink, { ref: toastRef }) : h('div', 'loading'))
    }
  }
  const app = renderer.createApp(ReminderOwner)
  app.provide(APP_READY_KEY, ready)
  apps.push(app)
  app.mount(node('root'))
  await nextTick()
  return app
}
const todo = (id, schedule) => ({ id, text: `任务 ${id}`, done: false, ...schedule })

test('Now saved in the current minute gets a foreground reminder without Notification permission and is deduplicated over 75 seconds', async (ctx) => {
  ctx.mock.timers.enable({ apis: ['Date', 'setInterval'], now: new Date(2026, 9, 5, 9, 42, 35).getTime() })
  allowNotification('default')
  await mountReminders()
  const state = globalThis.__todoReminders
  const startAt = todoTimeToTodayTs('09:42')
  assert.ok(startAt <= Date.now())
  state.store.todos.push(todo('now', { startAt }))
  await nextTick()
  assert.equal(state.messages.length, 1)
  assert.match(state.messages[0], /待办已到开始时间.*任务 now/)
  assert.ok(state.store.todos[0].startNotifiedAt)
  ctx.mock.timers.tick(75_000)
  await nextTick()
  assert.equal(state.messages.length, 1)
})

test('missed reminders wait for hydration and its Toast to mount before they are acknowledged', async () => {
  const ready = ref(false),
    state = globalThis.__todoReminders
  state.store.todos.push(todo('loaded', { startAt: Date.now() - 60_000 }))
  await mountReminders(ready)
  assert.equal(state.messages.length, 0)
  assert.equal(state.store.todos[0].startNotifiedAt, undefined)
  state.store.todos.push(todo('cloud', { dueAt: Date.now() - 30_000 }))
  await nextTick()
  assert.equal(state.store.todos[1].dueNotifiedAt, undefined)
  ready.value = true
  await nextTick()
  assert.equal(state.messages.length, 2)
  assert.match(state.messages[0], /任务 loaded/)
  assert.match(state.messages[1], /任务 cloud/)
})

test('reminder polling covers future deadlines, skips completed tasks, and falls back when notifications are denied', async (ctx) => {
  ctx.mock.timers.enable({ apis: ['Date', 'setInterval'], now: 1_000_000 })
  allowNotification('denied')
  const state = globalThis.__todoReminders
  state.store.todos.push(
    todo('start', { startAt: Date.now() + 65_000 }),
    todo('done', { dueAt: Date.now() + 65_000, done: true })
  )
  await mountReminders()
  ctx.mock.timers.tick(60_000)
  assert.equal(state.messages.length, 0)
  ctx.mock.timers.tick(30_000)
  await nextTick()
  assert.equal(state.messages.length, 1)
  assert.match(state.messages[0], /任务 start/)
  assert.equal(state.store.todos[1].dueNotifiedAt, undefined)
})

test('saving Now again in the same minute resets deduplication and immediately delivers the changed reminder', async () => {
  const state = globalThis.__todoReminders,
    startAt = Date.now() - 10_000
  state.store.todos.push(todo('again', { startAt, startNotifiedAt: Date.now() - 5000 }))
  await mountReminders()
  assert.equal(state.messages.length, 0)
  delete state.store.todos[0].startNotifiedAt
  await nextTick()
  assert.equal(state.messages.length, 1)
  assert.match(state.messages[0], /任务 again/)
})

test('unmount stops the reminder timer and visibility listener', async (ctx) => {
  ctx.mock.timers.enable({ apis: ['Date', 'setInterval'], now: 1_000_000 })
  const state = globalThis.__todoReminders
  state.store.todos.push(todo('later', { startAt: Date.now() + 30_000 }))
  const app = await mountReminders()
  app.unmount()
  apps.splice(apps.indexOf(app), 1)
  ctx.mock.timers.tick(60_000)
  document.dispatchEvent(new Event('visibilitychange'))
  assert.equal(state.messages.length, 0)
  assert.equal(state.store.todos[0].startNotifiedAt, undefined)
})

async function mountFields() {
  const values = reactive({ start: '10:05', due: '18:00' }),
    root = node('root')
  const app = renderer.createApp({
    render: () =>
      h(
        'div',
        ['start', 'due'].map((key) =>
          h(TimeFieldCard, {
            title: key === 'start' ? '开始时间' : '最晚截止时间',
            desc: '设置任务提醒时间',
            accent: key === 'start' ? 'sky' : 'amber',
            modelValue: values[key],
            presets: [
              { label: '现在', value: 'now' },
              { label: '14:00', value: '14:00' }
            ],
            'onUpdate:modelValue': (value) => {
              values[key] = value
            }
          })
        )
      )
  })
  apps.push(app)
  app.mount(root)
  await nextTick()
  return { root, values }
}

test('hours and minutes are independently keyboard editable, preserve the other part, and expose invalid/incomplete edits', async () => {
  const { root, values } = await mountFields()
  const hour = field(root, '开始时间小时'),
    minute = field(root, '开始时间分钟')
  assert.equal(hour.props.type, 'number')
  assert.equal(hour.props.readonly, undefined)
  assert.equal(minute.props.readonly, undefined)
  await input(root, '开始时间小时', '17')
  await input(root, '开始时间分钟', '38')
  assert.equal(values.start, '17:38')
  await input(root, '开始时间小时', '')
  assert.equal(values.start, ':38')
  assert.equal(hour.props['aria-invalid'], true)
  await input(root, '开始时间小时', '9')
  assert.equal(values.start, '09:38')
  assert.equal(hour.props['aria-invalid'], false)
  await input(root, '开始时间分钟', '60')
  assert.equal(isValidTodoTime(values.start), false)
  assert.ok(all(root).some((element) => element.props.role === 'alert' && /小时 0–23，分钟 0–59/.test(text(element))))
})

test('two time cards have unique IDs, explicit labels/descriptions, and distinguishable clear buttons', async () => {
  const { root, values } = await mountFields()
  const elements = all(root),
    ids = elements.filter((element) => element.props.id).map((element) => element.props.id)
  assert.equal(ids.length, new Set(ids).size)
  for (const input of elements.filter((element) => element.tag === 'input')) {
    assert.ok(elements.some((element) => element.tag === 'label' && element.props.for === input.props.id))
    for (const id of input.props['aria-describedby'].split(' ')) assert.ok(ids.includes(id))
  }
  const clearStart = elements.find((element) => element.props['aria-label'] === '清除开始时间')
  const clearDue = elements.find((element) => element.props['aria-label'] === '清除最晚截止时间')
  assert.ok(clearStart && clearDue && clearStart !== clearDue)
  clearStart.props.onClick()
  await nextTick()
  assert.equal(values.start, '')
  assert.equal(values.due, '18:00')
  assert.equal(field(root, '开始时间小时').props.value, '')
})

test('time validation preserves valid arbitrary minute values and rejects malformed/out-of-range values before saving', () => {
  for (const value of ['', '00:00', '09:07', '17:38', '23:59']) assert.equal(isValidTodoTime(value), true)
  for (const value of [':38', '24:00', '12:60', '1.5:00', '09:', 'x', '09:07:03']) {
    assert.equal(isValidTodoTime(value), false)
    assert.equal(todoTimeToTodayTs(value), undefined)
  }
  const timestamp = todoTimeToTodayTs('17:38'),
    date = new Date(timestamp)
  assert.equal(date.getHours(), 17)
  assert.equal(date.getMinutes(), 38)
  assert.equal(date.getSeconds(), 0)
})
