import { defineStore } from 'pinia'
import { communityApi } from '../api/community'
import { gamificationApi } from '../api/gamification'
import { useAppStore } from './app'
import type { CommunityComment, CommunityNotification, CommunityPost, PostType } from '../types'

/**
 * 社区广场状态。动态流为公共数据，通知为当前用户私有；
 * 退出登录/会话过期时由 App.vue 调用 resetState() 清空，避免串号。
 */
/** 动态流请求令牌：每次请求自增，返回时校验以丢弃过期的竞态响应 */
let feedTicket = 0

interface CommunityState {
  posts: CommunityPost[]
  feedCursor: string | null
  hasMore: boolean
  feedLoading: boolean
  sort: 'latest' | 'hot'
  /** 当前筛选标签（'' = 全部） */
  tag: string
  notifications: CommunityNotification[]
  notifyCursor: string | null
  hasMoreNotify: boolean
  unreadCount: number
}

export const useCommunityStore = defineStore('community', {
  state: (): CommunityState => ({
    posts: [],
    feedCursor: null,
    hasMore: true,
    feedLoading: false,
    sort: 'latest',
    tag: '',
    notifications: [],
    notifyCursor: null,
    hasMoreNotify: true,
    unreadCount: 0
  }),

  actions: {
    resetState() {
      feedTicket++ // 使进行中的请求结果失效，避免退出/切号后旧数据写入
      this.$reset()
    },

    /**
     * 社区行为积分由服务端写入 gamification + points_log；
     * 前端拉回最新值，避免后续全量同步用本地旧状态覆盖云端积分。
     */
    async syncGamification() {
      try {
        const g = await gamificationApi.get()
        useAppStore().$patch({ gamification: g })
      } catch (e) {
        console.error('同步积分失败', e)
      }
    },

    async setSort(sort: 'latest' | 'hot') {
      if (this.sort === sort) return
      this.sort = sort
      await this.fetchFeed(true)
    },

    async setTag(tag: string) {
      if (this.tag === tag) return
      this.tag = tag
      await this.fetchFeed(true)
    },

    /** 拉取动态流；reset 清空重来，否则按游标追加（按 id 去重防重复）。
     *  请求令牌防止竞态：旧请求返回时若令牌已失效则丢弃结果，避免快速切换筛选后旧数据覆盖新数据。 */
    async fetchFeed(reset = false) {
      // 追加加载期间忽略重复触发（哨兵可见期间可能多次进入）；reset 走令牌竞态丢弃
      if (this.feedLoading && !reset) return
      const ticket = ++feedTicket
      if (reset) {
        this.posts = []
        this.feedCursor = null
        this.hasMore = true
      }
      if (!this.hasMore) return
      this.feedLoading = true
      try {
        const res = await communityApi.feed({
          sort: this.sort, tag: this.tag || undefined, cursor: this.feedCursor
        })
        if (ticket !== feedTicket) return // 已有更新的请求，丢弃本次过期结果
        const existing = new Set(this.posts.map(p => p.id))
        this.posts.push(...res.posts.filter(p => !existing.has(p.id)))
        this.feedCursor = res.nextCursor
        this.hasMore = !!res.nextCursor
      } finally {
        if (ticket === feedTicket) this.feedLoading = false
      }
    },

    /** 发帖成功返回新帖；仅当命中当前筛选时插入列表头部 */
    async publishPost(data: { type: PostType; content: string; tags: string[]; refType?: string; refId?: string }) {
      const post = await communityApi.createPost(data)
      if (this.sort === 'latest' && (!this.tag || post.tags.includes(this.tag))) {
        this.posts.unshift(post)
      }
      await this.syncGamification()
      return post
    },

    async removePost(id: string) {
      await communityApi.deletePost(id)
      this.posts = this.posts.filter(p => p.id !== id)
    },

    /** 帖子点赞 toggle，同步更新列表内计数；返回最新点赞态 */
    async likePost(id: string): Promise<boolean> {
      const { liked } = await communityApi.toggleLike('post', id)
      const p = this.posts.find(x => x.id === id)
      if (p) {
        p.likedByMe = liked
        p.likesCount = Math.max(0, p.likesCount + (liked ? 1 : -1))
      }
      await this.syncGamification()
      return liked
    },

    /** 评论点赞 toggle（详情页自行更新评论树计数） */
    async likeComment(id: string): Promise<boolean> {
      const { liked } = await communityApi.toggleLike('comment', id)
      await this.syncGamification()
      return liked
    },

    /** 发表评论，返回新评论；同步列表内帖子评论数 */
    async postComment(postId: string, content: string, parentId?: string): Promise<CommunityComment> {
      const c = await communityApi.addComment(postId, { content, parentId })
      const p = this.posts.find(x => x.id === postId)
      if (p) p.commentsCount++
      await this.syncGamification()
      return c
    },

    /** 删除评论；removed 为级联删除的总条数（含二级回复），用于回退计数 */
    async removeComment(id: string, postId: string, removed: number) {
      await communityApi.deleteComment(id)
      const p = this.posts.find(x => x.id === postId)
      if (p) p.commentsCount = Math.max(0, p.commentsCount - removed)
    },

    async fetchUnreadCount() {
      const res = await communityApi.notifications(null, 1)
      this.unreadCount = res.unreadCount
    },

    async fetchNotifications(reset = false) {
      if (reset) {
        this.notifications = []
        this.notifyCursor = null
        this.hasMoreNotify = true
      }
      if (!this.hasMoreNotify) return
      const res = await communityApi.notifications(this.notifyCursor)
      const existing = new Set(this.notifications.map(n => n.id))
      this.notifications.push(...res.items.filter(n => !existing.has(n.id)))
      this.unreadCount = res.unreadCount
      this.notifyCursor = res.nextCursor
      this.hasMoreNotify = !!res.nextCursor
    },

    async markRead(n: CommunityNotification) {
      if (n.isRead) return
      n.isRead = true
      this.unreadCount = Math.max(0, this.unreadCount - 1)
      await communityApi.markRead(n.id)
    },

    async markAllRead() {
      await communityApi.markAllRead()
      for (const n of this.notifications) n.isRead = true
      this.unreadCount = 0
    },

    // ---- 管理员操作 ----

    async adminPinPost(id: string): Promise<boolean> {
      const { isPinned } = await communityApi.adminPinPost(id)
      const p = this.posts.find(x => x.id === id)
      if (p) p.isPinned = isPinned
      return isPinned
    },

    async adminHidePost(id: string): Promise<boolean> {
      const { isHidden } = await communityApi.adminHidePost(id)
      const p = this.posts.find(x => x.id === id)
      if (p) p.isHidden = isHidden
      return isHidden
    },

    async adminHideComment(id: string): Promise<boolean> {
      const { isHidden } = await communityApi.adminHideComment(id)
      return isHidden
    }
  }
})
