import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { readFile, mkdir, writeFile, unlink } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const root = process.cwd()
const source = (await readFile('src/pages/AdminReports.vue', 'utf8')).match(
  /<script setup[^>]*>([\s\S]*?)<\/script>/
)[1]
const code = await build({
  stdin: {
    contents:
      source +
      '\nexport { load, loadFeedback, reports, reportsHasMore, reportsLoadingMore, reportsMoreError, feedbacks, feedbackFilter, feedbackLoading, feedbackLoadingMore };',
    resolveDir: root + '/src/pages',
    loader: 'ts'
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  plugins: [
    {
      name: 'admin-view-boundaries',
      setup(builder) {
        builder.onResolve(
          {
            filter:
              /\.vue$|^@lucide\/vue$|^vue-router$|^vue$|api\/community(?:\/moderation)?$|api\/feedback$|composables\/(?:useToast|useBack)$/
          },
          (args) => {
            if (args.namespace === 'mock' && args.path === 'vue') return { path: 'vue', external: true }
            return { path: args.path, namespace: 'mock' }
          }
        )
        builder.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path }) => {
          if (path === 'vue')
            return { contents: "export { ref } from 'vue'; export const onMounted=()=>{},onBeforeUnmount=()=>{};" }
          if (path === '@lucide/vue') return { contents: 'export const Check={},Undo2={},ArrowLeft={},ArrowRight={};' }
          if (path === 'vue-router') return { contents: 'export const useRouter=()=>({push(){}});' }
          if (path.endsWith('/moderation'))
            return {
              contents: 'export const moderationApi={adminReports:(...args)=>globalThis.__adminApi.reports(...args)};'
            }
          if (path.endsWith('/feedback'))
            return {
              contents: 'export const feedbackApi={adminList:(...args)=>globalThis.__adminApi.feedback(...args)};'
            }
          if (path.endsWith('/community')) return { contents: 'export const imageUrl=u=>u;' }
          if (path.endsWith('/useToast')) return { contents: 'export const useToast=()=>()=>{};' }
          if (path.endsWith('/useBack')) return { contents: 'export const useBack=()=>({goBack(){}});' }
          return { contents: 'export default {};' }
        })
      }
    }
  ]
})
async function fresh() {
  await mkdir('.cache/admin-pagination', { recursive: true })
  const file = `.cache/admin-pagination/${crypto.randomUUID()}.mjs`
  await writeFile(file, code.outputFiles[0].text)
  const app = await import(pathToFileURL(root + '/' + file).href)
  await unlink(file)
  return app
}
function deferred() {
  let resolve
  return {
    promise: new Promise((r) => {
      resolve = r
    }),
    resolve: (value) => resolve(value)
  }
}

test('管理员举报追加去重且快速连续加载仅发一次请求', async () => {
  const app = await fresh(),
    more = deferred(),
    cursors = []
  globalThis.__adminApi = {
    reports(cursor) {
      cursors.push(cursor)
      return cursor ? more.promise : Promise.resolve({ reports: [{ id: 'one' }], hasMore: true, nextCursor: 'c1' })
    }
  }
  await app.load()
  const first = app.load(false),
    repeated = app.load(false)
  assert.equal(app.reportsLoadingMore.value, true)
  more.resolve({ reports: [{ id: 'one' }, { id: 'two' }], hasMore: false, nextCursor: null })
  await Promise.all([first, repeated])
  assert.deepEqual(cursors, [undefined, 'c1'])
  assert.deepEqual(
    app.reports.value.map((r) => r.id),
    ['one', 'two']
  )
  assert.equal(app.reportsHasMore.value, false)
  assert.equal(app.reportsLoadingMore.value, false)
})

test('管理员举报后页失败保留数据和游标，重试使用同一游标', async () => {
  const app = await fresh(),
    cursors = []
  let fail = true
  globalThis.__adminApi = {
    async reports(cursor) {
      cursors.push(cursor)
      if (!cursor) return { reports: [{ id: 'one' }], hasMore: true, nextCursor: 'c1' }
      if (fail) throw new Error('测试网络离线')
      return { reports: [{ id: 'two' }], hasMore: false, nextCursor: null }
    }
  }
  await app.load()
  await app.load(false)
  assert.deepEqual(
    app.reports.value.map((r) => r.id),
    ['one']
  )
  assert.equal(app.reportsHasMore.value, true)
  assert.match(app.reportsMoreError.value, /离线/)
  fail = false
  await app.load(false)
  assert.deepEqual(cursors, [undefined, 'c1', 'c1'])
  assert.deepEqual(
    app.reports.value.map((r) => r.id),
    ['one', 'two']
  )
  assert.equal(app.reportsMoreError.value, '')
})

test('管理员反馈切换筛选重置游标，旧分页迟到响应不覆盖新结果或加载状态', async () => {
  const app = await fresh(),
    oldMore = deferred(),
    newFilter = deferred(),
    calls = []
  globalThis.__adminApi = {
    feedback(status, cursor) {
      calls.push([status, cursor])
      if (status === 'resolved') return newFilter.promise
      if (cursor) return oldMore.promise
      return Promise.resolve({ feedbacks: [{ id: 'all-one' }], hasMore: true, nextCursor: 'all-c1' })
    }
  }
  await app.loadFeedback()
  const previous = app.loadFeedback(false)
  app.feedbackFilter.value = 'resolved'
  const current = app.loadFeedback()
  oldMore.resolve({ feedbacks: [{ id: 'all-two' }], hasMore: false, nextCursor: null })
  await previous
  assert.equal(app.feedbackLoading.value, true)
  newFilter.resolve({ feedbacks: [{ id: 'resolved' }], hasMore: false, nextCursor: null })
  await current
  assert.deepEqual(calls, [
    [undefined, undefined],
    [undefined, 'all-c1'],
    ['resolved', undefined]
  ])
  assert.deepEqual(
    app.feedbacks.value.map((f) => f.id),
    ['resolved']
  )
  assert.equal(app.feedbackLoading.value, false)
  assert.equal(app.feedbackLoadingMore.value, false)
})
