import test, { beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createPinia, setActivePinia } from 'pinia'
import { watchEffect, nextTick } from 'vue'
import { loadFrontend, deferred, settle } from './refactor-harness.mjs'
const stores = await loadFrontend()
const post = (id = 'p') => ({
  id,
  content: '高数复习',
  tags: [],
  likesCount: 3,
  dislikesCount: 1,
  commentsCount: 0,
  likedByMe: false,
  dislikedByMe: false
})
beforeEach(() => {
  setActivePinia(createPinia())
  globalThis.__refactorApi = { get: async () => ({}) }
})

test('新建 feed / squad 缓存保持响应式，首屏从加载态更新为实体列表', async () => {
  const feed = stores.useCommunityFeedStore(),
    squads = stores.useSquadStore(),
    f = deferred(),
    s = deferred()
  globalThis.__refactorApi.feed = () => f.promise
  globalThis.__refactorApi.getTeams = () => s.promise
  let feedView, squadView
  const stopFeed = watchEffect(() => {
    feedView = [feed.bucket.status, feed.posts.length]
  })
  const stopSquads = watchEffect(() => {
    squadView = [squads.bucket?.loading, squads.teams.length]
  })
  const jobs = [feed.fetchFeed(true), squads.loadList()]
  await nextTick()
  assert.deepEqual(feedView, ['initial-loading', 0])
  assert.deepEqual(squadView, [true, 0])
  f.resolve({ posts: [post()], nextCursor: null })
  s.resolve({ teams: [{ id: 'team' }], nextCursor: null })
  await Promise.all(jobs)
  await nextTick()
  assert.deepEqual(feedView, ['ready', 1])
  assert.deepEqual(squadView, [false, 1])
  stopFeed()
  stopSquads()
})

test('账号切换后评论/管理请求不回写新账号实体', async () => {
  const store = stores.usePostStore(),
    request = deferred()
  store.upsert([post()])
  globalThis.__refactorApi.addComment = () => request.promise
  const job = store.postComment('p', '旧账号的评论')
  store.resetState()
  store.upsert([post()])
  request.resolve({ id: 'comment', postId: 'p', userId: 'old' })
  await assert.rejects(job, /登录状态已改变/)
  assert.equal(store.postsById.p.commentsCount, 0)
})

