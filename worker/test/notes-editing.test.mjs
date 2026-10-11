import test, { after, afterEach, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import { createRenderer, nextTick, reactive } from 'vue'
import { noteStorageFixture } from './note-storage-fixture.mjs'

const noteStorage = noteStorageFixture()
globalThis.indexedDB = noteStorage.indexedDB

const notesSource = await readFile('src/pages/Notes.vue', 'utf8')
const tabSource = await readFile('src/components/subject/NotesTab.vue', 'utf8')
function fragment(pattern) {
  const value = notesSource.match(pattern)?.[0]
  assert.ok(value, `the real Notes template contains ${pattern}`)
  return value
}
// Compile the relevant real controls, list, and preview; omit PDF/share/layout controls.
const notesTemplate = `<div>
  ${fragment(/<button class="btn-primary" @click="newNote">[\s\S]*?<\/button>/)}
  ${fragment(/<aside class="notes-list"[\s\S]*?<\/aside>/)}
  <template v-if="draft">
    ${fragment(/<input\s+v-model="draft.title"[\s\S]*?\/>/)}
    ${fragment(/<textarea[\s\S]*?<\/textarea>/)}
    ${fragment(/<div class="md-body" v-html="draftHtml"><\/div>/)}
    ${fragment(/<button class="btn-primary" @click="doSave\(\)">[\s\S]*?<\/button>/)}
  </template>
</div>`
function compileComponent(source, filename, templateSource) {
  const descriptor = parse(source, { filename }).descriptor
  const script = compileScript(descriptor, { id: filename, genDefaultAs: 'Page' })
  const template = compileTemplate({
    source: templateSource ?? descriptor.template.content,
    filename,
    id: filename,
    compilerOptions: { bindingMetadata: script.bindings }
  })
  assert.deepEqual(template.errors, [])
  return `${script.content}\n${template.code}\nPage.render = render; export default Page;`
}

globalThis.Document = class Document {}
globalThis.document = Object.assign(new Document(), { activeElement: null })
globalThis.window = new EventTarget()
globalThis.__notesSession = { value: { id: 'notes-user' } }
globalThis.ResizeObserver = class {
  observe() {}
  disconnect() {}
}
globalThis.MutationObserver = class {
  observe() {}
  disconnect() {}
}
globalThis.requestAnimationFrame = () => 1
globalThis.cancelAnimationFrame = () => {}
const built = await build({
  stdin: {
    contents: `export { default as NotesPage } from './src/pages/Notes.vue';
      export { default as NotesTab } from './src/components/subject/NotesTab.vue';
      export { notesActions } from './src/stores/app/notes';
      export * from './src/services/noteBodies';
      export { renderMarkdown } from './src/utils/markdown';
      export { notesMapping } from './worker/src/api/notes';`,
    resolveDir: process.cwd()
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  external: ['vue', 'katex'],
  plugins: [
    {
      name: 'notes-editing-boundaries',
      setup(builder) {
        builder.onResolve(
          {
            filter:
              /(?:stores\/app|services\/(?:auth|syncOutbox)|composables\/use(?:Toast|Confirm)|api\/(?:noteBodies|pdfs)|vue-router|@lucide\/vue)$/
          },
          ({ path }) => ({ path, namespace: 'boundary' })
        )
        builder.onResolve({ filter: /\.css$/ }, ({ path }) => ({ path, namespace: 'style' }))
        builder.onLoad({ filter: /.*/, namespace: 'style' }, () => ({ contents: '' }))
        builder.onResolve({ filter: /\.vue$/ }, ({ path }) => ({ path, namespace: 'component' }))
        builder.onLoad({ filter: /.*/, namespace: 'component' }, ({ path }) => {
          if (path.endsWith('/Notes.vue'))
            return {
              contents: compileComponent(notesSource, 'Notes.vue', notesTemplate),
              loader: 'ts',
              resolveDir: resolve('src/pages')
            }
          if (path.endsWith('/NotesTab.vue'))
            return {
              contents: compileComponent(tabSource, 'NotesTab.vue'),
              loader: 'ts',
              resolveDir: resolve('src/components/subject')
            }
          return { contents: 'export default { render: () => null };' }
        })
        builder.onLoad({ filter: /.*/, namespace: 'boundary' }, ({ path }) => {
          if (path.endsWith('stores/app'))
            return { contents: 'export const useAppStore = () => globalThis.__notesFixture.store;' }
          if (path.endsWith('services/auth'))
            return { contents: `export const sessionUser = globalThis.__notesSession;` }
          if (path.endsWith('syncOutbox'))
            return {
              contents: `export const stageUpsert = (...args) => globalThis.__notesFixture.upserts.push(JSON.parse(JSON.stringify(args)));
            export const stageDelete = () => {};`
            }
          if (path.endsWith('useToast'))
            return {
              contents: 'export const useToast = () => (message) => globalThis.__notesFixture.toasts.push(message);'
            }
          if (path.endsWith('useConfirm'))
            return {
              contents: 'export const useConfirm = () => (...args) => globalThis.__notesFixture.confirm(...args);'
            }
          if (path.endsWith('api/pdfs'))
            return {
              contents:
                'export const PDF_MAX_BYTES = 10485760, PDF_MAX_MB = 10; export const uploadPdf = async () => {}; export const fetchPdf = async () => new Uint8Array();'
            }
          if (path.endsWith('api/noteBodies'))
            return {
              contents: `export const fetchNoteBodyLimit = async () => 0;
            export const putNoteBody = async (id, content, updatedAt) => {
              globalThis.__notesFixture.remote.set(id, { id, content, updatedAt });
              return { applied: true, updatedAt, clamped: false };
            };
            export const pullNoteBodies = async (ids) => ids.map(id => globalThis.__notesFixture.remote.get(id)).filter(Boolean);`
            }
          if (path === 'vue-router')
            return {
              contents: `export const useRoute = () => globalThis.__notesFixture.route;
            const navigate = (target) => { globalThis.__notesFixture.route.query = target.query || {}; };
            export const useRouter = () => ({ replace: navigate, push: navigate });`
            }
          return {
            contents: `const Icon = { render: () => null };
          export { Icon as ArrowLeft, Icon as BookOpen, Icon as FileText, Icon as Plus, Icon as Search, Icon as Upload, Icon as CloudOff };`
          }
        })
      }
    }
  ]
})
await mkdir('.cache/notes-editing-tests', { recursive: true })
const filename = `.cache/notes-editing-tests/${crypto.randomUUID()}.mjs`
await writeFile(filename, built.outputFiles[0].text)
const {
  NotesPage,
  NotesTab,
  notesActions,
  notesMapping,
  setNoteBodyUser,
  getNoteBody,
  flushPendingNoteBodies,
  reconcileNoteBodies,
  hasVolatileNoteBodies,
  noteBodySaveState,
  retryNoteBodyStorage,
  noteConflicts,
  queueNoteBody,
  renderMarkdown
} = await import(pathToFileURL(resolve(filename)).href)
after(() => unlink(filename))

function node(tag, text = '') {
  return {
    tag,
    tagName: tag.toUpperCase(),
    text,
    props: {},
    children: [],
    parent: null,
    value: '',
    style: {},
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
  patchProp(element, key, _previous, value) {
    element.props[key] = value
    if (key === 'style') Object.assign(element.style, value)
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
function find(root, predicate) {
  if (predicate(root)) return root
  for (const child of root.children) {
    const found = find(child, predicate)
    if (found) return found
  }
  return null
}
const apps = []
async function mount(component = NotesPage, props) {
  const root = node('root'),
    app = renderer.createApp(component, props)
  apps.push(app)
  app.mount(root)
  await nextTick()
  return {
    root,
    state: app._instance.setupState,
    search: () =>
      find(
        root,
        (element) =>
          element.tag === 'input' &&
          (element.props['aria-label'] === '搜索笔记' || element.props.placeholder?.startsWith('全文检索'))
      ),
    title: () => find(root, (element) => element.props['aria-label'] === '笔记标题'),
    body: () => find(root, (element) => element.tag === 'textarea'),
    preview: () => find(root, (element) => element.props.class === 'md-body')?.props.innerHTML,
    button: (label) => find(root, (element) => element.tag === 'button' && text(element).trim() === label)
  }
}
async function type(element, value) {
  element.value = value
  element.listeners.input({ target: element })
  element.props.onInput?.({ target: element })
  await nextTick()
}
async function click(element) {
  await element.props.onClick({ stopPropagation() {} })
  await nextTick()
}
beforeEach(async () => {
  globalThis.__notesSession.value = { id: 'notes-user' }
  noteStorage.failWrite = false
  noteStorage.rows.clear()
  globalThis.__notesFixture = {
    route: reactive({ query: {} }),
    upserts: [],
    remote: new Map(),
    toasts: [],
    confirm: async () => true,
    store: reactive({
      notes: [],
      materials: [],
      subjects: [{ id: 'math', name: '数学' }],
      subjectMap: { math: { id: 'math', name: '数学' } },
      save() {},
      ...notesActions
    })
  }
  await setNoteBodyUser('notes-user')
})
afterEach(async () => {
  for (const app of apps.splice(0)) app.unmount()
  noteStorage.failWrite = false
  await retryNoteBodyStorage()
  await setNoteBodyUser(null)
})

test('session-expiry draft flush retains unsaved text and old-account metadata even when IndexedDB fails', async () => {
  const { store, upserts } = globalThis.__notesFixture
  const page = await mount()
  await click(page.button('新建笔记'))
  await type(page.title(), '过期前的草稿')
  await type(page.body(), '尚未点保存的私有正文')
  noteStorage.failWrite = true
  // forgetSession emits this synchronously while the old account still owns the editor.
  window.dispatchEvent(new Event('zsb:flush-note-drafts'))
  const id = store.notes[0].id
  globalThis.__notesSession.value = null
  store.notes = []
  apps.splice(0).forEach((app) => app.unmount())
  await setNoteBodyUser(null)
  assert.ok(upserts.some((entry) => entry[1] === id))
  assert.equal(hasVolatileNoteBodies(true), true)
  await setNoteBodyUser('other-account')
  assert.equal(getNoteBody(id), '')
  assert.equal(hasVolatileNoteBodies(), false)
  await setNoteBodyUser('notes-user')
  assert.equal(getNoteBody(id), '尚未点保存的私有正文')
  assert.equal(noteBodySaveState(id), 'memory')
  noteStorage.failWrite = false
  assert.equal(await retryNoteBodyStorage(), true)
  assert.equal(noteBodySaveState(id), 'local')
})

test('a pending delete confirmation cannot delete a same-id note in the next account', async () => {
  const { store, route } = globalThis.__notesFixture
  const id = store.saveNote({ title: 'A 的笔记', content: 'A 的正文', subjectId: 'math' })
  route.query = { id }
  const page = await mount()
  let resolveConfirm
  globalThis.__notesFixture.confirm = () =>
    new Promise((resolve) => {
      resolveConfirm = resolve
    })
  const pending = page.state.removeNote()
  globalThis.__notesSession.value = { id: 'different-account' }
  store.notes = [{ id, title: 'B 的笔记', subjectId: 'math', tags: [], updatedAt: 100, bodyUpdatedAt: 100 }]
  resolveConfirm(true)
  await pending
  assert.equal(store.notes.length, 1)
  assert.equal(store.notes[0].title, 'B 的笔记')
})

test('a remote winner preserves the overwritten local body as an account-scoped recoverable conflict', async () => {
  queueNoteBody('conflicted', '原本机正文', 100)
  globalThis.__notesFixture.remote.set('conflicted', { id: 'conflicted', content: '远端新正文', updatedAt: 200 })
  await reconcileNoteBodies([
    { id: 'conflicted', title: '冲突笔记', subjectId: 'math', tags: [], updatedAt: 200, bodyUpdatedAt: 200 }
  ])
  assert.equal(getNoteBody('conflicted'), '远端新正文')
  assert.equal(noteConflicts.value.length, 1)
  assert.equal(noteConflicts.value[0].content, '原本机正文')
  assert.equal(noteConflicts.value[0].persisted, true)
  await setNoteBodyUser('other-account')
  assert.equal(noteConflicts.value.length, 0)
  await setNoteBodyUser('notes-user')
  assert.equal(noteConflicts.value[0].content, '原本机正文')
})

test('title normalization applies to create, edit, import, and the authoritative server mapping', () => {
  const { store, upserts } = globalThis.__notesFixture
  const id = store.saveNote({ subjectId: 'math', title: '  极限  ', content: '第一行\n第二行' })
  assert.equal(store.notes[0].title, '极限')
  assert.equal(getNoteBody(id), '第一行\n第二行')
  store.saveNote({ id, subjectId: 'math', content: '第一行\n第二行' })
  assert.equal(store.notes[0].title, '极限', 'an omitted title preserves the existing title')
  store.saveNote({ id, subjectId: 'math', title: ' \t\u3000 ', content: '正文' })
  assert.equal(store.notes[0].title, '未命名')
  const blank = store.saveNote({ subjectId: 'math', title: '    ', content: '另一篇正文' })
  assert.equal(store.notes.find((note) => note.id === blank).title, '未命名')
  store.importNotes('math', [
    { title: '   ', content: '# 标题\n\n段落', tags: [] },
    { title: '  导入笔记  ', content: '原文\n下一行', tags: [] }
  ])
  assert.deepEqual(
    store.notes.slice(-2).map((note) => note.title),
    ['未命名', '导入笔记']
  )
  assert.deepEqual(
    upserts.map((entry) => entry[2].title),
    ['极限', '极限', '未命名', '未命名', '未命名', '导入笔记']
  )
  for (const [title, expected] of [
    ['  极限  ', '极限'],
    [' \t\u3000 ', '未命名'],
    ['', '未命名']
  ]) {
    const row = notesMapping.mapping.toRow('notes-user', { subjectId: 'math', title, updatedAt: 1 }, 'id')
    assert.equal(row.title, expected)
    assert.equal(notesMapping.mapping.fromRow(row).title, expected)
    assert.equal(notesMapping.mapping.fromRow({ ...row, title }).title, expected, 'legacy rows normalize on read')
  }
})

test('legacy whitespace titles remain visible in both note lists and the editor', async () => {
  const { store, route } = globalThis.__notesFixture
  const id = store.saveNote({ subjectId: 'math', title: '临时标题', content: '正文' })
  store.notes[0].title = ' \t\u3000 '
  const page = await mount()
  assert.match(text(page.root), /未命名/)
  const tab = await mount(NotesTab, { subjectId: 'math' })
  assert.match(text(tab.root), /未命名/)
  route.query = { id }
  await nextTick()
  assert.equal(page.title().value, '未命名')
  assert.equal(store.notes[0].title, ' \t\u3000 ', 'display repair does not mutate the cached record')
})

test('saving appended Markdown preserves newlines through editor, cache, push/pull, and rendered preview', async () => {
  const { store, route } = globalThis.__notesFixture
  const original = '无穷小阶的比较'
  const appended = `${original}\n\n## 补充\n- 夹逼定理的典型应用\n\n第一行\n第二行\n`
  const id = store.saveNote({ subjectId: 'math', title: '极限', content: original })
  route.query = { id }
  const page = await mount()
  assert.equal(page.body().value, original)
  await type(page.body(), appended)
  await click(page.button('保存'))
  assert.equal(getNoteBody(id), appended)
  assert.equal(page.body().value, appended)
  await new Promise((done) => setTimeout(done, 210))
  await nextTick()
  assert.equal(page.preview(), renderMarkdown(appended))
  assert.match(page.preview(), /<h2>补充<\/h2>/)
  assert.match(page.preview(), /<li>夹逼定理的典型应用<\/li>/)
  assert.match(page.preview(), /第一行<br>\n第二行/)
  const excerpt = find(page.root, (element) => element.props.class === 'notes-excerpt')
  assert.equal(text(excerpt), appended.slice(0, 50))
  assert.match(parse(notesSource).descriptor.styles[0].content, /\.notes-excerpt\s*\{[^}]*white-space:\s*pre-line;/)

  assert.deepEqual((await flushPendingNoteBodies()).failures, [])
  assert.equal(globalThis.__notesFixture.remote.get(id).content, appended)
  await setNoteBodyUser(null)
  noteStorage.rows.clear() // Simulate another device without an existing IndexedDB cache.
  await setNoteBodyUser('notes-user')
  assert.equal(getNoteBody(id), '')
  await reconcileNoteBodies(store.notes)
  assert.equal(getNoteBody(id), appended)
  page.state.backToList()
  await nextTick()
  page.state.openNote(store.notes[0])
  await nextTick()
  assert.equal(page.body().value, appended)
})

test('starting a new note clears the search, and saving it keeps the new entry visible with a normalized title', async () => {
  const { store, route } = globalThis.__notesFixture
  store.saveNote({ subjectId: 'math', title: '极限', content: '原有正文' })
  const page = await mount()
  await type(page.search(), '极限')
  await click(page.button('新建笔记'))
  assert.equal(page.search().value, '')
  assert.equal(route.query.subject, 'math')
  await type(page.title(), '    ')
  await type(page.body(), '与旧关键词无关的正文')
  await type(page.search(), '极限')
  await click(page.button('保存'))
  assert.equal(store.notes.length, 2)
  assert.equal(page.search().value, '')
  assert.equal(page.title().value, '未命名')
  assert.equal(page.state.filteredNotes.length, 2)
  assert.equal(
    page.state.filteredNotes.some((note) => note.id === route.query.id && note.title === '未命名'),
    true
  )
  await type(page.title(), '  新的笔记  ')
  await click(page.button('保存'))
  assert.equal(page.title().value, '新的笔记')
  assert.equal(store.notes.length, 2, 'editing the saved draft updates the same note')
})

test('subject note excerpts preserve source line breaks and the new-note entry clears the local search', async () => {
  const { store, route } = globalThis.__notesFixture
  const content = '无穷小阶的比较\n## 补充\n- 夹逼定理的典型应用'
  store.saveNote({ subjectId: 'math', title: '极限', content })
  const tab = await mount(NotesTab, { subjectId: 'math' })
  const excerpt = find(
    tab.root,
    (element) => typeof element.props.class === 'string' && element.props.class.includes('line-clamp-2')
  )
  assert.match(excerpt.props.class, /whitespace-pre-line/)
  assert.equal(text(excerpt), content)
  await type(tab.search(), '极限')
  await click(tab.button('+ 新建'))
  assert.equal(tab.search().value, '')
  assert.deepEqual(route.query, { new: '1', subject: 'math' })
})
