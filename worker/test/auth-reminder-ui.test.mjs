import test, { after, afterEach, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import { createRenderer, nextTick, reactive } from 'vue'

const built = await build({
  stdin: {
    contents: `export { default as TurnstileWidget } from './src/components/TurnstileWidget.vue';
    export { default as SettingsAppearance } from './src/components/settings/SettingsAppearance.vue';`,
    resolveDir: process.cwd()
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  external: ['vue'],
  define: { 'import.meta.env.DEV': 'false' },
  plugins: [
    {
      name: 'ui-boundaries',
      setup(builder) {
        builder.onResolve({ filter: /(?:stores\/app|composables\/useToast|services\/notify)$/ }, ({ path }) => ({
          path,
          namespace: 'boundary'
        }))
        builder.onLoad({ filter: /.*/, namespace: 'boundary' }, ({ path }) => ({
          contents: path.endsWith('/app')
            ? 'export const useAppStore = () => globalThis.__reminderUi.store;'
            : path.endsWith('/useToast')
              ? 'export const useToast = () => message => globalThis.__reminderUi.toasts.push(message);'
              : `export const isDesktopNotify = () => false;
              export const notifyPermission = () => globalThis.__reminderUi.permission;
              export const requestNotifyPermission = () => globalThis.__reminderUi.requestPermission();`
        }))
        builder.onResolve({ filter: /\.vue$/ }, ({ path }) => ({ path: resolve(path), namespace: 'sfc' }))
        builder.onLoad({ filter: /.*/, namespace: 'sfc' }, async ({ path }) => {
          const descriptor = parse(await readFile(path, 'utf8'), { filename: path }).descriptor
          const script = compileScript(descriptor, { id: 'resilience-ui', genDefaultAs: 'Component' })
          const template = compileTemplate({
            source: descriptor.template.content,
            filename: path,
            id: 'resilience-ui',
            compilerOptions: { bindingMetadata: script.bindings }
          })
          assert.deepEqual(template.errors, [])
          return {
            contents: `${script.content}\n${template.code}\nComponent.render = render; export default Component;`,
            loader: 'ts',
            resolveDir: resolve(path, '..')
          }
        })
      }
    }
  ]
})
await mkdir('.cache/resilience-ui', { recursive: true })
const filename = resolve(`.cache/resilience-ui/${crypto.randomUUID()}.mjs`)
await writeFile(filename, built.outputFiles[0].text)
const { TurnstileWidget, SettingsAppearance } = await import(pathToFileURL(filename).href)
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
  patchProp: (element, key, _before, value) => {
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
const text = (element) => element.text + element.children.map(text).join('')
function find(element, predicate) {
  if (predicate(element)) return element
  for (const child of element.children) {
    const match = find(child, predicate)
    if (match) return match
  }
  return null
}
const apps = []
function mount(component, props = {}) {
  const root = node('root'),
    app = renderer.createApp(component, props)
  apps.push(app)
  return { root, app, instance: app.mount(root) }
}
async function settle() {
  await new Promise((done) => setImmediate(done))
  await nextTick()
}
let options, removed, scripts
beforeEach(() => {
  options = null
  removed = []
  scripts = []
  globalThis.window = {
    Notification: {},
    turnstile: {
      ready: (callback) => callback(),
      render: (_container, value) => {
        options = value
        return 'widget-1'
      },
      reset() {},
      remove: (id) => removed.push(id)
    }
  }
  globalThis.document = {
    createElement: () => ({ remove() {} }),
    head: { appendChild: (script) => scripts.push(script) },
    documentElement: { classList: { toggle() {} } }
  }
  const settings = reactive({
    theme: 'light',
    reminderEnabled: false,
    reminderTime: '08:00',
    dndMutedTypes: [],
    profileVisibility: 'login',
    shareLearningStats: false,
    partnerRemindEnabled: true
  })
  globalThis.__reminderUi = {
    permission: 'denied',
    toasts: [],
    updates: [],
    requestPermission: async () => 'denied',
    store: {
      settings,
      updateSettings(patch) {
        Object.assign(settings, patch)
        globalThis.__reminderUi.updates.push(patch)
      }
    }
  }
})
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount()
})

test('Turnstile 无 iframe 回调时验证有期限，清除旧 token 并移除挑战', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const errors = [],
    tokens = []
  const page = mount(TurnstileWidget, {
    token: 'old',
    onLoadError: (message) => errors.push(message),
    'onUpdate:token': (token) => tokens.push(token)
  })
  await settle()
  assert.match(text(page.root), /正在验证/)
  assert.equal(options.retry, 'never')
  t.mock.timers.tick(30_000)
  await nextTick()
  assert.match(errors[0], /超时/)
  assert.equal(tokens.at(-1), '')
  assert.deepEqual(removed, ['widget-1'])
  options.callback('late-token')
  assert.equal(tokens.at(-1), '', '迟到成功不能恢复已取消的挑战')
})

