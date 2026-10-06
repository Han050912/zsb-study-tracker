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
  const rendered = [],
    removed = [],
    resets = []
  const api = {
    // The real API rejects ready() whenever its script was async/defer, even after onload.
    ready() {
      throw new Error('[Cloudflare Turnstile] Remove async/defer before using ready(). (3857)')
    },
    render: (container, options) => {
      rendered.push({ container, options })
      return `widget-${rendered.length}`
    },
    reset: (id) => resets.push(id),
    remove: (id) => removed.push(id)
  }
  return { api, rendered, removed, resets }
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

test('async SDK renders after script onload without calling unsupported ready, and a fresh mount recovers errors', async () => {
  const cloud = sdk()
  const page = mount()
  await settle()
  assert.equal(cloud.rendered.length, 0)
  assert.equal(scripts[0].async, true)
  window.turnstile = cloud.api
  scripts[0].onload()
  await settle()
  const options = cloud.rendered[0].options
  assert.equal(options.retry, 'never')
  assert.equal(options['refresh-expired'], 'auto')
  assert.equal(options['refresh-timeout'], 'manual')
  options.callback('first')
  await nextTick()
  assert.equal(page.token.value, 'first')
  options['expired-callback']()
  await nextTick()
  assert.equal(page.token.value, '')
  cloud.api.reset = () => options.callback('synchronous-fresh-token')
  page.reset()
  await nextTick()
  assert.equal(page.token.value, 'synchronous-fresh-token', 'reset must not erase a replacement token')
  assert.equal(options['error-callback']('200500'), true)
  await nextTick()
  assert.equal(page.token.value, '')
  assert.equal(page.errors.length, 1)
  options.callback('late-recovery')
  await nextTick()
  assert.equal(page.token.value, '', 'failed widgets cannot silently resume')
  assert.equal(page.instance.setupState.status, 'error')
  page.app.unmount()

  // The login retry action increments its key: a fresh widget can recover without reloading the page.
  const retry = mount()
  await settle()
  assert.equal(scripts.length, 1, 'a complete SDK is reused on remount')
  assert.equal(cloud.rendered.length, 2)
  const retryOptions = cloud.rendered[1].options
  retryOptions.callback('recovered')
  await nextTick()
  assert.equal(retry.token.value, 'recovered')
  assert.equal(retry.instance.setupState.status, 'ready')
  assert.equal(retry.errors.length, 0)
  retry.app.unmount()
  retryOptions.callback('after-unmount')
  retryOptions['error-callback']('200500')
  await nextTick()
  assert.equal(retry.token.value, 'recovered')
  assert.equal(retry.errors.length, 0)
  assert.deepEqual(cloud.removed, ['widget-1', 'widget-2'])
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
  assert.equal(cloud.rendered.length, 1)
  assert.equal(next.errors.length, 0)
})

test('script onload with an incomplete API retries and a thrown render gives recoverable feedback', async () => {
  const cloud = sdk()
  const page = mount()
  await settle()
  window.turnstile = { render: cloud.api.render }
  scripts[0].onload()
  await settle()
  assert.equal(cloud.rendered.length, 0, 'partial globals are not usable SDKs')
  assert.equal(scripts[0].removed, true)
  fireTimer(2000)
  await settle()
  assert.equal(scripts.length, 2)
  window.turnstile = cloud.api
  scripts[1].onload()
  await settle()
  assert.equal(cloud.rendered.length, 1)
  assert.equal(page.errors.length, 0)
  page.app.unmount()
  cloud.api.render = () => {
    throw new Error('SDK initialization failed')
  }
  const next = mount()
  await settle()
  assert.equal(next.errors.length, 1)
  assert.equal(next.token.value, '')
})

test('unmounting before SDK onload ignores late success and removes no nonexistent widget', async () => {
  const cloud = sdk()
  const page = mount()
  await settle()
  page.app.unmount()
  window.turnstile = cloud.api
  scripts[0].onload()
  await settle()
  assert.equal(cloud.rendered.length, 0)
  assert.equal(page.errors.length, 0)
  assert.deepEqual(cloud.removed, [])
})

test('synchronous render callbacks retain success and cleanup failures cannot suppress error recovery', async () => {
  const cloud = sdk()
  window.turnstile = cloud.api
  cloud.api.render = (_container, options) => {
    options.callback('synchronous-render-token')
    return 'sync-success'
  }
  const first = mount()
  await settle()
  assert.equal(first.token.value, 'synchronous-render-token')
  assert.equal(first.instance.setupState.status, 'ready')
  first.app.unmount()

  let removals = 0,
    cleared = 0,
    failedOptions
  cloud.api.remove = () => {
    removals++
    throw new Error('SDK cleanup unavailable')
  }
  cloud.api.render = (_container, options) => {
    failedOptions = options
    options['error-callback']('200500')
    return 'sync-failure'
  }
  const next = mount()
  next.instance.setupState.container = {
    replaceChildren() {
      cleared++
    }
  }
  await settle()
  assert.equal(next.errors.length, 1)
  assert.equal(next.instance.setupState.status, 'error')
  assert.equal(removals, 1)
  assert.equal(cleared, 1)
  failedOptions.callback('late-token')
  await nextTick()
  assert.equal(next.token.value, '')
  next.app.unmount()
  assert.equal(removals, 1, 'failed SDK removal must not be attempted again on unmount')
})

test('a timed out script detaches handlers and its late events cannot settle the shared retry', async () => {
  const page = mount()
  await settle()
  const staleLoad = scripts[0].onload,
    staleError = scripts[0].onerror
  fireTimer(10000)
  await settle()
  assert.equal(scripts[0].onload, null)
  assert.equal(scripts[0].onerror, null)
  assert.equal(scripts[0].removed, true)
  fireTimer(2000)
  await settle()
  const cloud = sdk()
  window.turnstile = cloud.api
  staleLoad()
  staleError()
  await settle()
  assert.equal(cloud.rendered.length, 0, 'the current attempt still needs its own onload')
  assert.equal(page.errors.length, 0)
  scripts[1].onload()
  await settle()
  assert.equal(cloud.rendered.length, 1)
  assert.equal(page.errors.length, 0)
})
