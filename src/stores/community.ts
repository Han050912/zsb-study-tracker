import { defineStore } from 'pinia'
import { communityApi } from '../api/community'
import { gamificationApi } from '../api/gamification'
import { useAppStore } from './app'
import type { CommunityCircle, CommunityComment, CommunityNotification, CommunityPost, NotificationType, PostType, RecommendUser } from '../types'

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
  /** 推荐附加信息（圈子 + 用户；仅 recommend 分类下填充） */
  recommendExtras: { circles: CommunityCircle[]; users: RecommendUser[] } | null
  /** 加载错误信息（推荐等场景） */
  error: string | null
  /** 当前筛选标签（'' = 全部） */
  tag: string
  /** 分类筛选（'' = 全部；推荐/提问/精华/关注 单选互斥） */
  category: '' | 'recommend' | 'question' | 'featured' | 'follow'
  notifications: CommunityNotification[]
  notifyCursor: string | null
  hasMoreNotify: boolean
  unreadCount: number
  /** 排除勿扰屏蔽类型后的未读数（勿扰红点判定用） */
  unreadExcludingMuted: number
  /** 通知中心类型筛选（'' = 全部） */
  notifyFilter: '' | NotificationType
}

export const useCommunityStore = defineStore('community', {
  state: (): CommunityState => ({
    posts: [],
    feedCursor: null,
    hasMore: true,
    feedLoading: false,
    sort: 'latest',
    recommendExtras: null,
    error: null,
    tag: '',
    category: '',
    notifications: [],
    notifyCursor: null,
    hasMoreNotify: true,
    unreadCount: 0,
    unreadExcludingMuted: 0,
    notifyFilter: ''
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
      if (this.sort === sort && this.category !== 'recommend') return
      this.sort = sort
      if (this.category === 'recommend') this.category = '' // 推荐态下点排序退出推荐
      await this.fetchFeed(true)
    },

    async setTag(tag: string) {
      if (this.tag === tag && this.category !== 'recommend') return
      this.tag = tag
      if (this.category === 'recommend') this.category = '' // 推荐接口不接受标签，退出推荐
      await this.fetchFeed(true)
    },

    async setCategory(category: '' | 'recommend' | 'question' | 'featured' | 'follow') {
      if (this.category === category) return
      this.category = category
      await this.fetchFeed(true)
    },

    /** 拉取动态流；reset 清空重来，否则按游标追加（按 id 去重防重复）。
     *  请求令牌防止竞态：旧请求返回时若令牌已失效则丢弃结果，避免快速切换筛选后旧数据覆盖新数据。 */
    async fetchFeed(reset = false) {
      if (this.category === 'recommend') {
        if (!reset && this.posts.length) return
        this.feedLoading = true
        try {
          const res = await communityApi.recommend()
          this.posts = res.posts
          this.recommendExtras = { circles: res.circles, users: res.users }
          this.error = null
          this.hasMore = false
        } catch (e: any) {
          this.error = e?.message || '推荐加载失败'
        } finally {
          this.feedLoading = false
        }
        return
      }
      // 追加加载期间忽略重复触发（哨兵可见期间可能多次进入）；reset 走令牌竞态丢弃
      if (this.feedLoading && !reset) return
      const ticket = ++feedTicket
      if (reset) {
        this.posts = []
        this.feedCursor = null
        this.hasMore = true
        this.recommendExtras = null
        this.error = null
      }
      if (!this.hasMore) return
      this.feedLoading = true
      try {
        const res = await communityApi.feed({
          sort: this.sort,
          tag: this.tag || undefined,
          type: this.category === 'question' ? 'question' : undefined,
          featured: this.category === 'featured' ? true : undefined,
          follow: this.category === 'follow' ? true : undefined,
          cursor: this.feedCursor
        })
        if (ticket !== feedTicket) return // 已有更新的请求，丢弃本次过期结果
        const existing = new Set(this.posts.map(p => p.id))
        this.posts.push(...res.posts.filter(p => !existing.has(p.id)))
        this.feedCursor = res.nextCursor
        this.hasMore = !!res.nextCursor
      } catch (e: any) {
        this.error = e?.message || '动态加载失败'
      } finally {
        if (ticket === feedTicket) this.feedLoading = false
      }
    },

    /** 发帖成功返回新帖；仅当命中当前筛选时插入列表头部（精华/关注筛选下新帖必未加精、作者非关注对象，不插入；圈子帖不进广场） */
    async publishPost(data: { type: PostType; content: string; tags: string[]; imageUrls?: string[]; circleId?: string; topicRef?: string; refType?: string; refId?: string }) {
      const post = await communityApi.createPost(data)
      // 后端返回的头像可能因云端 user_settings 同步时序缺失，用前端当前头像兜底，确保刚发出的帖子立即显示当前头像（无需刷新）
      if (!post.userAvatar) {
        const avatar = useAppStore().settings.avatar
        if (avatar) post.userAvatar = avatar
      }
      if (this.sort === 'latest' && this.category === '' && !data.circleId && !data.topicRef
        && (!this.tag || post.tags.includes(this.tag))) {
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
        // 后端点赞会反向取消踩（赞踩互斥），本地同步清除踩状态
        if (liked && p.dislikedByMe) {
          p.dislikedByMe = false
          p.dislikesCount = Math.max(0, p.dislikesCount - 1)
        }
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

    /** 帖子踩 toggle（与赞互斥），同步列表内计数；返回 { disliked, likeRevoked } */
    async dislikePost(id: string): Promise<{ disliked: boolean; likeRevoked?: boolean }> {
      const res = await communityApi.dislike('post', id)
      const p = this.posts.find(x => x.id === id)
      if (p) {
        p.dislikedByMe = res.disliked
        p.dislikesCount = Math.max(0, p.dislikesCount + (res.disliked ? 1 : -1))
        if (res.likeRevoked) {
          p.likedByMe = false
          p.likesCount = Math.max(0, p.likesCount - 1)
        }
      }
      await this.syncGamification()
      return res
    },

    /** 评论踩 toggle（与赞互斥）；返回 { disliked, likeRevoked }，详情页自行更新评论树计数 */
    async dislikeComment(id: string): Promise<{ disliked: boolean; likeRevoked?: boolean }> {
      const res = await communityApi.dislike('comment', id)
      await this.syncGamification()
      return res
    },

    /** 发表评论，返回新评论；同步列表内帖子评论数 */
    async postComment(postId: string, content: string, parentId?: string, imageUrls?: string[]): Promise<CommunityComment> {
      const c = await communityApi.addComment(postId, { content, parentId, imageUrls })
      // 后端返回的头像可能因云端 user_settings 同步时序缺失，用前端当前头像兜底，避免新评论短暂显示默认头像
      if (!c.userAvatar) {
        const avatar = useAppStore().settings.avatar
        if (avatar) c.userAvatar = avatar
      }
      const p = this.posts.find(x => x.id === postId)
      if (p) p.commentsCount++
      await this.syncGamification()
      return c
    },

    /** 采纳/取消采纳最佳答案；同步列表内帖子状态并刷新积分（提问者 +3/被采纳者 +10 由服务端发放） */
    async acceptAnswer(postId: string, commentId: string): Promise<{ acceptedAnswerId: string | null; isResolved: boolean }> {
      const res = await communityApi.acceptAnswer(postId, commentId)
      const p = this.posts.find(x => x.id === postId)
      if (p) {
        p.acceptedAnswerId = res.acceptedAnswerId ?? undefined
        p.isResolved = res.isResolved
      }
      await this.syncGamification()
      return res
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
      this.unreadExcludingMuted = res.unreadExcludingMuted
    },

    async fetchNotifications(reset = false) {
      if (reset) {
        this.notifications = []
        this.notifyCursor = null
        this.hasMoreNotify = true
      }
      if (!this.hasMoreNotify) return
      const res = await communityApi.notifications(this.notifyCursor, undefined, this.notifyFilter || undefined)
      const existing = new Set(this.notifications.map(n => n.id))
      this.notifications.push(...res.items.filter(n => !existing.has(n.id)))
      this.unreadCount = res.unreadCount
      this.unreadExcludingMuted = res.unreadExcludingMuted
      this.notifyCursor = res.nextCursor
      this.hasMoreNotify = !!res.nextCursor
    },

    /** 切换通知类型筛选（切换即重置并重新拉取） */
    async setNotifyFilter(type: '' | NotificationType) {
      if (this.notifyFilter === type) return
      this.notifyFilter = type
      await this.fetchNotifications(true)
    },

    async markRead(n: CommunityNotification) {
      if (n.isRead) return
      n.isRead = true
      this.unreadCount = Math.max(0, this.unreadCount - 1)
      const muted = useAppStore().settings.dndMutedTypes ?? []
      if (!muted.includes(n.type)) this.unreadExcludingMuted = Math.max(0, this.unreadExcludingMuted - 1)
      await communityApi.markRead(n.id)
    },

    async markAllRead() {
      await communityApi.markAllRead()
      for (const n of this.notifications) n.isRead = true
      this.unreadCount = 0
      this.unreadExcludingMuted = 0
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
    },

    async adminFeaturePost(id: string): Promise<boolean> {
      const { isFeatured } = await communityApi.adminFeaturePost(id)
      const p = this.posts.find(x => x.id === id)
      if (p) p.isFeatured = isFeatured
      return isFeatured
    },

    async adminDailyPost(id: string): Promise<boolean> {
      const { isDaily } = await communityApi.adminDailyPost(id)
      const p = this.posts.find(x => x.id === id)
      if (p) p.isDaily = isDaily
      return isDaily
    }
  }
})
