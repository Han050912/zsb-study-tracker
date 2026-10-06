import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdir, writeFile, unlink } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const settle = () => new Promise((resolve) => setImmediate(resolve))
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
async function imageFixture(t) {
  const responses = [],
    created = [],
    revoked = []
  let calls = 0
  globalThis.__imageFetch = async () => {
    calls++
    const response = responses.shift()
    return { ok: true, blob: () => response.promise }
  }
  const originalCreate = URL.createObjectURL,
    originalRevoke = URL.revokeObjectURL
  URL.createObjectURL = (blob) => {
    created.push(blob)
    return `blob:fixture-${created.length}`
  }
  URL.revokeObjectURL = (url) => revoked.push(url)
  t.after(() => {
    URL.createObjectURL = originalCreate
    URL.revokeObjectURL = originalRevoke
  })
  const built = await build({
    stdin: { contents: `export * from './src/api/errorImages';`, resolveDir: process.cwd() },
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    define: { __DESKTOP_BUILD__: 'false' },
    plugins: [
      {
        name: 'image-fetch-boundary',
        setup(b) {
          b.onResolve({ filter: /^\.\/client$/ }, () => ({ path: 'client', namespace: 'mock' }))
          b.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({
            contents: `export const authFetch=(...a)=>globalThis.__imageFetch(...a);
              export class ApiError extends Error { constructor(message,status){super(message);this.status=status} }`
          }))
        }
      }
    ]
  })
  await mkdir('.cache/error-image-cache', { recursive: true })
  const filename = `${process.cwd()}/.cache/error-image-cache/${crypto.randomUUID()}.mjs`
  await writeFile(filename, built.outputFiles[0].text)
  const api = await import(pathToFileURL(filename).href)
  await unlink(filename)
  t.after(() => api.clearErrorImageCache())
  return { api, responses, created, revoked, calls: () => calls }
}

test('切号后迟到的旧错题 blob 不回填缓存，也不会覆盖或移除新账号的在途请求', async (t) => {
  const fixture = await imageFixture(t)
  const oldBody = deferred(),
    newBody = deferred()
  fixture.responses.push(oldBody, newBody)
  const old = fixture.api.resolveErrorImageUrl('r2:same')
  await settle()
  fixture.api.clearErrorImageCache()
  const current = fixture.api.resolveErrorImageUrl('r2:same')
  await settle()
  oldBody.resolve(new Blob(['旧账号图片']))
  await assert.rejects(old, /登录状态已改变/)
  assert.equal(fixture.created.length, 0)
  const repeat = fixture.api.resolveErrorImageUrl('r2:same')
  await settle()
  assert.equal(fixture.calls(), 2)
  const newBlob = new Blob(['新账号图片'])
  newBody.resolve(newBlob)
  assert.equal(await current, 'blob:fixture-1')
  assert.equal(await repeat, 'blob:fixture-1')
  assert.equal(await fixture.api.resolveErrorImageUrl('r2:same'), 'blob:fixture-1')
  assert.equal(fixture.created[0], newBlob)
})

test('清理已创建对象URL并拒绝旧请求失败，保留新账号请求去重', async (t) => {
  const fixture = await imageFixture(t)
  const first = deferred()
  first.resolve(new Blob(['已缓存']))
  fixture.responses.push(first)
  assert.equal(await fixture.api.resolveErrorImageUrl('r2:cached'), 'blob:fixture-1')
  fixture.api.clearErrorImageCache()
  assert.deepEqual(fixture.revoked, ['blob:fixture-1'])
  const oldBody = deferred(),
    newBody = deferred()
  fixture.responses.push(oldBody, newBody)
  const old = fixture.api.resolveErrorImageUrl('r2:same')
  await settle()
  fixture.api.clearErrorImageCache()
  const current = fixture.api.resolveErrorImageUrl('r2:same')
  await settle()
  oldBody.reject(new TypeError('旧下载失败'))
  await assert.rejects(old)
  const repeat = fixture.api.resolveErrorImageUrl('r2:same')
  await settle()
  assert.equal(fixture.calls(), 3)
  newBody.resolve(new Blob(['新下载']))
  assert.equal(await current, await repeat)
})
