/**
 * community store 组合入口（原 src/stores/community.ts）：CommunityState、state 初始化、
 * resetState 与 syncGamification 留守于此，5 个域 actions 模块 spread 组合
 * （feed/posts/comments/notifications/admin）。
 * 对外契约不变：store id 'community'、导出 useCommunityStore、state 字段名与 action 名全部不变。
 */
import { defineStore } from 'pinia'
import { gamificationApi } from '../../api/gamification'
import { useAppStore } from '../app'
import type {
  CommunityCircle,
  CommunityNotification,
  CommunityPost,
  NotificationType,
  RecommendUser
} from '../../types'

import { feedActions, invalidateFeedTicket } from './feed'
import { postsActions } from './posts'
import { commentsActions } from './comments'
import { notificationsActions } from './notifications'
import { adminActions } from './admin'

/**
 * 社区广场状态。动态流为公共数据，通知为当前用户私有；
 * 退出登录/会话过期时由 App.vue 调用 resetState() 清空，避免串号。
 */
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
      invalidateFeedTicket() // 使进行中的请求结果失效，避免退出/切号后旧数据写入
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

    ...feedActions,
    ...postsActions,
    ...commentsActions,
    ...notificationsActions,
    ...adminActions
  }
})
