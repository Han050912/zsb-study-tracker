import test, { beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { createRenderer, reactive, nextTick, h } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { deferred, settle as waitForPromises } from './refactor-harness.mjs'

globalThis.Document = class Document {}
globalThis.document = Object.assign(new Document(), { activeElement: null })
globalThis.window = { scrollY: 0, scrollTo() {} }
globalThis.IntersectionObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
}
const realComponents = new Set(['Community.vue', 'CommentInput.vue', 'AppTabs.vue', 'AsyncState.vue', 'EmptyState.vue'])
const compiled = await build({
  stdin: {
    contents: `export { default as Community } from './src/pages/Community.vue';
      export { default as CommentInput } from './src/components/community/CommentInput.vue';
      export { usePostDetail } from './src/features/community/composables/usePostDetail';
      export { usePostStore } from './src/stores/community/entities';`,
    resolveDir: process.cwd()
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  external: ['vue', 'pinia'],
  define: { __DESKTOP_BUILD__: 'false' },
  plugins: [
    {
      name: 'vue-feedback-boundaries',
      setup(builder) {
        builder.onResolve({ filter: /\.vue$/ }, ({ path, resolveDir }) => ({
          path: resolve(resolveDir, path),
          namespace: 'component'
        }))
        builder.onLoad({ filter: /.*/, namespace: 'component' }, async ({ path }) => {
          if (!realComponents.has(path.split(/[\\/]/).at(-1)))
            return { contents: 'export const __esModule = true; export default { render: () => null };' }
          const descriptor = parse(await readFile(path, 'utf8'), { filename: path }).descriptor
          const script = compileScript(descriptor, { id: path, genDefaultAs: 'TestComponent' })
          const template = compileTemplate({
            source: descriptor.template.content,
            filename: path,
            id: path,
            compilerOptions: { bindingMetadata: script.bindings, hoistStatic: false }
          })
          assert.deepEqual(template.errors, [])
          return {
            contents: `${script.content}\n${template.code}\nTestComponent.render = render; export default TestComponent;`,
            loader: 'ts',
            resolveDir: dirname(path)
          }
        })
        builder.onResolve(
          {
            filter:
              /(?:api\/(?:community(?:\/\w+)?|gamification|admin)|services\/auth|stores\/(?:community|app)|\.\.\/app|composables\/(?:useToast|useConfirm|useBack)|vue-router|@lucide\/vue)$/
          },
          ({ path }) => ({ path, namespace: 'boundary' })
        )
        builder.onLoad({ filter: /.*/, namespace: 'boundary' }, ({ path }) => {
          let contents
          if (path === 'vue-router')
            contents = `export const useRoute = () => globalThis.__communityRoute; export const useRouter = () => ({ push: async (next) => { globalThis.__communityRoute.query = next.query || {}; }, replace() {} });`
          else if (path === '@lucide/vue')
            contents =
              'const Icon = { render: () => null }; export { Icon as Search, Icon as Plus, Icon as ArrowUpRight, Icon as TriangleAlert, Icon as Inbox };'
          else if (path.endsWith('services/auth'))
            contents = `import { ref } from 'vue'; export const isLoggedIn = ref(true), isAdmin = ref(false), sessionUser = ref({ id: 'me' }); export const requireLogin = () => false;`
          else if (path.endsWith('stores/community'))
            contents = `export { usePostStore } from './src/stores/community/entities'; export { useCommunityFeedStore } from './src/stores/community/feed-store';`
          else if (path.endsWith('/app'))
            contents = 'export const useAppStore = () => ({ settings: { avatar: "" }, $patch() {} });'
          else if (path.endsWith('useToast'))
            contents = 'export const useToast = () => (message) => globalThis.__communityFeedback.toasts.push(message);'
          else if (path.endsWith('useConfirm')) contents = 'export const useConfirm = () => async () => true;'
          else if (path.endsWith('useBack')) contents = 'export const useBack = () => ({ goBack() {} });'
          else if (path.endsWith('api/community'))
            contents =
              'export const IMAGE_MAX_PER_COMMENT=3, IMAGE_MAX_BYTES=5000000; export const uploadImage = async () => ({});'
          else {
            const part = path.split('/').at(-1)
            contents = `export const ${part}Api = new Proxy({}, { get: (_, key) => (...args) => globalThis.__communityFeedback[key](...args) });`
          }
          return { contents, resolveDir: process.cwd() }
        })
      }
    }
  ]
})
await mkdir('.cache/community-tests', { recursive: true })
const filename = resolve('.cache/community-tests', `ui-${crypto.randomUUID()}.mjs`)
await writeFile(filename, compiled.outputFiles[0].text)
const { Community, CommentInput, usePostDetail, usePostStore } = await import(pathToFileURL(filename).href)
await unlink(filename)

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
const text = (element) =>
  element.text +
  element.children
    .filter((child) => child.tag !== '#comment')
    .map(text)
    .join('')
function findAll(root, predicate) {
  return [...(predicate(root) ? [root] : []), ...root.children.flatMap((child) => findAll(child, predicate))]
}
const find = (root, predicate) => findAll(root, predicate)[0]
async function settle() {
  await waitForPromises()
  await nextTick()
}
async function mount(component) {
  const root = node('root'),
    app = renderer.createApp(component)
  apps.push(app)
  app.mount(root)
  await settle()
  return root
}
async function type(input, value) {
  input.value = value
  input.listeners.input({ target: input })
  await nextTick()
}
async function click(button) {
  assert.ok(button)
  button.props.onClick({})
  await settle()
}
const button = (root, label) => find(root, (element) => element.tag === 'button' && text(element).trim() === label)
beforeEach(() => {
  setActivePinia(createPinia())
  globalThis.__communityRoute = reactive({ name: 'community', params: { id: 'p' }, query: {} })
  globalThis.__communityFeedback = {
    toasts: [],
    calls: [],
    feed: async (query) => {
      globalThis.__communityFeedback.calls.push(query)
      return { posts: [], nextCursor: null }
    },
    recommend: async () => ({ posts: [], circles: [], users: [] }),
    daily: async () => ({ post: null }),
    get: async () => ({}),
    post: async () => ({ post: { id: 'p', userId: 'me', commentsCount: 0 }, comments: [] }),
    addComment: async () => ({ id: 'c', postId: 'p', userId: 'me', content: '评论' })
  }
})
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount()
})

