import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { readFile, mkdir, writeFile, unlink } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { reactive, ref, nextTick } from 'vue'
import { deferred, settle } from './refactor-harness.mjs'

async function load(file, names, t) {
  globalThis.__materialRoute = reactive({ params: { id: 'owner' } })
  globalThis.__materialUser = ref({ id: 'visitor' })
  globalThis.__materialHooks = []
  globalThis.__materialApi = {}
  globalThis.__materialStore = reactive({
    materials: [],
    subjects: [
      { id: 'math', name: '高数' },
      { id: 'en', name: '英语' }
    ],
    get subjectMap() {
      return Object.fromEntries(this.subjects.map((s) => [s.id, s]))
    },
    saved: 0,
    updateMaterial(id, patch) {
      Object.assign(
        this.materials.find((m) => m.id === id),
        patch
      )
      this.saved++
    }
  })
  const source = (await readFile(file, 'utf8')).match(/<script setup[^>]*>([\s\S]*?)<\/script>/)[1]
  const result = await build({
    stdin: {
      contents: source + `\nexport { ${names.join(',')} };`,
      resolveDir: `${process.cwd()}/${file.split('/').slice(0, -1).join('/')}`,
      loader: 'ts'
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    plugins: [
      {
        name: 'material-ui-boundaries',
        setup(b) {
          b.onResolve({ filter: /\.vue$/ }, () => ({ path: 'component', namespace: 'boundary' }))
          b.onResolve({ filter: /^vue$/ }, (args) =>
            args.namespace === 'boundary'
              ? { path: args.path, external: true }
              : { path: args.path, namespace: 'boundary' }
          )
          b.onResolve(
            {
              filter:
                /(?:vue-router|@lucide\/vue|stores\/app|stores\/app\/sync|services\/auth|api\/community\/users|composables\/(?:useToast|useConfirm|useBack))$/
            },
            ({ path }) => ({ path, namespace: 'boundary' })
          )
          b.onLoad({ filter: /.*/, namespace: 'boundary' }, ({ path }) => ({
            contents:
              path === 'component'
                ? 'export default {}'
                : path === 'vue'
                  ? `export {ref,computed,watch} from 'vue'; export const onUnmounted=(fn)=>globalThis.__materialHooks.push(fn);`
                  : path === 'vue-router'
                    ? `export const useRoute=()=>globalThis.__materialRoute;`
                    : path === '@lucide/vue'
                      ? `export const Bookmark={},ArrowUpRight={},TriangleAlert={},ArrowLeft={};`
                      : path.endsWith('/app')
                        ? `export const useAppStore=()=>globalThis.__materialStore;`
                        : path.endsWith('/sync')
                          ? `export const MAX_FIELD_CHARS=1000000;`
                          : path.endsWith('/auth')
                            ? `export const sessionUser=globalThis.__materialUser;`
                            : path.endsWith('/users')
                              ? `export const usersApi={ profile:(id)=>globalThis.__materialApi.profile(id), stats:(id)=>globalThis.__materialApi.stats(id) };`
                              : path.endsWith('/useToast')
                                ? `export const useToast=()=>()=>{};`
                                : path.endsWith('/useBack')
                                  ? `export const useBack=()=>({goBack(){}});`
                                  : `export const useConfirm=()=>async()=>true;`
          }))
        }
      }
    ]
  })
  await mkdir('.cache/material-tests', { recursive: true })
  const filename = `${process.cwd()}/.cache/material-tests/${crypto.randomUUID()}.mjs`
  // Profile starts loading in its immediate watcher during module evaluation.
  globalThis.__materialApi.profile = async (id) => ({ userId: id, learningStatsPrivate: false })
  globalThis.__materialApi.stats = async () => ({
    heatmap: [],
    totalStudy: { minutes: 0 },
    monthStudy: { minutes: 0 },
    problems: {}
  })
  await writeFile(filename, result.outputFiles[0].text)
  const module = await import(pathToFileURL(filename).href)
  await unlink(filename)
  t.after(() => {
    for (const hook of __materialHooks) hook()
  })
  await settle()
  return module
}
const tick = async () => {
  await nextTick()
  await settle()
}

test('资料搜索覆盖标题、作者、科目和笔记，能和类型/科目/收藏筛选组合及清除', async (t) => {
  const page = await load(
    'src/pages/Materials.vue',
    ['list', 'keyword', 'filterType', 'filterSubject', 'onlyFavorites', 'clearFilters', 'hasFilter'],
    t
  )
  __materialStore.materials = [
    { id: 'math', title: '教材', type: 'book', author: 'Teacher', subjectId: 'math', notes: '微积分', favorite: true },
    { id: 'en', title: '英语视频', type: 'video', subjectId: 'en', favorite: false }
  ]
  for (const keyword of ['高数', ' teacher ', '微积分', '教材']) {
    page.keyword.value = keyword
    assert.deepEqual(
      page.list.value.map((m) => m.id),
      ['math']
    )
  }
  page.filterType.value = 'video'
  assert.deepEqual(page.list.value, [])
  page.clearFilters()
  assert.equal(page.hasFilter.value, false)
  assert.equal(page.list.value.length, 2)
  page.onlyFavorites.value = true
  assert.deepEqual(
    page.list.value.map((m) => m.id),
    ['math']
  )
  page.filterSubject.value = 'en'
  assert.deepEqual(page.list.value, [])
  page.clearFilters()
  assert.equal(page.onlyFavorites.value, true)
  assert.deepEqual(
    page.list.value.map((m) => m.id),
    ['math']
  )
})

test('收藏动作使用已有持久化更新路径，收藏夹即时刷新，编辑中的收藏值保持一致', async (t) => {
  const page = await load(
    'src/pages/Materials.vue',
    ['list', 'onlyFavorites', 'favoriteCount', 'toggleFavorite', 'open', 'form'],
    t
  )
  __materialStore.materials = [{ id: 'm', title: '高数教材', type: 'book', priority: '中' }]
  const material = __materialStore.materials[0]
  page.open(material)
  page.onlyFavorites.value = true
  assert.equal(page.list.value.length, 0)
  page.toggleFavorite(material)
  assert.equal(page.list.value.length, 1)
  assert.equal(page.favoriteCount.value, 1)
  assert.equal(page.form.value.favorite, true)
  page.toggleFavorite(material)
  assert.equal(page.list.value.length, 0)
  assert.equal(page.form.value.favorite, false)
  assert.equal(__materialStore.saved, 2)
})

test('主页切换用户时清空选中日期，慢的上一用户统计不覆盖新用户公开时长', async (t) => {
  const page = await load(
    'src/pages/ProfilePage.vue',
    ['profile', 'stats', 'heatDate', 'heatMinutes', 'loading', 'loadAll'],
    t
  )
  const stale = deferred()
  __materialApi.profile = async (id) => ({ userId: id, learningStatsPrivate: false })
  __materialApi.stats = (id) =>
    id === 'owner'
      ? stale.promise
      : Promise.resolve({
          heatmap: [{ date: '2026-10-05', minutes: 30 }],
          totalStudy: { minutes: 30 },
          monthStudy: { minutes: 30 }
        })
  const pending = page.loadAll()
  await tick()
  page.heatDate.value = '2026-10-04'
  __materialRoute.params.id = 'peer'
  await tick()
  assert.equal(page.heatDate.value, '')
  assert.equal(page.profile.value.userId, 'peer')
  page.heatDate.value = '2026-10-05'
  assert.equal(page.heatMinutes.value, 30)
  stale.resolve({ heatmap: [{ date: '2026-10-05', minutes: 99 }] })
  await pending
  assert.equal(page.heatMinutes.value, 30)
  page.heatDate.value = '2026-10-04'
  assert.equal(page.heatMinutes.value, 0)
})

test('账号切换撤回本人统计可见性，迟到的本人请求不再显示私有学习数据', async (t) => {
  const page = await load('src/pages/ProfilePage.vue', ['stats', 'heatDate', 'canViewLearningStats', 'loadAll'], t)
  const pendingStats = deferred()
  __materialUser.value = { id: 'owner' }
  __materialApi.profile = async (id) => ({ userId: id, learningStatsPrivate: __materialUser.value?.id !== id })
  __materialApi.stats = () => pendingStats.promise
  await tick()
  __materialUser.value = { id: 'visitor' }
  await tick()
  pendingStats.resolve({ heatmap: [{ date: '2026-10-05', minutes: 99 }] })
  await tick()
  assert.equal(page.canViewLearningStats.value, false)
  assert.equal(page.stats.value, null)
  assert.equal(page.heatDate.value, '')
})

test('资料打开动作使用带 UTF-8 声明的真实 Blob，保留普通链接与延迟回收路径', async (t) => {
  const page = await load('src/pages/Materials.vue', ['openLink'], t)
  const blobs = [],
    opened = [],
    timers = [],
    revoked = []
  globalThis.window = { open: (...args) => opened.push(args) }
  t.mock.method(URL, 'createObjectURL', (blob) => {
    blobs.push(blob)
    return 'blob:material-utf8'
  })
  t.mock.method(URL, 'revokeObjectURL', (url) => revoked.push(url))
  t.mock.method(globalThis, 'setTimeout', (callback, delay) => {
    timers.push({ callback, delay })
    return 1
  })
  const content = '高数教材：学习与复习'
  // 旧附件只存有通用 MIME；实际打开动作必须把 fileName 传给 Blob 路径。
  page.openLink(`data:application/octet-stream;base64,${Buffer.from(content).toString('base64')}`, '中文资料.txt')
  assert.equal(blobs[0].type, 'text/plain;charset=utf-8')
  assert.equal(await blobs[0].text(), content)
  assert.deepEqual(opened[0], ['blob:material-utf8', '_blank', 'noopener,noreferrer'])
  assert.equal(timers[0].delay, 60_000)
  assert.equal(revoked.length, 0)
  timers[0].callback()
  assert.deepEqual(revoked, ['blob:material-utf8'])
  page.openLink('https://example.com/study.pdf')
  assert.deepEqual(opened[1], ['https://example.com/study.pdf', '_blank', 'noopener,noreferrer'])
  assert.equal(blobs.length, 1)
})
