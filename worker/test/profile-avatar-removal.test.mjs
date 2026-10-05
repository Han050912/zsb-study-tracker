import test, { after, afterEach, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import { createRenderer, h, nextTick, reactive, ref } from 'vue'

const real = new Set(['EditProfileModal.vue', 'ProfileHeader.vue', 'UserAvatar.vue'])
const built = await build({
  stdin: {
    contents: `export { default as EditProfileModal } from './src/components/profile/EditProfileModal.vue';
    export { default as ProfileHeader } from './src/components/profile/ProfileHeader.vue';
      export { default as UserAvatar } from './src/components/community/UserAvatar.vue';
      export { sessionUser } from './src/services/auth';`,
    resolveDir: process.cwd()
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  external: ['vue'],
  plugins: [
    {
      name: 'profile-boundaries',
      setup(builder) {
        builder.onResolve({ filter: /\.vue$/ }, ({ path, resolveDir }) => ({
          path: resolve(resolveDir, path),
          namespace: 'sfc'
        }))
        builder.onLoad({ filter: /.*/, namespace: 'sfc' }, async ({ path }) => {
          const name = path.split(/[\\/]/).at(-1)
          if (name === 'Modal.vue')
            return {
              contents: `import { h } from 'vue'; export default {
        props: ['show'], emits: ['close'], setup(props, { slots }) {
          return () => props.show ? h('section', { role: 'dialog' }, [slots.default?.(), slots.footer?.()]) : null;
        } };`
            }
          if (name === 'AvatarEditor.vue')
            return {
              contents: `import { h } from 'vue'; export default {
        props: ['show'], emits: ['update:show','uploaded'], setup(props, { emit }) {
          return () => props.show ? h('button', { onClick() {
            emit('uploaded', '/api/avatar/2222222222222222.webp'); emit('update:show', false);
          } }, '模拟确认上传') : null;
        } };`
            }
          if (!real.has(name)) return { contents: 'export default { render: () => null };' }
          const descriptor = parse(await readFile(path, 'utf8'), { filename: path }).descriptor
          const script = compileScript(descriptor, { id: name, genDefaultAs: 'Component' })
          const template = compileTemplate({
            source: descriptor.template.content,
            filename: path,
            id: name,
            compilerOptions: { bindingMetadata: script.bindings }
          })
          assert.deepEqual(template.errors, [])
          return {
            contents: `${script.content}\n${template.code}\nComponent.render = render; export default Component;`,
            loader: 'ts',
            resolveDir: dirname(path)
          }
        })
        builder.onResolve(
          {
            filter:
              /(?:stores\/app|services\/auth|api\/(?:community|settings)|composables\/useToast|vue-router|@lucide\/vue)$/
          },
          ({ path }) => ({ path, namespace: 'boundary' })
        )
        builder.onLoad({ filter: /.*/, namespace: 'boundary' }, ({ path }) => ({
          contents: path.endsWith('/app')
            ? 'export const useAppStore = () => globalThis.__avatarUi.store;'
            : path.endsWith('/auth')
              ? 'import { ref } from "vue"; export const sessionUser = ref({ id: "me", username: "test-account" }); export const requireLogin = () => false;'
              : path.endsWith('/settings')
                ? 'export const settingsApi = { validate: data => globalThis.__avatarUi.validate(data) };'
                : path.endsWith('/community')
                  ? 'export const imageUrl = value => `https://avatar.invalid${value}`;'
                  : path.endsWith('/useToast')
                    ? 'export const useToast = () => message => globalThis.__avatarUi.toasts.push(message);'
                    : path === 'vue-router'
                      ? 'export const useRouter = () => ({ push() {} });'
                      : 'const Icon = { render: () => null }; export { Icon as BadgeCheck, Icon as Camera };'
        }))
      }
    }
  ]
})
await mkdir('.cache/profile-avatar', { recursive: true })
const file = resolve(`.cache/profile-avatar/${crypto.randomUUID()}.mjs`)
await writeFile(file, built.outputFiles[0].text)
const { EditProfileModal, ProfileHeader, UserAvatar, sessionUser } = await import(pathToFileURL(file).href)
after(() => unlink(file))

globalThis.Document = class Document {}
globalThis.document = Object.assign(new Document(), { activeElement: null })
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
    addEventListener(name, callback) {
      this.listeners[name] = callback
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
  patchProp: (element, key, _old, value) => {
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
const text = (element) => element.text + element.children.map(text).join('')
function find(element, predicate) {
  if (predicate(element)) return element
  for (const child of element.children) {
    const match = find(child, predicate)
    if (match) return match
  }
  return null
}
const apps = []
function mount(component, props = {}) {
  const root = node('root'),
    app = renderer.createApp(component, props)
  apps.push(app)
  app.mount(root)
  return { root, app }
}
function modal() {
  const show = ref(true),
    saved = []
  const page = mount({
    render: () =>
      h(EditProfileModal, {
        show: show.value,
        'onUpdate:show': (value) => {
          show.value = value
        },
        onSaved: () => saved.push('saved')
      })
  })
  return {
    ...page,
    show,
    saved,
    button: (label) => find(page.root, (element) => element.tag === 'button' && text(element).trim() === label)
  }
}
async function click(button) {
  assert.ok(button)
  await button.props.onClick()
  await nextTick()
}
async function settle() {
  await new Promise((done) => setImmediate(done))
  await nextTick()
}
beforeEach(() => {
  sessionUser.value = { id: 'me', username: 'test-account' }
  const settings = reactive({ avatar: '/api/avatar/1111111111111111.webp', userName: '备考同学', bio: '复习中' })
  globalThis.__avatarUi = {
    updates: [],
    toasts: [],
    validate: async (data) => data,
    store: {
      settings,
      updateSettings(patch) {
        Object.assign(this.settings, patch)
        globalThis.__avatarUi.updates.push(patch)
      },
      setAvatar(avatar) {
        this.settings.avatar = avatar
      }
    }
  }
})
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount()
})

test('移除仅更改字母预览，取消与重新打开保留已保存头像', async () => {
  const page = modal(),
    before = globalThis.__avatarUi.store.settings.avatar
  assert.ok(find(page.root, (element) => element.tag === 'img'))
  await click(page.button('移除头像'))
  assert.equal(
    find(page.root, (element) => element.tag === 'img'),
    null
  )
  assert.match(text(page.root), /保存后将恢复字母头像/)
  assert.equal(globalThis.__avatarUi.store.settings.avatar, before)
  assert.deepEqual(globalThis.__avatarUi.updates, [])
  await click(page.button('取消'))
  assert.equal(page.show.value, false)
  page.show.value = true
  await nextTick()
  assert.equal(find(page.root, (element) => element.tag === 'img').props.src, `https://avatar.invalid${before}`)
  assert.ok(page.button('移除头像'))
  assert.deepEqual(page.saved, [])
})

test('撤销移除恢复图片，校验失败不清空已保存头像，保存提交显式空值', async () => {
  const page = modal(),
    before = globalThis.__avatarUi.store.settings.avatar
  await click(page.button('移除头像'))
  await click(page.button('撤销移除'))
  assert.ok(find(page.root, (element) => element.tag === 'img'))
  await click(page.button('移除头像'))
  globalThis.__avatarUi.validate = async () => {
    throw new Error('暂时无法保存')
  }
  await click(page.button('保存'))
  assert.equal(globalThis.__avatarUi.store.settings.avatar, before)
  assert.equal(page.show.value, true)
  assert.deepEqual(globalThis.__avatarUi.updates, [])
  globalThis.__avatarUi.validate = async (data) => data
  await click(page.button('保存'))
  assert.deepEqual(globalThis.__avatarUi.updates, [{ userName: '备考同学', bio: '复习中', avatar: '' }])
  assert.equal(globalThis.__avatarUi.store.settings.avatar, '')
  assert.equal(page.show.value, false)
  assert.deepEqual(page.saved, ['saved'])
})

test('头像移除后本人资料不会回退旧接口图片，公开字母头像正常渲染', () => {
  globalThis.__avatarUi.store.settings.avatar = ''
  const profile = {
    userId: 'me',
    userName: '备考同学',
    userCode: '12345678',
    avatar: '/api/avatar/1111111111111111.webp'
  }
  const self = mount(ProfileHeader, { profile, isSelf: true })
  assert.equal(
    find(self.root, (element) => element.tag === 'img'),
    null
  )
  assert.match(text(self.root), /备/)
  const visitor = mount(ProfileHeader, { profile: { ...profile, avatar: '' }, isSelf: false })
  assert.equal(
    find(visitor.root, (element) => element.tag === 'img'),
    null
  )
  const publicAvatar = mount(UserAvatar, { name: profile.userName, avatar: '' })
  assert.equal(
    find(publicAvatar.root, (element) => element.tag === 'img'),
    null
  )
  assert.equal(text(publicAvatar.root), '备')
})

test('默认头像没有移除入口，确认上传新图会撤销之前的移除草稿', async () => {
  globalThis.__avatarUi.store.settings.avatar = ''
  const empty = modal()
  assert.equal(empty.button('移除头像'), null)
  globalThis.__avatarUi.store.settings.avatar = '/api/avatar/1111111111111111.webp'
  const page = modal()
  await click(page.button('移除头像'))
  await click(page.button('更换头像'))
  await click(page.button('模拟确认上传'))
  assert.equal(globalThis.__avatarUi.store.settings.avatar, '/api/avatar/2222222222222222.webp')
  assert.equal(page.button('撤销移除'), null)
  await click(page.button('保存'))
  assert.equal(globalThis.__avatarUi.updates.at(-1).avatar, undefined)
  assert.equal(globalThis.__avatarUi.store.settings.avatar, '/api/avatar/2222222222222222.webp')
})

test('保存校验期间关闭的编辑器不提交迟到的头像清空', async () => {
  let done
  globalThis.__avatarUi.validate = () =>
    new Promise((resolve) => {
      done = resolve
    })
  const page = modal()
  await click(page.button('移除头像'))
  const saving = page.button('保存').props.onClick()
  await nextTick()
  assert.equal(page.button('取消').props.disabled, true)
  page.show.value = false
  await nextTick()
  done({ userName: '备考同学', bio: '复习中' })
  await saving
  await settle()
  assert.deepEqual(globalThis.__avatarUi.updates, [])
  assert.equal(globalThis.__avatarUi.store.settings.avatar, '/api/avatar/1111111111111111.webp')
})

test('关闭后重新打开的资料草稿不被上次校验结果清空或关闭', async () => {
  let done
  globalThis.__avatarUi.validate = () =>
    new Promise((resolve) => {
      done = resolve
    })
  const page = modal()
  await click(page.button('移除头像'))
  const saving = page.button('保存').props.onClick()
  page.show.value = false
  await nextTick()
  page.show.value = true
  await nextTick()
  done({ userName: '旧昵称', bio: '旧简介' })
  await saving
  await nextTick()
  assert.equal(page.show.value, true)
  assert.ok(page.button('移除头像'))
  assert.deepEqual(globalThis.__avatarUi.updates, [])
  assert.deepEqual(page.saved, [])
})

test('换账号后迟到的头像移除不能修改新账号资料', async () => {
  let done
  globalThis.__avatarUi.validate = () =>
    new Promise((resolve) => {
      done = resolve
    })
  const page = modal()
  await click(page.button('移除头像'))
  const saving = page.button('保存').props.onClick()
  globalThis.__avatarUi.store.settings = reactive({
    userName: '另一账号',
    bio: '新简介',
    avatar: '/api/avatar/3333333333333333.webp'
  })
  sessionUser.value = { id: 'other', username: 'other-account' }
  await nextTick()
  done({ userName: '旧昵称', bio: '旧简介' })
  await saving
  await nextTick()
  assert.equal(globalThis.__avatarUi.store.settings.avatar, '/api/avatar/3333333333333333.webp')
  assert.deepEqual(globalThis.__avatarUi.updates, [])
  assert.deepEqual(page.saved, [])
  assert.equal(page.show.value, true)
})

test('旧校验失败不弹错误或解除重新打开后新请求的保存状态', async () => {
  const requests = []
  globalThis.__avatarUi.validate = () => new Promise((resolve, reject) => requests.push({ resolve, reject }))
  const page = modal()
  await click(page.button('移除头像'))
  const first = page.button('保存').props.onClick()
  page.show.value = false
  await nextTick()
  page.show.value = true
  await nextTick()
  const second = page.button('保存').props.onClick()
  await nextTick()
  requests[0].reject(new Error('迟到错误'))
  await first
  await nextTick()
  assert.ok(page.button('保存中…'))
  assert.deepEqual(globalThis.__avatarUi.toasts, [])
  requests[1].resolve({ userName: '备考同学', bio: '复习中' })
  await second
  await nextTick()
  assert.equal(globalThis.__avatarUi.updates.at(-1).avatar, undefined)
  assert.equal(page.show.value, false)
})

test('真实卸载后迟到的资料校验不能清空头像或发出保存事件', async () => {
  let done
  globalThis.__avatarUi.validate = () =>
    new Promise((resolve) => {
      done = resolve
    })
  const page = modal()
  await click(page.button('移除头像'))
  const saving = page.button('保存').props.onClick()
  page.app.unmount()
  apps.splice(apps.indexOf(page.app), 1)
  done({ userName: '备考同学', bio: '复习中' })
  await saving
  assert.deepEqual(globalThis.__avatarUi.updates, [])
  assert.deepEqual(page.saved, [])
  assert.deepEqual(globalThis.__avatarUi.toasts, [])
  assert.equal(globalThis.__avatarUi.store.settings.avatar, '/api/avatar/1111111111111111.webp')
})
