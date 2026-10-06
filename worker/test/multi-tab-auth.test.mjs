import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import vm from 'node:vm'

const built = await build({
  stdin: {
    contents: `export * from './src/services/auth'; export * from './src/utils/session'; export {request,requestKeepalive} from './src/api/client';`,
    resolveDir: process.cwd()
  },
  bundle: true,
  format: 'cjs',
  platform: 'node',
  write: false,
  define: { __DESKTOP_BUILD__: 'false', 'import.meta.env.VITE_API_BASE': '"https://test.invalid"' },
  plugins: [
    {
      name: 'reactivity',
      setup(b) {
        b.onResolve({ filter: /^vue$/ }, () => ({ path: 'vue', namespace: 'mock' }))
        b.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({
          contents: `export const ref=value=>({value});export const computed=f=>({get value(){return f()}});`
        }))
      }
    }
  ]
})

function browsers(deliverStorage = true) {
  const shared = new Map(),
    tabs = [],
    writes = [],
    events = []
  let cookieUser = null,
    logoutCalls = 0
  function emit(owner, event) {
    for (const other of tabs)
      if (other !== owner) {
        const deliver = () => other.listeners.get('storage')?.forEach((f) => f(event))
        if (deliverStorage) deliver()
        else events.push(deliver)
      }
  }
  function tab() {
    const listeners = new Map(),
      session = new Map(),
      exports = {}
    const t = { listeners }
    const ctx = vm.createContext({
      exports,
      module: { exports },
      console,
      URL,
      Response,
      Request,
      AbortSignal,
      AbortController,
      TextEncoder,
      CustomEvent,
      Event,
      setTimeout,
      clearTimeout,
      localStorage: {
        getItem: (k) => shared.get(k) ?? null,
        setItem(k, value) {
          const v = String(value),
            oldValue = shared.get(k) ?? null
          shared.set(k, v)
          if (oldValue !== v) emit(t, { key: k, oldValue, newValue: v })
        },
        removeItem(k) {
          const oldValue = shared.get(k)
          shared.delete(k)
          if (oldValue !== undefined) emit(t, { key: k, oldValue, newValue: null })
        }
      },
      sessionStorage: {
        getItem: (k) => session.get(k) ?? null,
        setItem: (k, v) => session.set(k, String(v)),
        removeItem: (k) => session.delete(k)
      },
      window: {
        location: { hash: '#/login' },
        addEventListener(k, f) {
          if (!listeners.has(k)) listeners.set(k, [])
          listeners.get(k).push(f)
        },
        dispatchEvent(e) {
          listeners.get(e.type)?.forEach((f) => f(e))
        }
      },
      fetch: async (url, init) => {
        if (url.endsWith('/api/auth/login')) {
          const body = JSON.parse(init.body)
          cookieUser = body.username
          return Response.json({
            token: 'unused',
            user: { id: body.username, username: body.username, role: 'user', createdAt: 1 }
          })
        }
        if (url.endsWith('/api/auth/logout')) {
          logoutCalls++
          return Response.json({ ok: true })
        }
        writes.push({ cookieUser, expectedUser: init.headers['X-Expected-User-Id'], body: JSON.parse(init.body) })
        return Response.json({ message: '登录账号已改变' }, { status: 409 })
      }
    })
    vm.runInContext(built.outputFiles[0].text, ctx)
    t.api = ctx.module.exports
    tabs.push(t)
    return t
  }
  return {
    tab,
    shared,
    writes,
    flushEvents: () => events.splice(0).forEach((f) => f()),
    logoutCalls: () => logoutCalls
  }
}

test('another tab login expires old account state and generation without clearing the new shared session', async () => {
  const browser = browsers(),
    a = browser.tab(),
    b = browser.tab()
  await a.api.login('A', 'abc12345')
  const version = a.api.getSessionVersion()
  await b.api.login('B', 'abc12345')
  assert.equal(a.api.sessionUser.value, null)
  assert.ok(a.api.getSessionVersion() > version)
  assert.equal(a.api.hasSession(), false)
  assert.equal(b.api.sessionUser.value.id, 'B')
  assert.equal(browser.shared.get('auth_logged_in'), '1')
  assert.equal(JSON.parse(browser.shared.get('auth_session_identity')).userId, 'B')
  assert.equal(browser.logoutCalls(), 0)
})

test('before storage delivery, private fetch and unload writes still carry the old expected account', async () => {
  const browser = browsers(false),
    a = browser.tab(),
    b = browser.tab()
  await a.api.login('A', 'abc12345')
  await b.api.login('B', 'abc12345')
  assert.equal(a.api.sessionUser.value.id, 'A')
  await assert.rejects(
    a.api.request('/api/data/push', { method: 'POST', body: '{"private":"A"}' }),
    (e) => e.status === 409
  )
  a.api.requestKeepalive('/api/data/push', { private: 'A' })
  assert.equal(browser.writes.length, 2)
  assert.ok(browser.writes.every((r) => r.cookieUser === 'B' && r.expectedUser === 'A'))
  browser.flushEvents()
  assert.equal(a.api.sessionUser.value, null)
  assert.equal(b.api.sessionUser.value.id, 'B')
  assert.equal(browser.logoutCalls(), 0)
})

test('same-account new generation survives an old tab clearing its session before queued broadcasts arrive', async () => {
  const browser = browsers(false),
    a = browser.tab(),
    b = browser.tab()
  await a.api.login('A', 'abc12345')
  const oldIdentity = browser.shared.get('auth_session_identity')
  await b.api.login('A', 'abc12345')
  const newIdentity = browser.shared.get('auth_session_identity')
  assert.notEqual(newIdentity, oldIdentity)
  a.api.clearSession()
  assert.equal(browser.shared.get('auth_session_identity'), newIdentity)
  assert.equal(browser.shared.get('auth_logged_in'), '1')
  browser.flushEvents()
  assert.equal(b.api.sessionUser.value.id, 'A')
  assert.equal(b.api.hasSession(), true)
})

test('queued old TOKEN deletion and storage-clear events cannot expire a newly established session', async () => {
  const browser = browsers(),
    a = browser.tab(),
    b = browser.tab()
  await b.api.login('B', 'abc12345')
  await a.api.login('A', 'abc12345')
  const identity = browser.shared.get('auth_session_identity')
  for (const key of ['jwt_token', null]) a.listeners.get('storage').forEach((f) => f({ key, newValue: null }))
  assert.equal(a.api.sessionUser.value.id, 'A')
  assert.equal(browser.shared.get('auth_session_identity'), identity)
  assert.equal(browser.shared.get('auth_logged_in'), '1')
})
