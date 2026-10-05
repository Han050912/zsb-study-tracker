import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdir, writeFile, unlink } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import 'vue-router'
import { deferred, settle } from './refactor-harness.mjs'

const compiled = await build({
  stdin: {
    contents: `export { router } from './src/router'; export { routeLoading, routeLoadError } from './src/router/loading';`,
    resolveDir: process.cwd()
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  external: ['vue'],
  plugins: [
    {
      name: 'router-memory-boundaries',
      setup(b) {
        b.onResolve({ filter: /\.vue$/ }, () => ({ path: 'component', namespace: 'boundary' }))
        b.onResolve({ filter: /services\/auth$/ }, () => ({ path: 'auth', namespace: 'boundary' }))
        b.onResolve({ filter: /^vue-router$/ }, (args) =>
          args.namespace === 'boundary'
            ? { path: args.path, external: true }
            : { path: args.path, namespace: 'boundary' }
        )
        b.onLoad({ filter: /.*/, namespace: 'boundary' }, ({ path }) => ({
          contents:
            path === 'component'
              ? 'export default {render:()=>null};'
              : path === 'auth'
                ? `import {ref} from 'vue'; export const isLoggedIn=ref(true), isAdmin=ref(false), isGuestMode=ref(false);`
                : `export * from 'vue-router'; export {createMemoryHistory as createWebHashHistory} from 'vue-router';`
        }))
      }
    }
  ]
})
async function fixture(t) {
  const storage = new Map()
  let reloads = 0
  globalThis.sessionStorage = {
    getItem: (key) => storage.get(key),
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key)
  }
  globalThis.window = { location: { reload: () => reloads++ } }
  globalThis.document = { title: '' }
  await mkdir('.cache/route-tests', { recursive: true })
  const filename = resolve('.cache/route-tests', `${crypto.randomUUID()}.mjs`)
  await writeFile(filename, compiled.outputFiles[0].text)
  const module = await import(pathToFileURL(filename).href)
  await unlink(filename)
  t.mock.method(console, 'error', () => {})
  const component = { render: () => null }
  module.router.addRoute({ path: '/route-start', component, meta: { title: '起始页' } })
  await module.router.push('/route-start')
  return { ...module, component, storage, reloads: () => reloads }
}

test('取消的旧懒加载路由不清除新导航的加载态，不更新标题或刷新锁', async (t) => {
  const f = await fixture(t),
    a = deferred(),
    b = deferred()
  f.router.addRoute({ path: '/route-a', component: () => a.promise, meta: { title: 'A' } })
  f.router.addRoute({ path: '/route-b', component: () => b.promise, meta: { title: 'B' } })
  const first = f.router.push('/route-a')
  await settle()
  const second = f.router.push('/route-b')
  await settle()
  f.storage.set('route-error-reloaded', '1')
  a.resolve(f.component)
  const canceled = await first
  assert.equal(canceled.type, 8)
  assert.equal(f.routeLoading.value, true)
  assert.equal(f.router.currentRoute.value.path, '/route-start')
  assert.equal(document.title, '起始页 · 专升本学习助手')
  assert.equal(f.storage.get('route-error-reloaded'), '1')
  b.resolve(f.component)
  await second
  assert.equal(f.routeLoading.value, false)
  assert.equal(document.title, 'B · 专升本学习助手')
  assert.equal(f.storage.has('route-error-reloaded'), false)
})

test('旧路由迟到的模块加载异常不覆盖新导航或触发整页刷新', async (t) => {
  const f = await fixture(t),
    a = deferred(),
    b = deferred()
  f.router.addRoute({ path: '/route-a', component: () => a.promise })
  f.router.addRoute({ path: '/route-b', component: () => b.promise })
  const first = f.router.push('/route-a').catch((e) => e)
  await settle()
  const second = f.router.push('/route-b')
  await settle()
  a.reject(new Error('stale module failure'))
  await first
  assert.equal(f.routeLoading.value, true)
  assert.equal(f.routeLoadError.value, '')
  assert.equal(f.reloads(), 0)
  b.resolve(f.component)
  await second
  assert.equal(f.routeLoadError.value, '')
})

test('点击当前路由取消慢导航立即恢复页面，后续迟到异常仍被忽略', async (t) => {
  const f = await fixture(t),
    pending = deferred()
  f.router.addRoute({ path: '/route-a', component: () => pending.promise })
  const slow = f.router.push('/route-a').catch((e) => e)
  await settle()
  assert.equal(f.routeLoading.value, true)
  const duplicate = await f.router.push('/route-start')
  assert.equal(duplicate.type, 16)
  assert.equal(f.routeLoading.value, false)
  pending.reject(new Error('canceled module failure'))
  await slow
  assert.equal(f.routeLoadError.value, '')
  assert.equal(f.reloads(), 0)
})

test('同页面 query 更新保持组件路由，加载失败可显示错误并在新导航后恢复', async (t) => {
  const f = await fixture(t),
    pending = deferred()
  await f.router.push('/route-start?view=favorites')
  assert.equal(f.routeLoading.value, false)
  assert.equal(f.router.currentRoute.value.path, '/route-start')
  f.router.addRoute({ path: '/route-fail', component: () => pending.promise })
  const failed = f.router.push('/route-fail').catch((e) => e)
  await settle()
  pending.reject(new Error('module failure'))
  await failed
  assert.equal(f.routeLoading.value, false)
  assert.match(f.routeLoadError.value, /页面加载失败/)
  assert.equal(f.reloads(), 1)
  // 再次失败仍保留恢复入口，刷新只自动尝试一次。
  const repeat = deferred()
  f.router.addRoute({ path: '/route-fail-again', component: () => repeat.promise })
  const failedAgain = f.router.push('/route-fail-again').catch((e) => e)
  await settle()
  repeat.reject(new Error('second module failure'))
  await failedAgain
  assert.equal(f.reloads(), 1)
  assert.match(f.routeLoadError.value, /页面加载失败/)
  await f.router.push('/route-start?view=all')
  assert.equal(f.routeLoadError.value, '')
  assert.equal(f.routeLoading.value, false)
})
