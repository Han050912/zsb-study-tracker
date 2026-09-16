/**
 * community store 的 notifications 域模块：通知拉取、筛选与已读（fetchUnreadCount/
 * fetchNotifications/setNotifyFilter/markRead/markAllRead）。
 * 仅 import services/api；不 import 其他 community 域模块的 actions（跨域调用一律走 this）。
 */
import type { CommunityStoreThis } from './this-type'
import { communityApi } from '../../api/community'
import { useAppStore } from '../app'
import type { CommunityNotification, NotificationType } from '../../types'

/** 显式签名（不含 this 参数）：断开 CommunityStoreThis 与字面量推断的类型循环，原理见 stores/app/sync.ts 顶部注释 */
type NotificationsActionsShape = {
  fetchUnreadCount(): Promise<void>
  fetchNotifications(reset?: boolean): Promise<void>
  setNotifyFilter(type: '' | NotificationType): Promise<void>
  markRead(n: CommunityNotification): Promise<void>
  markAllRead(): Promise<void>
}

export const notificationsActions: NotificationsActionsShape = {
  async fetchUnreadCount(this: CommunityStoreThis) {
    const res = await communityApi.notifications(null, 1)
    this.unreadCount = res.unreadCount
    this.unreadExcludingMuted = res.unreadExcludingMuted
  },

  async fetchNotifications(this: CommunityStoreThis, reset = false) {
    if (reset) {
      this.notifications = []
      this.notifyCursor = null
      this.hasMoreNotify = true
    }
    if (!this.hasMoreNotify) return
    const res = await communityApi.notifications(this.notifyCursor, undefined, this.notifyFilter || undefined)
    const existing = new Set(this.notifications.map((n) => n.id))
    this.notifications.push(...res.items.filter((n) => !existing.has(n.id)))
    this.unreadCount = res.unreadCount
    this.unreadExcludingMuted = res.unreadExcludingMuted
    this.notifyCursor = res.nextCursor
    this.hasMoreNotify = !!res.nextCursor
  },

  /** 切换通知类型筛选（切换即重置并重新拉取） */
  async setNotifyFilter(this: CommunityStoreThis, type: '' | NotificationType) {
    if (this.notifyFilter === type) return
    this.notifyFilter = type
    await this.fetchNotifications(true)
  },

  async markRead(this: CommunityStoreThis, n: CommunityNotification) {
    if (n.isRead) return
    n.isRead = true
    this.unreadCount = Math.max(0, this.unreadCount - 1)
    const muted = useAppStore().settings.dndMutedTypes ?? []
    if (!muted.includes(n.type)) this.unreadExcludingMuted = Math.max(0, this.unreadExcludingMuted - 1)
    await communityApi.markRead(n.id)
  },

  async markAllRead(this: CommunityStoreThis) {
    await communityApi.markAllRead()
    for (const n of this.notifications) n.isRead = true
    this.unreadCount = 0
    this.unreadExcludingMuted = 0
  }
}
