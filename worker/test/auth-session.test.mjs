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
async function authFixture(t) {
  const local = new Map(),
    session = new Map()
  const storage = (data) => ({
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
    removeItem: (key) => data.delete(key)
  })
  globalThis.localStorage = storage(local)
  globalThis.sessionStorage = storage(session)
  globalThis.window = Object.assign(new EventTarget(), { location: { hash: '#/login' } })
  let cookie = '',
    credentialsCalls = 0,
    logoutCalls = 0
  const logoutResponse = deferred()
  t.after(() => logoutResponse.resolve())
  globalThis.fetch = async (url) => {
    if (url.endsWith('/api/auth/logout')) {
      logoutCalls++
      await logoutResponse.promise
      // 模拟浏览器在 Promise 回到 authFetch 之前应用 Set-Cookie。
      cookie = ''
      return Response.json({ ok: true }, { headers: { 'Set-Cookie': 'session=; Max-Age=0' } })
    }
    if (url.endsWith('/api/auth/login') || url.endsWith('/api/auth/register')) {
      credentialsCalls++
      cookie = `session-${credentialsCalls}`
      return Response.json(
        { user: { id: `u-${credentialsCalls}`, username: '用户', role: 'user', createdAt: 1 } },
        {
          headers: { 'Set-Cookie': `session=${cookie}` }
        }
      )
    }
    throw new Error(`Unexpected URL: ${url}`)
  }
  const built = await build({
    stdin: { contents: `export * from './src/services/auth';`, resolveDir: process.cwd() },
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    external: ['vue'],
    define: { __DESKTOP_BUILD__: 'false', 'import.meta.env.VITE_API_BASE': '"https://auth.local.invalid"' }
  })
  await mkdir('.cache/auth-session', { recursive: true })
  const filename = `${process.cwd()}/.cache/auth-session/${crypto.randomUUID()}.mjs`
  await writeFile(filename, built.outputFiles[0].text)
  const auth = await import(pathToFileURL(filename).href)
  await unlink(filename)
  return { auth, logoutResponse, cookie: () => cookie, calls: () => ({ credentialsCalls, logoutCalls }) }
}

test('在途退出的迟到 Set-Cookie 不会清除刚建立的新登录会话', async (t) => {
  const fixture = await authFixture(t)
  await fixture.auth.login('原账号', 'abc12345')
  assert.equal(fixture.auth.logout(), undefined)
  assert.equal(fixture.auth.isLoggedIn.value, false)
  await settle()
  const login = fixture.auth.login('新账号', 'abc12345')
  await settle()
  fixture.logoutResponse.resolve()
  await login
  await settle()
  assert.equal(fixture.cookie(), 'session-2')
  assert.equal(fixture.auth.sessionUser.value.id, 'u-2')
})

test('注册等待在途退出收尾，重复退出只发送一次远程请求', async (t) => {
  const fixture = await authFixture(t)
  fixture.auth.logout()
  fixture.auth.logout()
  await settle()
  const registration = fixture.auth.register('新用户', 'abc12345')
  await settle()
  assert.equal(fixture.calls().credentialsCalls, 0)
  assert.equal(fixture.calls().logoutCalls, 1)
  fixture.logoutResponse.resolve()
  await registration
  assert.equal(fixture.cookie(), 'session-1')
})

test('退出网络失败仍清本地会话，失败收尾后允许再次登录', async (t) => {
  const fixture = await authFixture(t)
  await fixture.auth.login('用户', 'abc12345')
  fixture.auth.logout()
  await settle()
  const login = fixture.auth.login('新用户', 'abc12345')
  fixture.logoutResponse.reject(new TypeError('网络连接失败'))
  await login
  assert.equal(fixture.auth.isLoggedIn.value, true)
  assert.equal(fixture.cookie(), 'session-2')
})
