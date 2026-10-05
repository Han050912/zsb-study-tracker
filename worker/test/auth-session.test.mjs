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
async function authFixture(t, desktop = false) {
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
  if (desktop) window.desktopAuth = { getToken: async () => 'desktop-fixture' }
  const requests = []
  let cookie = '',
    credentialsCalls = 0,
    logoutCalls = 0
  const logoutResponse = deferred()
  t.after(() => logoutResponse.resolve())
  globalThis.fetch = async (url, options) => {
    requests.push({
      url,
      options,
      body: typeof options.body === 'string' ? JSON.parse(options.body) : (options.body ?? null)
    })
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
        {
          token: `jwt-${credentialsCalls}`,
          user: { id: `u-${credentialsCalls}`, username: '用户', role: 'user', createdAt: 1 }
        },
        {
          headers: { 'Set-Cookie': `session=${cookie}` }
        }
      )
    }
    if (url.endsWith('/api/auth/password')) return Response.json({ ok: true, token: 'password-jwt' })
    throw new Error(`Unexpected URL: ${url}`)
  }
  const built = await build({
    stdin: {
      contents: `export * from './src/services/auth'; export * from './src/utils/session'; export { uploadAvatar } from './src/api/community';`,
      resolveDir: process.cwd()
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    external: ['vue'],
    define: { __DESKTOP_BUILD__: String(desktop), 'import.meta.env.VITE_API_BASE': '"https://auth.local.invalid"' }
  })
  await mkdir('.cache/auth-session', { recursive: true })
  const filename = `${process.cwd()}/.cache/auth-session/${crypto.randomUUID()}.mjs`
  await writeFile(filename, built.outputFiles[0].text)
  const auth = await import(pathToFileURL(filename).href)
  await unlink(filename)
  return {
    auth,
    local,
    session,
    requests,
    logoutResponse,
    cookie: () => cookie,
    calls: () => ({ credentialsCalls, logoutCalls })
  }
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

test('Web 登录将保持登录选择传到服务端，修改密码沿用本次会话策略', async (t) => {
  const fixture = await authFixture(t)
  await fixture.auth.login('用户', 'abc12345', 'verification', false)
  assert.equal(fixture.requests.at(-1).body.remember, false)
  assert.equal(fixture.local.get('auth_keep_login'), '0')
  assert.equal(fixture.local.has('jwt_token'), false)
  await fixture.auth.changePassword('abc12345', 'newpass123', 'fresh-verification')
  assert.equal(fixture.requests.at(-1).body.remember, false)
  assert.equal(fixture.local.has('jwt_token'), false)
})

test('桌面端未勾选保持登录时仅存会话凭据，退出仍用旧凭据吊销服务端会话', async (t) => {
  const fixture = await authFixture(t, true)
  await fixture.auth.login('用户', 'abc12345', '', false)
  assert.equal(fixture.local.has('jwt_token'), false)
  assert.equal(fixture.session.get('jwt_token'), 'jwt-1')
  assert.equal(fixture.auth.getToken(), 'jwt-1')
  fixture.auth.logout()
  await settle()
  assert.equal(fixture.auth.getToken(), null)
  assert.equal(fixture.requests.at(-1).options.headers.Authorization, 'Bearer jwt-1')
  fixture.logoutResponse.resolve()
  await fixture.auth.login('用户', 'abc12345', '', true)
  assert.equal(fixture.local.get('jwt_token'), 'jwt-2')
  assert.equal(fixture.session.has('jwt_token'), false)
})

test('桌面端换发持久 JWT 不发出会导致其它标签页登出的删除事件', async (t) => {
  const fixture = await authFixture(t, true)
  const deleted = []
  t.mock.method(localStorage, 'removeItem', (key) => {
    deleted.push(key)
    fixture.local.delete(key)
  })
  await fixture.auth.login('用户', 'abc12345', '', true)
  await fixture.auth.login('用户', 'abc12345', '', true)
  assert.equal(fixture.auth.getToken(), 'jwt-2')
  assert.equal(deleted.includes('jwt_token'), false)
})

test('其它标签页退出的共享标记事件同时清除本窗口临时 JWT', async (t) => {
  const fixture = await authFixture(t, true)
  await fixture.auth.login('用户', 'abc12345', '', false)
  assert.equal(fixture.session.get('jwt_token'), 'jwt-1')
  fixture.local.delete('auth_logged_in')
  const event = Object.assign(new Event('storage'), { key: 'auth_logged_in', newValue: null })
  window.dispatchEvent(event)
  assert.equal(fixture.session.has('jwt_token'), false)
  assert.equal(fixture.auth.hasActiveSession(), false)
  assert.match(window.location.hash, /^#\/login\?redirect=/)
})

test('桌面退出保留捕获的旧 JWT，排队期间其它窗口的新凭据不能被误吊销', async (t) => {
  const fixture = await authFixture(t, true)
  await fixture.auth.login('用户', 'abc12345', '', true)
  fixture.auth.logout()
  fixture.local.set('jwt_token', 'another-window-new-token')
  await settle()
  assert.equal(fixture.requests.at(-1).options.headers.Authorization, 'Bearer jwt-1')
  fixture.logoutResponse.resolve()
  await settle()
  assert.equal(fixture.local.get('jwt_token'), 'another-window-new-token')
})

test('其它窗口更改保持登录偏好不能将本窗口临时 JWT 升级为持久凭据', async (t) => {
  const fixture = await authFixture(t, true)
  await fixture.auth.login('用户', 'abc12345', '', false)
  fixture.local.set('auth_keep_login', '1')
  assert.equal(fixture.auth.keepsSession(), false)
  await fixture.auth.changePassword('abc12345', 'newpass123', 'fresh-verification')
  assert.equal(fixture.requests.at(-1).body.remember, false)
  assert.equal(fixture.session.get('jwt_token'), 'password-jwt')
  assert.equal(fixture.local.has('jwt_token'), false)
})

test('头像上传响应解析期间切号不能返回旧账号头像', async (t) => {
  const fixture = await authFixture(t)
  const parsed = deferred()
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, status: 201, json: () => parsed.promise }))
  const upload = fixture.auth.uploadAvatar(new Blob(['avatar']))
  await settle()
  fixture.auth.markSessionActive()
  parsed.resolve({ url: '/api/avatar/1111111111111111.webp' })
  await assert.rejects(upload, (error) => error.status === 409)
})
