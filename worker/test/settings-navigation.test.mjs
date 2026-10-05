import test, { after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import { createRenderer, createSSRApp } from 'vue'
import { renderToString } from '@vue/server-renderer'
// Load the real router before adding DOM stubs so navigation uses its Node behavior.
import 'vue-router'

const sections = ['study', 'subjects', 'preferences', 'data']
const source = await readFile('src/pages/Settings.vue', 'utf8')
const nav = source.match(/<nav\b[^>]*class="settings-nav"[\s\S]*?<\/nav>/)?.[0]
assert.ok(nav, 'the settings section navigation exists')
const compiled = compileTemplate({ source: nav, filename: 'SettingsNav.vue', id: 'settings-nav' })
assert.deepEqual(compiled.errors, [])
const script = compileScript(parse(source, { filename: 'Settings.vue' }).descriptor, { id: 'settings' })

globalThis.document = { title: '', getElementById: () => null }
globalThis.sessionStorage = { getItem: () => null, removeItem() {} }
const result = await build({
  stdin: {
    contents: `${compiled.code}\nexport const SettingsNav = { render }; export { router } from './src/router';
      export { isLoggedIn } from './src/services/auth'; export { default as SettingsPage } from './src/pages/Settings.vue';`,
    resolveDir: process.cwd()
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  external: ['vue'],
  plugins: [
    {
      name: 'settings-navigation-boundaries',
      setup(builder) {
        builder.onResolve({ filter: /^vue-router$/ }, ({ namespace }) =>
          namespace === 'boundary'
            ? { path: 'vue-router', external: true }
            : { path: 'vue-router', namespace: 'boundary' }
        )
        builder.onResolve({ filter: /services\/auth$/ }, () => ({ path: 'auth', namespace: 'boundary' }))
        builder.onResolve({ filter: /(?:stores\/app|composables\/useToast|api\/settings)$/ }, ({ path }) => ({
          path: path.split('/').slice(-2).join('/'),
          namespace: 'boundary'
        }))
        builder.onResolve({ filter: /\.vue$/ }, ({ path }) => ({
          path: path.endsWith('/Settings.vue') ? 'settings-page' : 'page',
          namespace: 'boundary'
        }))
        builder.onLoad({ filter: /.*/, namespace: 'boundary' }, ({ path }) => {
          if (path === 'settings-page')
            return { contents: script.content, loader: 'ts', resolveDir: resolve('src/pages') }
          if (path === 'stores/app')
            return { contents: 'export const useAppStore = () => ({ settings: { userName: "tester" } });' }
          if (path === 'composables/useToast') return { contents: 'export const useToast = () => () => {};' }
          if (path === 'api/settings')
            return { contents: 'export const settingsApi = { validate: async data => data };' }
          if (path === 'vue-router')
            return {
              contents: `export * from 'vue-router'; import { createMemoryHistory } from 'vue-router';
                export const createWebHashHistory = () => createMemoryHistory('/#');`
            }
          if (path === 'auth')
            return {
              contents: `export const isLoggedIn = { value: true }, isAdmin = { value: false }, isGuestMode = { value: false };`
            }
          return { contents: 'export default { render: () => null };' }
        })
      }
    }
  ]
})
await mkdir('.cache/settings-navigation-tests', { recursive: true })
const filename = `.cache/settings-navigation-tests/${crypto.randomUUID()}.mjs`
await writeFile(filename, result.outputFiles[0].text)
const { router, SettingsNav, SettingsPage, isLoggedIn } = await import(
  pathToFileURL(`${process.cwd()}/${filename}`).href
)
const scroll = router.options.scrollBehavior
beforeEach(() => {
  isLoggedIn.value = true
  document.getElementById = () => null
  globalThis.getComputedStyle = () => ({ scrollMarginTop: '76px' })
})
after(() => unlink(filename))

test('rendered settings links keep the settings route and address the four sections', async () => {
  await router.push('/settings')
  const html = await renderToString(createSSRApp(SettingsNav).use(router))
  const hrefs = [...html.matchAll(/\bhref="([^"]+)"/g)].map((match) => match[1])
  assert.deepEqual(
    hrefs,
    sections.map((section) => `#/settings#settings-${section}`)
  )
  for (const href of hrefs) {
    await router.push(href.slice(1))
    assert.equal(router.currentRoute.value.name, 'settings')
    assert.equal(router.currentRoute.value.path, '/settings')
    assert.equal(router.currentRoute.value.hash, href.slice(href.lastIndexOf('#')))
    assert.equal(router.currentRoute.value.meta.requiresAuth, true)
  }
})

test('old broken section addresses redirect to settings while unknown addresses remain 404', async () => {
  for (const section of sections) {
    await router.push(`/settings-${section}?source=legacy`)
    assert.equal(router.currentRoute.value.name, 'settings')
    assert.equal(router.currentRoute.value.hash, `#settings-${section}`)
    assert.equal(router.currentRoute.value.query.source, 'legacy')
  }
  await router.push('/settings-unknown')
  assert.equal(router.currentRoute.value.name, 'not-found')
})

test('legacy section addresses still require login', async () => {
  isLoggedIn.value = false
  for (const section of sections) {
    await router.push(`/settings-${section}`)
    assert.equal(router.currentRoute.value.name, 'login')
    assert.equal(router.currentRoute.value.query.redirect, `/settings#settings-${section}`)
  }
})

test('section navigation waits for rendering and applies the fixed header offset', async () => {
  for (const section of sections) {
    const to = router.resolve({ name: 'settings', hash: `#settings-${section}` })
    const element = { id: `settings-${section}` }
    document.getElementById = () => null
    const position = scroll(to, router.resolve('/settings'), null)
    document.getElementById = (id) => (id === element.id ? element : null)
    assert.deepEqual(await position, { el: element, top: 76 })
  }
})

test('deep links scroll immediately when settings mounts after app hydration', async () => {
  // Exercise the actual page setup and mounted hook without rendering its unrelated controls.
  SettingsPage.render = () => null
  const renderer = createRenderer({ createComment: () => ({}), insert() {}, remove() {} })
  for (const section of [...sections, null]) {
    await router.push(section ? `/settings#settings-${section}` : '/settings')
    document.getElementById = () => null
    assert.deepEqual(await scroll(router.currentRoute.value, router.resolve('/settings'), null), {})
    const calls = []
    document.getElementById = (id) => ({ scrollIntoView: () => calls.push(id) })
    const page = renderer.createApp(SettingsPage).use(router)
    page.mount({})
    assert.deepEqual(calls, section ? [`settings-${section}`] : [])
    page.unmount()
  }
})

test('history restoration takes priority and query navigation preserves the current position', async () => {
  const to = router.resolve('/settings#settings-data')
  const from = router.resolve('/settings')
  const saved = { left: 0, top: 420 }
  document.getElementById = () => {
    throw new Error('saved history position must not resolve an anchor')
  }
  assert.deepEqual(await scroll(to, from, saved), saved)
  assert.deepEqual(await scroll(router.resolve('/settings?tab=two'), from, null), {})
  assert.deepEqual(await scroll(from, router.resolve('/account'), null), { left: 0, top: 0 })
})
