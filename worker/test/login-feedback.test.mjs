import test, { after, afterEach, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import { createRenderer, nextTick } from 'vue'

const source = await readFile('src/pages/Login.vue', 'utf8')
const descriptor = parse(source, { filename: 'Login.vue' }).descriptor
const script = compileScript(descriptor, { id: 'login-feedback', genDefaultAs: 'LoginPage' })
const template = compileTemplate({
  source: descriptor.template.content,
  filename: 'Login.vue',
  id: 'login-feedback',
  compilerOptions: { bindingMetadata: script.bindings }
})
assert.deepEqual(template.errors, [])

// Keep the real policy helper while replacing network and application boot boundaries.
globalThis.sessionStorage = { getItem: () => null }
globalThis.window = { addEventListener() {} }
globalThis.Document = class Document {}
globalThis.document = Object.assign(new Document(), { activeElement: null })
const built = await build({
  stdin: {
    contents: `export { default as LoginPage } from './src/pages/Login.vue';
      export { passwordPolicyError } from './src/services/auth.ts';
      export { passwordSchema } from './worker/src/schemas';`,
    resolveDir: process.cwd()
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  external: ['vue'],
  define: { __DESKTOP_BUILD__: 'false' },
  plugins: [
    {
      name: 'login-feedback-boundaries',
      setup(builder) {
        builder.onResolve(
          {
            filter:
              /(?:services\/auth|composables\/useAppBoot|api\/(?:auth|client)|utils\/session|vue-router|@lucide\/vue)$/
          },
          ({ path }) => ({ path, namespace: 'boundary' })
        )
        builder.onResolve({ filter: /\.vue$/ }, ({ path }) => ({ path, namespace: 'component' }))
        builder.onLoad({ filter: /.*/, namespace: 'component' }, ({ path }) => {
          if (path.endsWith('/Login.vue'))
            return {
              contents: `${script.content}\n${template.code}\nLoginPage.render = render; export default LoginPage;`,
              loader: 'ts',
              resolveDir: resolve('src/pages')
            }
          return {
            contents: `import { h } from 'vue'; export const __esModule = true; export default {
          setup(_props, { emit, expose }) {
            expose({ reset() { globalThis.__loginFeedback.resets++; emit('update:token', ''); } });
            return () => h('div', [h('button', {
              type: 'button', class: 'test-turnstile',
              onClick: () => emit('update:token', globalThis.__loginFeedback.token)
            }, 'verify'), h('button', {
              type: 'button', onClick: () => { emit('update:token', ''); emit('load-error'); }
            }, 'verification-error')]);
          }
        };`
          }
        })
        builder.onLoad({ filter: /.*/, namespace: 'boundary' }, ({ path }) => {
          if (path.endsWith('services/auth'))
            return {
              contents: `export { passwordPolicyError } from './src/services/auth.ts';
            export const login = (...args) => globalThis.__loginFeedback.login(...args);
            export const register = (...args) => globalThis.__loginFeedback.register(...args);
            export const enterGuestMode = () => {};`,
              resolveDir: process.cwd()
            }
          if (path.endsWith('useAppBoot')) return { contents: 'export const retryBoot = { value: async () => {} };' }
          if (path === 'vue-router') return { contents: 'export const useRouter = () => ({ replace() {} });' }
          if (path === '@lucide/vue')
            return {
              contents:
                'const Icon = { render: () => null }; export { Icon as Eye, Icon as EyeOff, Icon as ArrowRight, Icon as BookOpen, Icon as ListChecks, Icon as Timer, Icon as NotebookPen };'
            }
          if (path.endsWith('api/auth')) return { contents: 'export const authApi = {};' }
          if (path.endsWith('api/client'))
            return {
              contents: 'export const expireSession = () => {}; export const loginRedirectPath = () => "/login";'
            }
          return {
            contents: `export const TOKEN_KEY = 'token', SESSION_FLAG = 'session', SESSION_PERSISTENCE_KEY = 'remember';
          export const getToken = () => null, keepsSession = () => true;
          export const hasSession = () => false, hasActiveSession = () => false;
          export const clearSession = () => {}, markSessionActive = () => {};`
          }
        })
      }
    }
  ]
})
await mkdir('.cache/login-feedback-tests', { recursive: true })
const filename = `.cache/login-feedback-tests/${crypto.randomUUID()}.mjs`
await writeFile(filename, built.outputFiles[0].text)
const { LoginPage, passwordPolicyError, passwordSchema } = await import(pathToFileURL(resolve(filename)).href)
after(() => unlink(filename))

// A Vue host renderer exercises the compiled template and actual v-model input listeners.
function node(tag, text = '') {
  return {
    tag,
    tagName: tag.toUpperCase(),
    text,
    props: {},
    children: [],
    parent: null,
    value: '',
    listeners: {},
    getRootNode: () => document,
    addEventListener(name, listener) {
      this.listeners[name] = listener
    },
    removeEventListener(name) {
      delete this.listeners[name]
    }
  }
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
  patchProp: (element, key, _previous, value) => {
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
const apps = []
const text = (element) => element.text + element.children.map(text).join('')
function find(root, predicate) {
  if (predicate(root)) return root
  for (const child of root.children) {
    const found = find(child, predicate)
    if (found) return found
  }
  return null
}
async function settle() {
  await new Promise((done) => setImmediate(done))
  await nextTick()
}
async function mount() {
  const root = node('root'),
    app = renderer.createApp(LoginPage)
  apps.push(app)
  app.mount(root)
  await settle()
  return {
    root,
    input: (id) => find(root, (element) => element.props.id === id),
    button: (label) => find(root, (element) => element.tag === 'button' && text(element).trim() === label),
    alert: () => find(root, (element) => element.tag === 'p' && element.props.role === 'alert'),
    async submit() {
      await find(root, (element) => element.tag === 'form').props.onSubmit({ preventDefault() {} })
      await nextTick()
    }
  }
}
async function type(element, value) {
  element.value = value
  element.listeners.input({ target: element })
  await nextTick()
}
async function click(element) {
  await element.props.onClick({})
  await nextTick()
}
beforeEach(() => {
  globalThis.__loginFeedback = {
    resets: 0,
    token: 'first-verification',
    calls: [],
    login: async (...args) => {
      globalThis.__loginFeedback.calls.push(['login', ...args])
    },
    register: async (...args) => {
      globalThis.__loginFeedback.calls.push(['register', ...args])
    }
  }
})
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount()
})

test('the mounted alert region exposes preflight errors and duplicate registration failures', async () => {
  const page = await mount(),
    region = page.alert()
  assert.ok(region, 'the live region must exist before errors arrive')
  assert.equal(region.props['aria-atomic'], 'true')
  assert.equal(text(region), '')
  await page.submit()
  assert.equal(page.alert(), region)
  assert.equal(text(region), '请输入用户名和密码')
  assert.equal(region.props.class, 'login-error')

  await click(page.button('注册'))
  await type(page.input('username'), 'existing-user')
  await type(page.input('password'), 'password1')
  await type(page.input('confirm-password'), 'password1')
  await click(page.button('verify'))
  globalThis.__loginFeedback.register = async () => {
    throw new Error('用户名已被注册')
  }
  await page.submit()
  assert.equal(page.alert(), region)
  assert.match(text(region), /用户名已被注册/)
})

test('registration password feedback updates before submit and agrees with both policy implementations', async () => {
  const page = await mount()
  await click(page.button('注册'))
  const input = page.input('password'),
    hint = page.input('password-hint')
  assert.equal(input.props['aria-describedby'], hint.props.id)
  assert.equal(hint.props.role, 'status')
  assert.equal(hint.props['aria-live'], 'polite')
  assert.equal(hint.props['aria-atomic'], 'true')
  assert.equal(text(hint), '8-14 位，需包含字母和数字')
  assert.equal(input.props['aria-invalid'], false)
  for (const password of [
    'abc',
    'abcde12',
    'abcdef12',
    'abcdefghijk123',
    'abcdefghijkl123',
    'abcdefgh',
    '12345678',
    'abcde 1@'
  ]) {
    await type(input, password)
    const error = passwordPolicyError(password)
    assert.equal(passwordSchema.safeParse(password).success, error === null, password)
    assert.equal(text(hint), error ?? '密码格式符合要求', password)
    assert.equal(input.props['aria-invalid'], error !== null, password)
    assert.equal(globalThis.__loginFeedback.calls.length, 0, 'typing must not submit credentials')
    assert.equal(text(page.alert()), '', 'live format guidance does not turn into a submit error')
  }
})

test('switching modes clears registration feedback without applying its policy to login', async () => {
  const page = await mount()
  assert.equal(page.input('password-hint'), null)
  assert.equal(page.input('password').props['aria-describedby'], undefined)
  assert.equal(page.input('password').props['aria-invalid'], undefined)
  await click(page.button('注册'))
  await type(page.input('password'), 'abc')
  assert.equal(page.input('password').props['aria-invalid'], true)
  await click(page.button('登录'))
  assert.equal(page.input('password').value, '')
  assert.equal(page.input('password-hint'), null)
  assert.equal(page.input('password').props['aria-describedby'], undefined)
  assert.equal(page.input('password').props['aria-invalid'], undefined)
  await type(page.input('username'), 'existing-user')
  await type(page.input('password'), 'abc')
  await click(page.button('verify'))
  await page.submit()
  assert.deepEqual(globalThis.__loginFeedback.calls, [['login', 'existing-user', 'abc', 'first-verification', true]])
  await click(page.button('注册'))
  assert.equal(page.input('password').value, '')
  assert.equal(page.input('password').props['aria-invalid'], false)
  assert.equal(text(page.input('password-hint')), '8-14 位，需包含字母和数字')
})

test('client validation preserves an unused Turnstile token; a failed request requires a fresh one', async () => {
  const page = await mount()
  await click(page.button('verify'))
  await page.submit()
  assert.equal(globalThis.__loginFeedback.resets, 0)
  assert.equal(globalThis.__loginFeedback.calls.length, 0)
  await type(page.input('username'), 'existing-user')
  await type(page.input('password'), 'wrong-password')
  globalThis.__loginFeedback.login = async (...args) => {
    globalThis.__loginFeedback.calls.push(['login', ...args])
    throw new Error('用户名或密码错误')
  }
  await page.submit()
  assert.equal(globalThis.__loginFeedback.resets, 1)
  assert.match(text(page.alert()), /用户名或密码错误/)
  await page.submit()
  assert.equal(globalThis.__loginFeedback.calls.length, 1)
  assert.equal(text(page.alert()), '请先完成人机验证')
  globalThis.__loginFeedback.token = 'fresh-verification'
  globalThis.__loginFeedback.login = async (...args) => globalThis.__loginFeedback.calls.push(['login', ...args])
  await click(page.button('verify'))
  await page.submit()
  assert.deepEqual(
    globalThis.__loginFeedback.calls.map((call) => call[3]),
    ['first-verification', 'fresh-verification']
  )
})

test('credential edits immediately dismiss stale login and registration validation feedback', async () => {
  const page = await mount()
  await page.submit()
  assert.equal(text(page.alert()), '请输入用户名和密码')
  await type(page.input('username'), 'existing-user')
  assert.equal(text(page.alert()), '')
  await page.submit()
  assert.equal(text(page.alert()), '请输入用户名和密码')
  await type(page.input('password'), 'password1')
  assert.equal(text(page.alert()), '')
  await click(page.button('注册'))
  await type(page.input('password'), 'password1')
  await type(page.input('confirm-password'), 'different1')
  await page.submit()
  assert.equal(text(page.alert()), '两次输入的密码不一致')
  await type(page.input('confirm-password'), 'password1')
  assert.equal(text(page.alert()), '')
})

test('successful verification clears a transient SDK failure and obsolete verification guidance', async () => {
  const page = await mount()
  await click(page.button('verification-error'))
  assert.ok(find(page.root, (element) => element.tag === 'div' && element.props.role === 'alert'))
  await click(page.button('verify'))
  assert.equal(
    find(page.root, (element) => element.tag === 'div' && element.props.role === 'alert'),
    null
  )
  await click(page.button('verification-error'))
  await type(page.input('username'), 'existing-user')
  await type(page.input('password'), 'password1')
  await page.submit()
  assert.match(text(page.alert()), /人机验证未能加载/)
  await click(page.button('verify'))
  assert.equal(text(page.alert()), '')
  assert.equal(globalThis.__loginFeedback.calls.length, 0)
  await page.submit()
  assert.equal(globalThis.__loginFeedback.calls.length, 1)
})

test('保持登录选项默认开启，取消勾选后提交本次会话策略', async () => {
  const page = await mount()
  const checkbox = find(page.root, (element) => element.tag === 'input' && element.props.type === 'checkbox')
  assert.ok(checkbox)
  await checkbox.props['onUpdate:modelValue'](false)
  await type(page.input('username'), 'existing-user')
  await type(page.input('password'), 'password1')
  await click(page.button('verify'))
  await page.submit()
  assert.equal(globalThis.__loginFeedback.calls.at(-1).at(-1), false)
})
