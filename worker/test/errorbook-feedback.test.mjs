import test, { after, afterEach, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import { createRenderer, markRaw, nextTick, reactive } from 'vue'

const source = await readFile('src/pages/ErrorBook.vue', 'utf8')
const descriptor = parse(source, { filename: 'ErrorBook.vue' }).descriptor
const script = compileScript(descriptor, { id: 'errorbook-feedback', genDefaultAs: 'ErrorBookPage' })
const template = compileTemplate({
  source: descriptor.template.content,
  filename: 'ErrorBook.vue',
  id: 'errorbook-feedback',
  compilerOptions: { bindingMetadata: script.bindings }
})
assert.deepEqual(template.errors, [])

globalThis.Document = class Document {}
globalThis.document = Object.assign(new Document(), {
  activeElement: null,
  createElement: () => ({
    getContext: () => ({ drawImage() {} }),
    toBlob: (callback) => callback(new Blob(['compressed image']))
  })
})
globalThis.FileReader = class FileReader {
  readAsDataURL() {
    this.result = 'data:image/png;base64,aW1hZ2U='
    this.onload()
  }
}
globalThis.Image = class Image {
  width = 800
  height = 600
  set src(_value) {
    this.onload()
  }
}

const built = await build({
  stdin: {
    contents: `export { default as ErrorBookPage } from './src/pages/ErrorBook.vue';
      export { errorsActions } from './src/stores/app/errors';`,
    resolveDir: process.cwd()
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  external: ['vue'],
  plugins: [
    {
      name: 'errorbook-feedback-boundaries',
      setup(builder) {
        builder.onResolve(
          {
            filter:
              /(?:stores\/app|services\/syncOutbox|api\/errorImages|composables\/use(?:Toast|Confirm|OverlayDismiss)|@lucide\/vue)$/
          },
          ({ path }) => ({ path, namespace: 'boundary' })
        )
        builder.onResolve({ filter: /\.vue$/ }, ({ path }) => ({ path, namespace: 'component' }))
        builder.onLoad({ filter: /.*/, namespace: 'component' }, ({ path }) => {
          if (path.endsWith('/ErrorBook.vue'))
            return {
              contents: `${script.content}\n${template.code}\nErrorBookPage.render = render; export default ErrorBookPage;`,
              loader: 'ts',
              resolveDir: resolve('src/pages')
            }
          if (path.endsWith('/Modal.vue'))
            return {
              contents: `import { h } from 'vue'; export default {
                props: ['show', 'title'], setup(props, { slots }) {
                  return () => props.show ? h('section', { role: 'dialog' }, [slots.default?.(), slots.footer?.()]) : null;
                }
              };`
            }
          return { contents: 'export default { render: () => null };' }
        })
        builder.onLoad({ filter: /.*/, namespace: 'boundary' }, ({ path }) => {
          if (path.endsWith('stores/app'))
            return { contents: 'export const useAppStore = () => globalThis.__errorbook.store;' }
          if (path.endsWith('useToast'))
            return {
              contents: 'export const useToast = () => (message) => globalThis.__errorbook.toasts.push(message);'
            }
          if (path.endsWith('useConfirm')) return { contents: 'export const useConfirm = () => async () => true;' }
          if (path.endsWith('useOverlayDismiss'))
            return { contents: 'export const OVERLAY_LAYER = {}, useOverlayDismiss = () => {};' }
          if (path.endsWith('syncOutbox'))
            return {
              contents: `export const stageUpsert = (...args) => globalThis.__errorbook.staged.push(structuredClone(args));
              export const stageDelete = () => {};`
            }
          if (path.endsWith('errorImages'))
            return {
              contents: `export const ERROR_IMAGE_PREFIX = 'r2:';
              export const uploadErrorImage = (bytes) => globalThis.__errorbook.upload(bytes);
              export const dataUrlToBytes = () => new ArrayBuffer(0);`
            }
          return { contents: 'const Icon = { render: () => null }; export { Icon as ChevronUp, Icon as ChevronDown };' }
        })
      }
    }
  ]
})
await mkdir('.cache/errorbook-feedback-tests', { recursive: true })
const filename = `.cache/errorbook-feedback-tests/${crypto.randomUUID()}.mjs`
await writeFile(filename, built.outputFiles[0].text)
const { ErrorBookPage, errorsActions } = await import(pathToFileURL(resolve(filename)).href)
after(() => unlink(filename))

// Drive the real compiled Vue template, v-model directives, and error store mutations.
function node(tag, text = '') {
  return markRaw({
    tag,
    tagName: tag.toUpperCase(),
    text,
    props: {},
    children: [],
    parent: null,
    value: '',
    listeners: {},
    get options() {
      return this.children.filter((child) => child.tag === 'option')
    },
    getRootNode: () => document,
    focus() {
      document.activeElement = this
    },
    addEventListener(name, listener) {
      this.listeners[name] = listener
    },
    removeEventListener(name) {
      delete this.listeners[name]
    }
  })
}
const teleportBody = node('body')
const renderer = createRenderer({
  querySelector: (target) => (target === 'body' ? teleportBody : null),
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
    if (key === 'value') element.value = element._value = value
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
    app = renderer.createApp(ErrorBookPage)
  apps.push(app)
  app.mount(root)
  await nextTick()
  const page = {
    root,
    input: (id) => find(root, (element) => element.props.id === id),
    button: (label) => find(root, (element) => element.tag === 'button' && text(element).trim() === label),
    dialog: () => find(root, (element) => element.props.role === 'dialog'),
    error: () => find(root, (element) => element.props.id === 'eb-content-error')
  }
  await click(page.button('收录错题'))
  return page
}
async function type(element, value) {
  element.value = value
  element.listeners.input({ target: element })
  await nextTick()
}
async function select(element, value) {
  for (const option of element.options) option.selected = option.value === value
  element.selectedIndex = element.options.findIndex((option) => option.selected)
  element.listeners.change({ target: element })
  element.props.onChange?.({ target: element })
  await nextTick()
}
async function click(element) {
  await element.props.onClick({})
  await nextTick()
}
beforeEach(() => {
  const subjects = [
    { id: 'math', name: '高数', icon: 'book-open', chapters: [{ id: 'functions', name: '函数', topics: ['极限'] }] },
    { id: 'english', name: '英语', icon: 'book-open', chapters: [] }
  ]
  globalThis.__errorbook = {
    staged: [],
    toasts: [],
    upload: async () => 'a'.repeat(64),
    store: reactive(
      Object.assign(
        {
          subjects,
          subjectMap: Object.fromEntries(subjects.map((subject) => [subject.id, subject])),
          errorQuestions: [],
          save() {}
        },
        errorsActions
      )
    )
  }
})
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount()
  document.activeElement = null
})

test('every card shows subject, type and chapter labels with schema-aware legacy values and fallbacks', async () => {
  __errorbook.store.errorQuestions = [
    {
      id: 'known',
      subjectId: 'english',
      type: 'reading',
      chapter: '手工章节',
      content: '英语题',
      date: '2026-10-05',
      mastered: false,
      reviewCount: 0
    },
    {
      id: 'topic',
      subjectId: 'math',
      type: '计算',
      chapter: '极限',
      content: '极限题',
      date: '2026-10-05',
      mastered: false,
      reviewCount: 0
    },
    {
      id: 'chapter',
      subjectId: 'math',
      type: 'choice',
      chapter: 'functions',
      content: '章节题',
      date: '2026-10-05',
      mastered: false,
      reviewCount: 0
    },
    {
      id: 'missing',
      subjectId: 'deleted',
      type: '',
      content: '旧题',
      date: '2026-10-05',
      mastered: false,
      reviewCount: 0
    }
  ]
  const page = await mount()
  function card(content) {
    return find(page.root, (element) => element.props.class === 'card' && text(element).includes(content))
  }
  assert.match(text(card('英语题')), /科目：英语.*题型：阅读理解.*章节：手工章节/s)
  assert.match(text(card('极限题')), /科目：高数.*题型：计算.*章节：函数 \/ 极限/s)
  assert.match(text(card('章节题')), /章节：函数/)
  assert.match(text(card('旧题')), /科目：未知科目.*题型：未知题型.*章节：未标注章节/s)
  assert.equal(__errorbook.staged.length, 0)
})

test('empty and whitespace saves expose a linked required error, retain the dialog, and clear on correction', async () => {
  const page = await mount(),
    region = page.error()
  await type(page.input('eb-answer'), '保留我的解析')
  await type(page.input('eb-content'), '   \n')
  await click(page.button('保存'))
  assert.equal(page.error(), region)
  assert.equal(region.props.role, 'alert')
  assert.equal(region.props['aria-atomic'], 'true')
  assert.equal(text(region).trim(), '请填写题目内容或上传图片')
  assert.equal(page.input('eb-content').props['aria-invalid'], true)
  assert.match(page.input('eb-content').props['aria-describedby'], /eb-content-error/)
  assert.match(page.input('eb-image').props['aria-describedby'], /eb-content-error/)
  assert.equal(document.activeElement, page.input('eb-content'))
  assert.ok(page.dialog())
  assert.equal(page.input('eb-answer').value, '保留我的解析')
  assert.equal(__errorbook.store.errorQuestions.length, 0)
  assert.equal(__errorbook.staged.length, 0)
  await type(page.input('eb-content'), '有效题干')
  assert.equal(text(region).trim(), '')
  assert.equal(page.input('eb-content').props['aria-invalid'], false)
  await click(page.button('保存'))
  assert.equal(page.dialog(), null)
  assert.equal(__errorbook.store.errorQuestions[0].content, '有效题干')
  assert.equal(__errorbook.store.errorQuestions[0].answer, '保留我的解析')
  assert.equal(__errorbook.staged[0][0], 'errorQuestions')
  assert.equal(__errorbook.staged[0][2].content, '有效题干')
})

test('legacy metadata uses only own labels and unknown subject IDs never read prototype names', async () => {
  __errorbook.store.errorQuestions = ['constructor', '__proto__', 'toString'].map((type, index) => ({
    id: `legacy-${index}`,
    subjectId: type,
    type,
    content: `旧题型 ${index}`,
    date: '2026-10-05',
    mastered: false,
    reviewCount: 0
  }))
  const page = await mount()
  for (const [index, type] of ['constructor', '__proto__', 'toString'].entries()) {
    const card = find(
      page.root,
      (element) => element.props.class === 'card' && text(element).includes(`旧题型 ${index}`)
    )
    assert.match(text(card), /科目：未知科目/)
    assert.ok(text(card).includes(`题型：${type}`))
    assert.doesNotMatch(text(card), /function|native code|科目：Object/)
  }
})

test('closing a collection dialog resets chapter and topic even when the selected subject remains math', async () => {
  const page = await mount()
  const topicInput = () => find(page.dialog(), (element) => element.tag === 'select' && !element.props.id)
  await select(page.input('eb-chapter'), '函数')
  await select(topicInput(), '极限')
  await click(page.button('取消'))
  await click(page.button('收录错题'))
  assert.equal(page.input('eb-chapter').selectedIndex, 0)
  assert.equal(topicInput().selectedIndex, 0)
  assert.equal(topicInput().options.length, 1)
  await type(page.input('eb-content'), '新题不沿用旧章节')
  await click(page.button('保存'))
  assert.equal(__errorbook.store.errorQuestions[0].chapter, '')
  await click(page.button('收录错题'))
  assert.equal(page.input('eb-chapter').selectedIndex, 0)
  assert.equal(topicInput().options.length, 1)
})

test('clearing a selected topic retains its chosen chapter in the saved question and visible card', async () => {
  const page = await mount()
  const topicInput = () => find(page.dialog(), (element) => element.tag === 'select' && !element.props.id)
  await select(page.input('eb-chapter'), '函数')
  await select(topicInput(), '极限')
  await select(topicInput(), '')
  await type(page.input('eb-content'), '保留章节的题目')
  await click(page.button('保存'))
  assert.equal(__errorbook.store.errorQuestions[0].chapter, '函数')
  const card = find(page.root, (element) => element.props.class === 'card' && text(element).includes('保留章节的题目'))
  assert.match(text(card), /章节：函数/)
  assert.doesNotMatch(text(card), /未标注章节/)
})

test('adding an image clears required feedback and permits image-only storage through the real store', async () => {
  const page = await mount()
  await click(page.button('保存'))
  assert.ok(text(page.error()).trim())
  await page.input('eb-image').props.onChange({ target: { files: [{ size: 20 }], value: 'photo.png' } })
  await settle()
  assert.equal(text(page.error()).trim(), '')
  assert.equal(page.input('eb-content').props['aria-invalid'], false)
  await click(page.button('保存'))
  assert.equal(page.dialog(), null)
  assert.equal(__errorbook.store.errorQuestions[0].content, '')
  assert.equal(__errorbook.store.errorQuestions[0].image, `r2:${'a'.repeat(64)}`)
  assert.equal(__errorbook.staged[0][2].image, `r2:${'a'.repeat(64)}`)
})

test('cancelling resets required feedback before opening a new collection dialog', async () => {
  const page = await mount()
  await click(page.button('保存'))
  await click(page.button('取消'))
  await click(page.button('收录错题'))
  assert.equal(text(page.error()).trim(), '')
  assert.equal(page.input('eb-content').props['aria-invalid'], false)
  assert.equal(__errorbook.staged.length, 0)
})
