import test, { after, afterEach, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { compileScript, parse } from '@vue/compiler-sfc'
import { createRenderer, h, nextTick, ref } from 'vue'

const source = await readFile('src/components/TurnstileWidget.vue', 'utf8')
const script = compileScript(parse(source, { filename: 'TurnstileWidget.vue' }).descriptor, {
  id: 'turnstile-lifecycle',
  genDefaultAs: 'Widget'
})
await mkdir('.cache/turnstile-widget-tests', { recursive: true })
const file = resolve('.cache/turnstile-widget-tests', `${crypto.randomUUID()}.mjs`)
const compiled = await build({
  stdin: {
    contents: `${script.content}\nWidget.render = () => null; export default Widget;`,
    resolveDir: process.cwd(),
    loader: 'ts'
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  external: ['vue'],
  define: { 'import.meta.env.DEV': 'true' }
})
await writeFile(file, compiled.outputFiles[0].text)
const { default: Widget } = await import(pathToFileURL(file).href)
after(() => unlink(file))

const renderer = createRenderer({
  createComment: () => ({ parent: null }),
  insert(element, parent) {
    element.parent = parent
  },
  remove(element) {
    element.parent = null
  },
  parentNode: (element) => element.parent,
  nextSibling: () => null
})
const apps = []
const nativeSetTimeout = globalThis.setTimeout
const nativeClearTimeout = globalThis.clearTimeout
let timers, scripts, nextTimer
beforeEach(() => {
  timers = new Map()
  scripts = []
  nextTimer = 0
  globalThis.setTimeout = (callback, delay) => {
    const id = ++nextTimer
    timers.set(id, { callback, delay })
    return id
  }
  globalThis.clearTimeout = (id) => timers.delete(id)
  globalThis.window = {}
  globalThis.document = {
    createElement(tag) {
      assert.equal(tag, 'script')
      return {
        removed: false,
        remove() {
          this.removed = true
        }
      }
    },
    head: {
      appendChild(script) {
        scripts.push(script)
      }
    }
  }
})
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount()
  globalThis.setTimeout = nativeSetTimeout
  globalThis.clearTimeout = nativeClearTimeout
})
async function settle() {
  await new Promise((done) => setImmediate(done))
  await nextTick()
}
function fireTimer(delay) {
  const entry = [...timers.entries()].find(([, timer]) => timer.delay === delay)
  assert.ok(entry, `timer ${delay} exists`)
  timers.delete(entry[0])
  entry[1].callback()
}
function sdk() {
  const ready = [],
    rendered = [],
    removed = [],
    resets = []
  const api = {
    ready: (callback) => ready.push(callback),
    render: (container, options) => {
      rendered.push({ container, options })
      return `widget-${rendered.length}`
    },
    reset: (id) => resets.push(id),
    remove: (id) => removed.push(id)
  }
  return { api, ready, rendered, removed, resets }
}
function mount() {
  const token = ref(''),
    errors = []
  const app = renderer.createApp({
    render: () =>
      h(Widget, {
        token: token.value,
        'onUpdate:token': (value) => {
          token.value = value
        },
        onLoadError: () => errors.push('error')
      })
  })
  apps.push(app)
  app.mount({})
  const instance = app._instance.subTree.component
  instance.setupState.container = { id: 'container' }
  return { app, token, errors, instance, reset: () => instance.exposed.reset() }
}

test('render waits for SDK readiness and recovers token state after errors, expiration and reset', async () => {
  const cloud = sdk()
  window.turnstile = cloud.api
  const page = mount()
  await settle()
  assert.equal(cloud.rendered.length, 0)
  cloud.ready.shift()()
  await settle()
  const options = cloud.rendered[0].options
  assert.equal(options.retry, 'auto')
  assert.equal(options['refresh-expired'], 'auto')
  assert.equal(options['refresh-timeout'], 'auto')
  options.callback('first')
  await nextTick()
  assert.equal(page.token.value, 'first')
  assert.equal(options['error-callback'](), false)
  await nextTick()
  assert.equal(page.token.value, '')
  assert.equal(page.errors.length, 1)
  options.callback('recovered')
  await nextTick()
  assert.equal(page.token.value, 'recovered')
  assert.equal(page.instance.setupState.status, 'ready')
  options['expired-callback']()
  await nextTick()
  assert.equal(page.token.value, '')
  options.callback('before-timeout')
  await nextTick()
  options['timeout-callback']()
  await nextTick()
  assert.equal(page.token.value, '')
  cloud.api.reset = () => options.callback('synchronous-fresh-token')
  page.reset()
  await nextTick()
  assert.equal(page.token.value, 'synchronous-fresh-token', 'reset must not erase a replacement token')
  page.app.unmount()
  const errorCount = page.errors.length
  options.callback('late')
  options['error-callback']()
  await nextTick()
  assert.equal(page.token.value, 'synchronous-fresh-token')
  assert.equal(page.errors.length, errorCount)
  assert.deepEqual(cloud.removed, ['widget-1'])
})

test('concurrent mounts share SDK load retries and an unmounted widget never renders', async () => {
  const first = mount(),
    second = mount()
  await settle()
  assert.equal(scripts.length, 1)
  scripts[0].onerror()
  await settle()
  assert.equal(scripts[0].removed, true)
  fireTimer(2000)
  await settle()
  assert.equal(scripts.length, 2)
  first.app.unmount()
  const cloud = sdk()
  window.turnstile = cloud.api
  scripts[1].onload()
  await settle()
  assert.equal(cloud.ready.length, 1)
  cloud.ready.shift()()
  await settle()
  assert.equal(cloud.rendered.length, 1)
  assert.equal(first.errors.length, 0)
  assert.equal(second.errors.length, 0)
})

test('SDK load exhausts bounded retries, reports failure once and permits a fresh mount retry', async () => {
  const page = mount()
  await settle()
  scripts[0].onerror()
  await settle()
  fireTimer(2000)
  await settle()
  scripts[1].onerror()
  await settle()
  fireTimer(4000)
  await settle()
  scripts[2].onerror()
  await settle()
  assert.equal(scripts.length, 3)
  assert.equal(page.errors.length, 1)
  assert.equal(page.instance.setupState.status, 'error')
  assert.equal(page.token.value, '')
  page.app.unmount()
  const next = mount()
  await settle()
  assert.equal(scripts.length, 4)
  const cloud = sdk()
  window.turnstile = cloud.api
  scripts[3].onload()
  await settle()
  cloud.ready.shift()()
  await settle()
  assert.equal(cloud.rendered.length, 1)
  assert.equal(next.errors.length, 0)
})

test('a stuck ready callback or thrown render gives recoverable feedback without late widget creation', async () => {
  const cloud = sdk()
  window.turnstile = cloud.api
  const page = mount()
  await settle()
  fireTimer(10000)
  await settle()
  assert.equal(page.errors.length, 1)
  cloud.ready.shift()()
  await settle()
  assert.equal(cloud.rendered.length, 0)
  page.app.unmount()
  cloud.api.render = () => {
    throw new Error('SDK initialization failed')
  }
  const next = mount()
  await settle()
  cloud.ready.shift()()
  await settle()
  assert.equal(next.errors.length, 1)
  assert.equal(next.token.value, '')
})

test('unmounting while SDK readiness is pending ignores late success and removes no nonexistent widget', async () => {
  const cloud = sdk()
  window.turnstile = cloud.api
  const page = mount()
  await settle()
  page.app.unmount()
  cloud.ready.shift()()
  await settle()
  assert.equal(cloud.rendered.length, 0)
  assert.equal(page.errors.length, 0)
  assert.deepEqual(cloud.removed, [])
})
