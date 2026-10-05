import test, { after, afterEach, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { compileScript, parse } from '@vue/compiler-sfc'
import { createRenderer, h, nextTick, ref } from 'vue'

const descriptor = parse(await readFile('src/components/AvatarEditor.vue', 'utf8'), {
  filename: 'AvatarEditor.vue'
}).descriptor
const script = compileScript(descriptor, { id: 'avatar-upload', genDefaultAs: 'Editor' })
const built = await build({
  stdin: {
    contents: `${script.content}\nEditor.render = () => null; export default Editor; export { sessionUser } from '../services/auth';`,
    resolveDir: resolve('src/components'),
    loader: 'ts'
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  external: ['vue'],
  plugins: [
    {
      name: 'upload-boundaries',
      setup(builder) {
        builder.onResolve(
          { filter: /(?:services\/auth|api\/community|composables\/useToast|cropperjs|\.css$|\.vue$)/ },
          ({ path }) => ({ path, namespace: 'boundary' })
        )
        builder.onLoad({ filter: /.*/, namespace: 'boundary' }, ({ path }) => ({
          contents: path.endsWith('/auth')
            ? 'import { ref } from "vue"; export const sessionUser = ref({ id: "me" });'
            : path.endsWith('/community')
              ? 'export const IMAGE_MAX_BYTES = 5000000; export const uploadAvatar = (...args) => globalThis.__avatarUpload.upload(...args);'
              : path.endsWith('/useToast')
                ? 'export const useToast = () => message => globalThis.__avatarUpload.toasts.push(message);'
                : 'export default { render: () => null };'
        }))
      }
    }
  ]
})
await mkdir('.cache/avatar-upload', { recursive: true })
const file = resolve(`.cache/avatar-upload/${crypto.randomUUID()}.mjs`)
await writeFile(file, built.outputFiles[0].text)
const { default: Editor, sessionUser } = await import(pathToFileURL(file).href)
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
function mount() {
  const show = ref(true),
    uploaded = []
  const app = renderer.createApp({
    render: () =>
      h(Editor, {
        show: show.value,
        'onUpdate:show': (value) => {
          show.value = value
        },
        onUploaded: (value) => uploaded.push(value)
      })
  })
  apps.push(app)
  app.mount({})
  const state = app._instance.subTree.component.setupState
  state.cropper = { getCroppedCanvas: () => ({ toBlob: (callback) => callback(new Blob(['avatar'])) }), destroy() {} }
  return { app, state, show, uploaded }
}
async function settle() {
  await new Promise((done) => setImmediate(done))
  await nextTick()
}
beforeEach(() => {
  sessionUser.value = { id: 'me' }
  globalThis.__avatarUpload = {
    toasts: [],
    calls: [],
    upload: async (blob) => {
      globalThis.__avatarUpload.calls.push(blob)
      return { url: '/api/avatar/1111111111111111.webp' }
    }
  }
})
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount()
})

test('裁剪输出期间切号不会使用新会话上传旧头像', async () => {
  const page = mount()
  let cropped
  page.state.cropper = {
    getCroppedCanvas: () => ({
      toBlob: (callback) => {
        cropped = callback
      }
    }),
    destroy() {}
  }
  const upload = page.state.submit()
  sessionUser.value = { id: 'other' }
  await nextTick()
  cropped(new Blob(['old-avatar']))
  await upload
  assert.equal(globalThis.__avatarUpload.calls.length, 0)
  assert.deepEqual(page.uploaded, [])
  assert.deepEqual(globalThis.__avatarUpload.toasts, [])
})

test('上传期间关闭入口保持弹窗，完成后按原流程即时更新并关闭', async () => {
  const page = mount()
  let done
  globalThis.__avatarUpload.upload = () =>
    new Promise((resolve) => {
      done = resolve
    })
  const upload = page.state.submit()
  await settle()
  page.state.close()
  await nextTick()
  assert.equal(page.show.value, true)
  assert.equal(page.state.uploading, true)
  done({ url: '/api/avatar/1111111111111111.webp' })
  await upload
  await nextTick()
  assert.deepEqual(page.uploaded, ['/api/avatar/1111111111111111.webp'])
  assert.equal(page.show.value, false)
})

test('父层关闭后重新打开，迟到上传不覆盖新移除草稿或提示成功', async () => {
  const page = mount()
  let done
  globalThis.__avatarUpload.upload = () =>
    new Promise((resolve) => {
      done = resolve
    })
  const upload = page.state.submit()
  await settle()
  page.show.value = false
  await nextTick()
  page.show.value = true
  await nextTick()
  done({ url: '/api/avatar/1111111111111111.webp' })
  await upload
  await nextTick()
  assert.deepEqual(page.uploaded, [])
  assert.deepEqual(globalThis.__avatarUpload.toasts, [])
  assert.equal(page.show.value, true)
  assert.equal(page.state.uploading, false)
})

test('真实卸载后迟到的裁剪输出不能发起头像上传', async () => {
  const page = mount()
  let cropped
  page.state.cropper = {
    getCroppedCanvas: () => ({
      toBlob: (callback) => {
        cropped = callback
      }
    }),
    destroy() {}
  }
  const upload = page.state.submit()
  page.app.unmount()
  apps.splice(apps.indexOf(page.app), 1)
  cropped(new Blob(['late-avatar']))
  await upload
  assert.equal(globalThis.__avatarUpload.calls.length, 0)
  assert.deepEqual(page.uploaded, [])
  assert.deepEqual(globalThis.__avatarUpload.toasts, [])
})

test('真实卸载后在途上传响应不能发出更新事件或成功提示', async () => {
  const page = mount()
  let done
  globalThis.__avatarUpload.upload = () =>
    new Promise((resolve) => {
      done = resolve
    })
  const upload = page.state.submit()
  await settle()
  page.app.unmount()
  apps.splice(apps.indexOf(page.app), 1)
  done({ url: '/api/avatar/1111111111111111.webp' })
  await upload
  assert.deepEqual(page.uploaded, [])
  assert.deepEqual(globalThis.__avatarUpload.toasts, [])
})
