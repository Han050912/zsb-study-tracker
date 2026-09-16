/**
 * community store 的 feed 域模块：动态流拉取与筛选（fetchFeed/setSort/setTag/setCategory）。
 * 仅 import services/api；不 import 其他 community 域模块的 actions（跨域调用一律走 this）。
 */
import type { CommunityStoreThis } from './this-type'
import { getErrorMessage } from '../../utils/error'
import { communityApi } from '../../api/community'

/** 动态流请求令牌：每次请求自增，返回时校验以丢弃过期的竞态响应 */
let feedTicket = 0

/** 使进行中的动态流请求结果失效（resetState 退出/切号时调用，避免旧数据写入） */
export function invalidateFeedTicket() {
  feedTicket++
}

/** 显式签名（不含 this 参数）：断开 CommunityStoreThis 与字面量推断的类型循环，原理见 stores/app/sync.ts 顶部注释 */
type FeedActionsShape = {
  fetchFeed(reset?: boolean): Promise<void>
  setSort(sort: 'latest' | 'hot'): Promise<void>
  setTag(tag: string): Promise<void>
  setCategory(category: '' | 'recommend' | 'question' | 'featured' | 'follow'): Promise<void>
}

export const feedActions: FeedActionsShape = {
  async setSort(this: CommunityStoreThis, sort: 'latest' | 'hot') {
    if (this.sort === sort && this.category !== 'recommend') return
    this.sort = sort
    if (this.category === 'recommend') this.category = '' // 推荐态下点排序退出推荐
    await this.fetchFeed(true)
  },

  async setTag(this: CommunityStoreThis, tag: string) {
    if (this.tag === tag && this.category !== 'recommend') return
    this.tag = tag
    if (this.category === 'recommend') this.category = '' // 推荐接口不接受标签，退出推荐
    await this.fetchFeed(true)
  },

  async setCategory(this: CommunityStoreThis, category: '' | 'recommend' | 'question' | 'featured' | 'follow') {
    if (this.category === category) return
    this.category = category
    await this.fetchFeed(true)
  },

  /** 拉取动态流；reset 清空重来，否则按游标追加（按 id 去重防重复）。
   *  普通流与推荐流共用同一套请求令牌：请求前自增、返回时校验，过期响应（含过期失败）
   *  一律丢弃，避免快速切换筛选后旧数据覆盖新数据、hasMore 与列表内容错位。
   *  失败写入 store.error 后**重新抛出**，交由调用方 .catch 呈现可见的失败反馈。 */
  async fetchFeed(this: CommunityStoreThis, reset = false) {
    const recommend = this.category === 'recommend'
    // 追加加载期间忽略重复触发（哨兵可见期间可能多次进入）；reset 走令牌竞态丢弃
    if (this.feedLoading && !reset) return
    // 推荐为一次性列表（无分页游标）：已有内容时重复触发直接跳过
    if (recommend && !reset && this.posts.length) return
    const ticket = ++feedTicket
    if (reset) {
      this.posts = []
      this.feedCursor = null
      this.hasMore = true
      this.recommendExtras = null
      this.error = null
    }
    if (!recommend && !this.hasMore) return
    this.feedLoading = true
    try {
      if (recommend) {
        const res = await communityApi.recommend()
        if (ticket !== feedTicket) return // 已有更新的请求，丢弃本次过期结果
        this.posts = res.posts
        this.recommendExtras = { circles: res.circles, users: res.users }
        this.hasMore = false // 推荐无分页，关闭无限滚动
      } else {
        const res = await communityApi.feed({
          sort: this.sort,
          tag: this.tag || undefined,
          type: this.category === 'question' ? 'question' : undefined,
          featured: this.category === 'featured' ? true : undefined,
          follow: this.category === 'follow' ? true : undefined,
          cursor: this.feedCursor
        })
        if (ticket !== feedTicket) return // 已有更新的请求，丢弃本次过期结果
        const existing = new Set(this.posts.map((p) => p.id))
        this.posts.push(...res.posts.filter((p) => !existing.has(p.id)))
        this.feedCursor = res.nextCursor
        this.hasMore = !!res.nextCursor
      }
      this.error = null
    } catch (e) {
      // 过期请求的失败已被更新请求取代，静默丢弃（不覆盖新请求的错误态）
      if (ticket !== feedTicket) return
      this.error = getErrorMessage(e, recommend ? '推荐加载失败' : '动态加载失败')
      throw e // 不吞异常：调用方 .catch 才能 toast
    } finally {
      if (ticket === feedTicket) this.feedLoading = false
    }
  }
}
