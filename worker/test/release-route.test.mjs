import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const workerRoot = path.join(process.cwd(), 'worker')
const compiled = await build({
  stdin: {
    contents: `import { registerReleaseRoutes } from './src/api/release'; registerReleaseRoutes();`,
    resolveDir: workerRoot,
    sourcefile: 'release-route-fixture.ts'
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  plugins: [
    {
      name: 'release-route-boundaries',
      setup(builder) {
        builder.onResolve({ filter: /[\\/]router$/ }, () => ({ path: 'router', namespace: 'release-mock' }))
        builder.onLoad({ filter: /^router$/, namespace: 'release-mock' }, () => ({
          contents: `export const on = (...args) => { globalThis.__releaseRoute = args }`,
          loader: 'js'
        }))
        builder.onResolve({ filter: /^\.\/github$/ }, () => ({ path: 'github', namespace: 'release-mock' }))
        builder.onLoad({ filter: /^github$/, namespace: 'release-mock' }, () => ({
          contents: `export const githubFetch = (...args) => globalThis.__releaseGithubFetch(...args)`,
          loader: 'js'
        }))
      }
    }
  ]
})

await mkdir(path.join(process.cwd(), '.cache', 'release-route-tests'), { recursive: true })
const fixture = path.join(process.cwd(), '.cache', 'release-route-tests', `release-${crypto.randomUUID()}.mjs`)
await writeFile(fixture, compiled.outputFiles[0].text)
await import(pathToFileURL(fixture).href)
await unlink(fixture)

const [, routePath, requiresAuth, handler] = globalThis.__releaseRoute
assert.equal(routePath, '/api/latest-release')
assert.equal(requiresAuth, false)

const request = (version = '') =>
  new Request(`https://worker.test/api/latest-release${version ? `?version=${encodeURIComponent(version)}` : ''}`)
const env = () => ({ GITHUB_TOKEN: 'test', RL_30: { limit: async () => ({ success: true }) } })

test('release route rejects malformed version filters before calling GitHub', async () => {
  let calls = 0
  globalThis.__releaseGithubFetch = async () => {
    calls++
    throw new Error('must not call GitHub')
  }

  const response = await handler({
    request: request('2.0'),
    env: env(),
    userId: '',
    role: '',
    params: {}
  })
  assert.equal(response.status, 400)
  assert.deepEqual(await response.json(), { success: false })
  assert.equal(calls, 0)
})

test('versioned release lookup uses a tag path and caches by release version', async () => {
  const calls = []
  globalThis.__releaseGithubFetch = async (_env, endpoint) => {
    calls.push(endpoint)
    return {
      ok: true,
      status: 200,
      rateLimited: false,
      tokenMissing: false,
      data: { tag_name: 'v2.0.4', body: '# Fixes', published_at: '2026-10-06T00:00:00Z' }
    }
  }

  const first = await handler({
    request: request('v2.0.4'),
    env: env(),
    userId: '',
    role: '',
    params: {}
  })
  const second = await handler({
    request: request('2.0.4'),
    env: env(),
    userId: '',
    role: '',
    params: {}
  })
  assert.equal(first.status, 200)
  assert.equal((await first.json()).data.body, '# Fixes')
  assert.equal(second.status, 200)
  assert.equal(calls.length, 1)
  assert.equal(calls[0], '/repos/Han050912/zsb-study-tracker/releases/tags/v2.0.4')
})

test('empty release bodies are returned but never cached', async () => {
  let calls = 0
  globalThis.__releaseGithubFetch = async () => {
    calls++
    return {
      ok: true,
      status: 200,
      rateLimited: false,
      tokenMissing: false,
      data: { tag_name: 'v2.0.5', body: '' }
    }
  }

  await handler({ request: request('2.0.5'), env: env(), userId: '', role: '', params: {} })
  await handler({ request: request('2.0.5'), env: env(), userId: '', role: '', params: {} })
  assert.equal(calls, 2)
})

test('unfiltered lookup requests the latest release endpoint', async () => {
  let endpoint = ''
  globalThis.__releaseGithubFetch = async (_env, value) => {
    endpoint = value
    return { ok: true, status: 200, rateLimited: false, tokenMissing: false, data: { body: '# Latest' } }
  }

  const response = await handler({
    request: request(),
    env: env(),
    userId: '',
    role: '',
    params: {}
  })
  assert.equal(response.status, 200)
  assert.equal(endpoint, '/repos/Han050912/zsb-study-tracker/releases/latest')
})
