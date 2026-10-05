import test, { after, afterEach, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import { createRenderer, nextTick, reactive } from 'vue'

const source = await readFile('src/pages/Dashboard.vue', 'utf8')
const descriptor = parse(source, { filename: 'Dashboard.vue' }).descriptor
const script = compileScript(descriptor, { id: 'todo-interactions', genDefaultAs: 'DashboardPage' })
const template = compileTemplate({
  source: descriptor.template.content,
  filename: 'Dashboard.vue',
  id: 'todo-interactions',
  compilerOptions: { bindingMetadata: script.bindings }
})
assert.deepEqual(template.errors, [])

globalThis.window = new EventTarget()
globalThis.Document = class Document {}
globalThis.document = Object.assign(new Document(), { activeElement: null })
const data = new Map()
globalThis.localStorage = {
  get length() {
    return data.size
  },
  key: (index) => [...data.keys()][index] ?? null,
  getItem: (key) => data.get(key) ?? null,
  setItem: (key, value) => data.set(key, value),
  removeItem: (key) => data.delete(key)
}
const result = await build({
  stdin: {
    contents: `export { default as DashboardPage } from './src/pages/Dashboard.vue';
      export { todosActions } from './src/stores/app/todos';
      export { createDefaultState } from './src/data/defaults'; export { today } from './src/utils/date';
      export { setOutboxUser, takeForFlush } from './src/services/syncOutbox';`,
    resolveDir: process.cwd()
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  external: ['vue'],
  plugins: [
    {
      name: 'dashboard-boundaries',
      setup(builder) {
        builder.onResolve(
          { filter: /(?:stores\/app|composables\/(?:useToast|useConfirm)|services\/notify|@lucide\/vue)$/ },
          ({ path }) => ({
            path,
            namespace: 'boundary'
          })
        )
        builder.onResolve({ filter: /\.vue$/ }, ({ path }) => ({ path, namespace: 'component' }))
        builder.onLoad({ filter: /.*/, namespace: 'component' }, ({ path }) => {
          if (path.endsWith('/Dashboard.vue'))
            return {
              contents: `${script.content}\n${template.code}\nDashboardPage.render = render; export default DashboardPage;`,
              loader: 'ts',
              resolveDir: resolve('src/pages')
            }
          if (path.endsWith('/Modal.vue'))
            return {
              contents: `import { h } from 'vue'; export default {
                props: ['show', 'title'], emits: ['close'],
                setup(props, { slots, emit }) {
                  return () => props.show ? h('section', { role: 'dialog', 'data-title': props.title }, [
                    h('h2', props.title), h('button', { 'aria-label': '关闭', onClick: () => emit('close') }, '关闭'),
                    slots.default?.(), slots.footer?.()
                  ]) : null;
                }
              };`
            }
          return { contents: 'export default { render: () => null };' }
        })
        builder.onLoad({ filter: /.*/, namespace: 'boundary' }, ({ path }) => {
          if (path.endsWith('stores/app'))
            return { contents: 'export const useAppStore = () => globalThis.__todoFeedback.store;' }
          if (path.endsWith('useToast'))
            return {
              contents: 'export const useToast = () => message => globalThis.__todoFeedback.toasts.push(message);'
            }
          if (path.endsWith('useConfirm'))
            return {
              contents: 'export const useConfirm = () => (...args) => globalThis.__todoFeedback.confirm(...args);'
            }
          if (path.endsWith('services/notify'))
            return {
              contents: `export const notifyPermission=()=>'granted'; export const requestNotifyPermission=async()=>'granted';`
            }
          return {
            contents:
              'const Icon = { render: () => null }; export { Icon as Play, Icon as GripVertical, Icon as Pencil, Icon as Trash2, Icon as ChevronUp, Icon as ChevronDown, Icon as ArrowRight };'
          }
        })
      }
    }
  ]
})
await mkdir('.cache/todo-interaction-tests', { recursive: true })
const filename = `.cache/todo-interaction-tests/${crypto.randomUUID()}.mjs`
await writeFile(filename, result.outputFiles[0].text)
const { DashboardPage, todosActions, createDefaultState, today, setOutboxUser, takeForFlush } = await import(
  pathToFileURL(resolve(filename)).href
)
after(() => unlink(filename))

function node(tag, text = '') {
  return {
    tag,
    tagName: tag.toUpperCase(),
    text,
    props: {},
    children: [],
    parent: null,
    value: '',
    listeners: {},
    getRootNode: () => document,
    addEventListener(name, listener) {
      this.listeners[name] = listener
    },
    removeEventListener(name) {
      delete this.listeners[name]
    }
  }
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
const text = (element) => element.text + element.children.map(text).join('')
function find(root, predicate) {
  if (predicate(root)) return root
  for (const child of root.children) {
    const found = find(child, predicate)
    if (found) return found
  }
  return null
}
async function mount() {
  const root = node('root'),
    app = renderer.createApp(DashboardPage)
  app.component('RouterLink', { render: () => null })
  apps.push(app)
  app.mount(root)
  await nextTick()
  return {
    root,
    input: () => find(root, (element) => element.props.id === 'todo-title'),
    dialog: () => find(root, (element) => element.props['data-title'] === '编辑任务'),
    button: (label) => find(root, (element) => element.tag === 'button' && text(element).trim() === label),
    action: (label) => find(root, (element) => element.tag === 'button' && element.props['aria-label'] === label),
    error: () => find(root, (element) => element.props.id === 'todo-title-error'),
    async submit() {
      await find(root, (element) => element.props.id === 'todo-title-form').props.onSubmit({ preventDefault() {} })
      await nextTick()
    }
  }
}
async function type(element, value) {
  element.value = value
  element.listeners.input({ target: element })
  if (element.props.onInput) await element.props.onInput({ target: element })
  await nextTick()
}
async function click(element) {
  await element.props.onClick({})
  await nextTick()
}
function originalTodo() {
  return {
    id: 'task-a',
    date: today(),
    text: '复习极限',
    done: true,
    order: 2,
    completedAt: 100,
    startAt: 200,
    dueAt: 300,
    startNotifiedAt: 210,
    dueNotifiedAt: 310,
    updatedAt: 1
  }
}
beforeEach(() => {
  data.clear()
  setOutboxUser('todo-user')
  const state = (globalThis.__todoFeedback = {
    saves: 0,
    awards: [],
    revokes: [],
    toasts: [],
    confirm: async () => false
  })
  const store = Object.assign(createDefaultState(), todosActions, {
    todos: [originalTodo(), { id: 'task-b', date: today(), text: '背单词', done: false, order: 1 }],
    todayKey: today(),
    todayRecords: [],
    todayPomodoro: { count: 0, minutes: 0 },
    todayMinutes: 0,
    minutesByDate: {},
    subjectMap: {},
    level: { name: '启程' },
    save() {
      state.saves++
    },
    addPoints(...args) {
      state.awards.push(args)
    },
    revokePointsByRef(...args) {
      state.revokes.push(args)
    }
  })
  Object.defineProperty(store, 'todayTodos', {
    get() {
      return this.todos.filter((todo) => todo.date === today()).sort((a, b) => a.order - b.order)
    }
  })
  state.store = reactive(store)
})
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount()
  setOutboxUser(null)
})

test('deleting a completed task waits for confirmation; cancellation preserves task, points and sync queue', async () => {
  const page = await mount(),
    state = globalThis.__todoFeedback
  let resolveConfirm
  const confirmation = new Promise((resolve) => {
    resolveConfirm = resolve
  })
  state.confirm = (message, options) => {
    assert.match(message, /删除任务「复习极限」/)
    assert.equal(options.danger, true)
    return confirmation
  }
  const pending = page.action('删除任务：复习极限').props.onClick({})
  await nextTick()
  assert.deepEqual({ ...state.store.todos[0] }, originalTodo())
  assert.equal(takeForFlush(), null)
  assert.equal(state.revokes.length, 0)
  resolveConfirm(false)
  await pending
  assert.equal(state.store.todos.length, 2)
  assert.equal(state.saves, 0)
  assert.equal(state.revokes.length, 0)
  state.confirm = async () => true
  await click(page.action('删除任务：复习极限'))
  assert.equal(
    state.store.todos.some((todo) => todo.id === 'task-a'),
    false
  )
  assert.deepEqual(state.revokes, [['task-a', true]])
  assert.ok(takeForFlush().deletes.todos['task-a'])
  assert.equal(state.toasts.at(-1), '任务已删除')
})

test('explicit task editing saves a trimmed title and syncs without changing completion, reminders or order', async () => {
  const page = await mount(),
    state = globalThis.__todoFeedback
  const edit = page.action('编辑任务：复习极限')
  assert.ok(edit)
  assert.equal(edit.props.title, '编辑任务')
  assert.equal(
    find(page.root, (element) => element.tag === 'label' && text(element) === '复习极限').props.for,
    'todo-task-a'
  )
  await click(edit)
  assert.ok(page.dialog())
  assert.equal(page.input().value, '复习极限')
  assert.ok('data-autofocus' in page.input().props)
  assert.equal(page.button('保存').props.form, 'todo-title-form')
  await type(page.input(), '  重做极限错题 5 道  ')
  await page.submit()
  assert.equal(page.dialog(), null)
  const changed = { ...state.store.todos.find((todo) => todo.id === 'task-a') }
  assert.equal(changed.text, '重做极限错题 5 道')
  delete changed.text
  delete changed.updatedAt
  const original = originalTodo()
  delete original.text
  delete original.updatedAt
  assert.deepEqual(changed, original)
  const queued = takeForFlush().upserts.todos['task-a'].value
  assert.equal(queued.text, '重做极限错题 5 道')
  assert.equal(queued.completedAt, 100)
  assert.equal(queued.dueNotifiedAt, 310)
  assert.equal(state.awards.length, 0)
  assert.equal(state.revokes.length, 0)
  assert.equal(state.toasts.at(-1), '任务内容已更新')
})

test('cancelling or closing title editing discards the draft without changing stored data', async () => {
  const page = await mount(),
    state = globalThis.__todoFeedback
  await click(page.action('编辑任务：复习极限'))
  await type(page.input(), '不应保存的草稿')
  await click(page.button('取消'))
  assert.equal(page.dialog(), null)
  assert.deepEqual({ ...state.store.todos[0] }, originalTodo())
  assert.equal(takeForFlush(), null)
  await click(page.action('编辑任务：复习极限'))
  assert.equal(page.input().value, '复习极限')
  await type(page.input(), '关闭时也应丢弃')
  await click(page.action('关闭'))
  assert.equal(state.store.todos[0].text, '复习极限')
  assert.equal(state.saves, 0)
})

test('empty titles stay in the editor with an accessible error and do not stage changes', async () => {
  const page = await mount(),
    state = globalThis.__todoFeedback
  await click(page.action('编辑任务：复习极限'))
  await type(page.input(), '   ')
  await page.submit()
  assert.ok(page.dialog())
  assert.equal(page.error().props.role, 'alert')
  assert.equal(text(page.error()).trim(), '请填写任务内容')
  assert.equal(page.input().props['aria-invalid'], true)
  assert.equal(page.input().props['aria-describedby'], 'todo-title-error')
  assert.equal(state.saves, 0)
  assert.equal(takeForFlush(), null)
  assert.equal(state.store.todos[0].text, '复习极限')
  await type(page.input(), '补充有效任务')
  assert.equal(page.input().props['aria-invalid'], false)
  assert.equal(text(page.error()).trim(), '')
  await page.submit()
  assert.equal(state.store.todos[0].text, '补充有效任务')
})

test('store rejects empty add/edit titles before mutations and does not rewrite an unchanged title', () => {
  const state = globalThis.__todoFeedback,
    store = state.store
  assert.throws(() => store.updateTodo('task-a', ' \n\t '), /请填写任务内容/)
  assert.throws(() => store.addTodo('   '), /请填写任务内容/)
  assert.equal(store.todos.length, 2)
  assert.equal(takeForFlush(), null)
  store.updateTodo('task-a', ' 复习极限 ')
  assert.equal(state.saves, 0)
  store.addTodo('  整理笔记  ', { startAt: 400, dueAt: 500 })
  const added = store.todos.at(-1)
  assert.equal(added.text, '整理笔记')
  assert.equal(added.startAt, 400)
  assert.equal(added.dueAt, 500)
  assert.equal(added.done, false)
  assert.equal(takeForFlush().upserts.todos[added.id].value.text, '整理笔记')
})