test('精华深链只选择精华 tab，点击切换与 URL 同步并使用专属空态', async () => {
  __communityRoute.query = { view: 'featured', sort: 'hot' }
  const root = await mount(Community)
  assert.deepEqual(
    findAll(root, (element) => element.props.role === 'tab' && element.props['aria-selected']).map(text),
    ['精华']
  )
  assert.match(text(root), /还没有精华讨论/)
  assert.equal(__communityFeedback.calls[0].featured, true)
  await click(button(root, '推荐'))
  assert.equal(__communityRoute.query.view, 'recommend')
  await click(button(root, '精华'))
  assert.equal(__communityRoute.query.view, 'featured')
  assert.deepEqual(
    findAll(root, (element) => element.props.role === 'tab' && element.props['aria-selected']).map(text),
    ['精华']
  )
})

test('标签筛选为空时实际渲染空态与清除动作，清除后重新请求推荐', async () => {
  __communityRoute.query = { tag: '高等数学' }
  const root = await mount(Community)
  assert.match(text(root), /没有找到「高等数学」话题下的相关讨论/)
  assert.equal(__communityFeedback.calls[0].tag, '高等数学')
  await click(button(root, '清除筛选'))
  assert.equal(__communityRoute.query.tag, undefined)
  assert.match(text(root), /还没有讨论，可以分享一道真题/)
})

function commentComposer() {
  return {
    setup() {
      const detail = usePostDetail()
      return () =>
        h(CommentInput, {
          ref: detail.commentInputRef,
          submitting: detail.commentSubmitting.value,
          onSend: detail.send
        })
    }
  }
}
test('评论首次点击即发送并显示提交态，重复点击不重复请求，成功清空草稿并更新评论', async () => {
  __communityRoute.name = 'community-post'
  const pending = deferred()
  __communityFeedback.addComment = (...args) => {
    __communityFeedback.calls.push(args)
    return pending.promise
  }
  const root = await mount(commentComposer()),
    input = find(root, (element) => element.tag === 'textarea')
  await type(input, '一次点击发布')
  const send = button(root, '发送')
  await click(send)
  assert.equal(__communityFeedback.calls.length, 1)
  assert.equal(__communityFeedback.calls[0][1].content, '一次点击发布')
  assert.equal(text(send), '发送中…')
  assert.equal(send.props.disabled, true)
  assert.equal(input.value, '一次点击发布')
  await click(send)
  assert.equal(__communityFeedback.calls.length, 1)
  pending.resolve({ id: 'new-comment', postId: 'p', userId: 'me', content: '一次点击发布' })
  await settle()
  assert.equal(input.value, '')
  assert.equal(usePostStore().commentsById['new-comment'].content, '一次点击发布')
})

test('评论失败保留草稿并允许一次重试；中文输入法确认键不会提前发送', async () => {
  __communityRoute.name = 'community-post'
  __communityFeedback.addComment = async () => {
    throw new Error('网络不可用')
  }
  const root = await mount(commentComposer()),
    input = find(root, (element) => element.tag === 'textarea')
  await type(input, '未发送的评论')
  let compositionPrevented = false
  input.props.onKeydown({
    key: 'Enter',
    isComposing: true,
    preventDefault() {
      compositionPrevented = true
    },
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false
  })
  await settle()
  assert.equal(__communityFeedback.toasts.length, 0)
  assert.equal(compositionPrevented, false)
  await click(button(root, '发送'))
  assert.equal(input.value, '未发送的评论')
  assert.match(__communityFeedback.toasts[0], /网络不可用/)
  assert.equal(button(root, '发送').props.disabled, false)
  __communityFeedback.addComment = async (_post, data) => ({
    id: 'retry',
    postId: 'p',
    userId: 'me',
    content: data.content
  })
  // A composition can end between the model update and pointer event; send the latest DOM value.
  input.value = '输入法刚确认的评论'
  await click(button(root, '发送'))
  assert.equal(usePostStore().commentsById.retry.content, '输入法刚确认的评论')
  assert.equal(input.value, '')
})