test('成功验证清理计时器，过期重新等待，reset 与卸载清理验证资源', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const errors = [],
    tokens = []
  const page = mount(TurnstileWidget, {
    onLoadError: (message) => errors.push(message),
    'onUpdate:token': (token) => tokens.push(token)
  })
  await settle()
  options.callback('first-token')
  t.mock.timers.tick(60_000)
  assert.deepEqual(errors, [])
  options['expired-callback']()
  assert.equal(tokens.at(-1), '')
  options.callback('fresh-token')
  page.instance.reset()
  assert.equal(tokens.at(-1), '')
  page.app.unmount()
  apps.splice(apps.indexOf(page.app), 1)
  options['before-interactive-callback']()
  options['after-interactive-callback']()
  options['expired-callback']()
  options['timeout-callback']()
  t.mock.timers.tick(60_000)
  options.callback('after-unmount')
  assert.deepEqual(errors, [])
  assert.equal(tokens.at(-1), '')
  assert.deepEqual(removed, ['widget-1'])
})

test('SDK 加载失败有限重试；新挂载可以重新加载并验证成功', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const sdk = window.turnstile
  delete window.turnstile
  const errors = []
  mount(TurnstileWidget, { onLoadError: (message) => errors.push(message) })
  await settle()
  for (let attempt = 0; attempt < 3; attempt++) {
    scripts.at(-1).onerror()
    await settle()
    if (attempt < 2) {
      t.mock.timers.tick(2000 * (attempt + 1))
      await settle()
    }
  }
  assert.equal(scripts.length, 3)
  assert.match(errors[0], /未能加载/)
  const tokens = []
  mount(TurnstileWidget, { 'onUpdate:token': (token) => tokens.push(token) })
  await settle()
  window.turnstile = sdk
  scripts.at(-1).onload()
  await settle()
  options.callback('recovered-token')
  assert.equal(tokens.at(-1), 'recovered-token')
})

test('异步 SDK 的 ready 抛出官方 3857 时仍可直接 render 并获取 token', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let readyCalls = 0
  window.turnstile.ready = () => {
    readyCalls++
    throw new Error('Remove async/defer before using ready(). (3857)')
  }
  const errors = [],
    tokens = []
  mount(TurnstileWidget, {
    onLoadError: (message) => errors.push(message),
    'onUpdate:token': (token) => tokens.push(token)
  })
  await settle()
  assert.equal(readyCalls, 0)
  assert.ok(options)
  options.callback('verified-token')
  t.mock.timers.tick(60_000)
  assert.equal(tokens.at(-1), 'verified-token')
  assert.deepEqual(errors, [])
})

test('人工验证期间暂停加载超时，完成交互后恢复检测，SDK 超时只报告一次', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const errors = [],
    tokens = []
  const page = mount(TurnstileWidget, {
    onLoadError: (message) => errors.push(message),
    'onUpdate:token': (token) => tokens.push(token)
  })
  await settle()
  options['before-interactive-callback']()
  t.mock.timers.tick(60_000)
  await nextTick()
  assert.match(text(page.root), /请完成下方的人机验证/)
  assert.deepEqual(errors, [], '用户人工操作不会被 30 秒加载检测中断')
  options['after-interactive-callback']()
  options.callback('after-interaction-token')
  options['after-interactive-callback']()
  t.mock.timers.tick(60_000)
  assert.equal(tokens.at(-1), 'after-interaction-token')
  assert.deepEqual(errors, [], '成功之后迟到的交互结束不能重新启动超时')
  options['expired-callback']()
  options['before-interactive-callback']()
  options['timeout-callback']()
  options['after-interactive-callback']()
  options['timeout-callback']()
  t.mock.timers.tick(60_000)
  assert.equal(tokens.at(-1), '')
  assert.equal(errors.length, 1)
  assert.match(errors[0], /超时/)
  assert.deepEqual(removed, ['widget-1'])
})

test('人工交互完成后尚未取得 token 的挑战仍有超时保护', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const errors = []
  mount(TurnstileWidget, { onLoadError: (message) => errors.push(message) })
  await settle()
  options['before-interactive-callback']()
  t.mock.timers.tick(60_000)
  options['after-interactive-callback']()
  t.mock.timers.tick(30_000)
  assert.equal(errors.length, 1)
  assert.match(errors[0], /超时/)
})

test('每日提醒保存不依赖系统权限，拒绝/未授权/权限接口异常均有应用内提醒', async () => {
  for (const permission of ['denied', 'default', 'error']) {
    globalThis.__reminderUi.requestPermission = async () => {
      if (permission === 'error') throw new TypeError('permissions unavailable')
      return permission
    }
    const page = mount(SettingsAppearance)
    const control = find(page.root, (element) => element.props['aria-label'] === '每日学习提醒')
    const request = control.props.onClick()
    assert.equal(globalThis.__reminderUi.store.settings.reminderEnabled, true, '授权提示完成前已保存偏好')
    await request
    await nextTick()
    assert.equal(control.props['aria-checked'], true)
    assert.match(globalThis.__reminderUi.toasts.at(-1), /应用内提醒/)
    await control.props.onClick()
    await nextTick()
    assert.equal(control.props['aria-checked'], false)
  }
})