test('feed: 20 次切换丢弃旧响应和旧失败，保留最后的筛选', async () => {
  const requests = Array.from({ length: 20 }, deferred),
    feed = stores.useCommunityFeedStore()
  let i = 0
  globalThis.__refactorApi.feed = () => requests[i++].promise
  const jobs = requests.map((_, index) =>
    feed.select({ category: '', sort: 'latest', tag: String(index), keyword: '' })
  )
  requests[19].resolve({ posts: [post('new')], nextCursor: null })
  await jobs[19]
  for (let index = 0; index < 19; index++) {
    if (index % 2) requests[index].reject(new Error('old failure'))
    else requests[index].resolve({ posts: [post('old')], nextCursor: 'old' })
  }
  await Promise.all(jobs)
  assert.deepEqual(
    feed.posts.map((p) => p.id),
    ['new']
  )
  assert.equal(feed.error, '')
  assert.equal(feed.feedLoading, false)
})
test('feed: 同一 bucket 的旧 finally 不清除最新加载状态，更多失败保留已有内容', async () => {
  const feed = stores.useCommunityFeedStore(),
    first = deferred(),
    second = deferred()
  let count = 0
  globalThis.__refactorApi.feed = () => (++count === 1 ? first.promise : second.promise)
  const a = feed.fetchFeed(true),
    b = feed.fetchFeed(true)
  first.resolve({ posts: [post('old')], nextCursor: null })
  await a
  assert.equal(feed.feedLoading, true)
  second.resolve({ posts: [post()], nextCursor: 'next' })
  await b
  globalThis.__refactorApi.feed = async () => {
    throw new Error('下一页失败')
  }
  await feed.fetchFeed(false)
  assert.equal(feed.posts.length, 1)
  assert.equal(feed.bucket.initialError, '')
  assert.equal(feed.bucket.loadMoreError, '下一页失败')
})
test('posts: 乐观赞踩互斥、重复点击单飞、失败仅回滚投票字段', async () => {
  const entities = stores.usePostStore(),
    request = deferred()
  let calls = 0
  entities.upsert([{ ...post(), dislikedByMe: true }])
  const reference = entities.postsById.p
  globalThis.__refactorApi.toggleLike = () => {
    calls++
    return request.promise
  }
  const pending = entities.likePost('p')
  assert.equal(reference.likesCount, 4)
  assert.equal(reference.dislikesCount, 0)
  await entities.likePost('p')
  assert.equal(calls, 1)
  entities.upsert([{ ...post(), commentsCount: 10 }])
  assert.equal(entities.postsById.p, reference)
  assert.equal(reference.likesCount, 4)
  request.reject(new Error('拒绝'))
  await assert.rejects(pending)
  assert.equal(reference.likesCount, 3)
  assert.equal(reference.dislikedByMe, true)
  assert.equal(reference.commentsCount, 10)
})
test('posts/feed: 详情和列表引用同一实体，退出后旧请求不写回', async () => {
  const entities = stores.usePostStore(),
    feed = stores.useCommunityFeedStore()
  globalThis.__refactorApi.feed = async () => ({ posts: [post()], nextCursor: null })
  await feed.fetchFeed(true)
  const reference = feed.posts[0]
  entities.upsert([{ ...post(), commentsCount: 4 }])
  assert.equal(feed.posts[0], reference)
  assert.equal(reference.commentsCount, 4)
  const pending = deferred()
  globalThis.__refactorApi.feed = () => pending.promise
  const job = feed.fetchFeed(true)
  feed.resetState()
  entities.resetState()
  pending.resolve({ posts: [post('previous-user')], nextCursor: null })
  await job
  assert.equal(feed.posts.length, 0)
  assert.equal(Object.keys(entities.postsById).length, 0)
})
test('partners: 五个页面共用一次请求，缓存与账号隔离', async () => {
  const partners = stores.usePartnerStore(),
    pending = deferred()
  let calls = 0
  globalThis.__refactorApi.partners = () => {
    calls++
    return pending.promise
  }
  const jobs = Array.from({ length: 5 }, () => partners.load())
  pending.resolve({ partners: [{ userId: 'peer', reqId: 'r' }], incoming: [] })
  await Promise.all(jobs)
  await partners.load()
  assert.equal(calls, 1)
  assert.equal(partners.partners[0], partners.partnersById.peer)
  const old = deferred()
  globalThis.__refactorApi.partners = () => old.promise
  const job = partners.load(true)
  partners.resetState()
  old.resolve({ partners: [{ userId: 'old' }], incoming: [] })
  await job
  assert.equal(partners.partners.length, 0)
})
test('squads: 五个挑战只调用一次批量同步，审批只刷新相关区域', async () => {
  const squads = stores.useSquadStore()
  let batchCalls = 0
  const sections = []
  globalThis.__refactorApi.getTeamDetail = async (id, _invite, section) => {
    sections.push(section)
    return {
      team: { id, memberCount: 1, myRole: 'leader' },
      members: [],
      challenges: Array.from({ length: 5 }, (_, i) => ({ id: 'c' + i, status: 'active' }))
    }
  }
  globalThis.__refactorApi.getTeamRequests = async () => [{ userId: 'peer', userName: '同学' }]
  globalThis.__refactorApi.syncActiveChallenges = async () => {
    batchCalls++
    return { challenges: [{ id: 'c0', myProgress: 4, status: 'active' }] }
  }
  await squads.loadDetail('team')
  await settle()
  await squads.sync('team')
  assert.equal(batchCalls, 1)
  assert.equal(squads.detail('team').challenges[0], squads.challengesById.c0)
  squads.reviewed('team', 'peer', true)
  await settle()
  assert.deepEqual(sections, [undefined, 'members'])
})
test('study: 轮询失败退避且提示离线，联网后恢复，同会话无叠加请求', async (t) => {
  globalThis.window = new EventTarget()
  globalThis.document = Object.assign(new EventTarget(), { hidden: false })
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true })
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  const timer = stores.useStudyTimerStore()
  let calls = 0,
    fail = true
  globalThis.__refactorApi.updateStudySession = async () => {
    calls++
    if (fail) throw new Error('offline')
    return { session: { status: 'active', partnerState: 'focus', partnerMinutes: 2 } }
  }
  timer.enterSession({ id: 'session', myState: 'focus' })
  t.mock.timers.tick(0)
  await settle()
  assert.equal(timer.connection, 'reconnecting')
  t.mock.timers.tick(20_000)
  await settle()
  t.mock.timers.tick(40_000)
  await settle()
  assert.equal(timer.connection, 'offline')
  assert.equal(calls, 3)
  fail = false
  timer.reconnect()
  t.mock.timers.tick(0)
  await settle()
  assert.equal(timer.connection, 'connected')
  timer.finishSession()
  t.mock.timers.reset()
  assert.equal(stores.pollingDelay(0, true), 30_000)
  assert.equal(stores.pollingDelay(9, false), 60_000)
})
