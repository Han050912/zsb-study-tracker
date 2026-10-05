import { defineStore } from 'pinia'
import { notificationsApi } from '../../api/community/notifications'
import { useAppStore } from '../app'
import type { CommunityNotification, NotificationType } from '../../types'

export const useNotificationStore = defineStore('community-notifications', {
  state: () => ({
    notifications: [] as CommunityNotification[],
    notifyCursor: null as string | null,
    hasMoreNotify: true,
    unreadCount: 0,
    unreadExcludingMuted: 0,
    notifyFilter: '' as '' | NotificationType,
    generation: 0,
    ticket: 0,
    unreadTicket: 0,
    pendingReadIds: [] as string[],
    readingAll: false
  }),
  actions: {
    resetState() {
      const generation = this.generation + 1
      this.$reset()
      this.generation = generation
    },
    async fetchUnreadCount() {
      const generation = this.generation,
        ticket = ++this.unreadTicket
      const res = await notificationsApi.notifications(null, 1)
      if (generation !== this.generation || ticket !== this.unreadTicket) return
      this.unreadCount = res.unreadCount
      this.unreadExcludingMuted = res.unreadExcludingMuted
    },
    async fetchNotifications(reset = false) {
      if (!reset && !this.hasMoreNotify) return
      const generation = this.generation,
        ticket = ++this.ticket
      const res = await notificationsApi.notifications(
        reset ? null : this.notifyCursor,
        undefined,
        this.notifyFilter || undefined
      )
      if (generation !== this.generation || ticket !== this.ticket) return
      const ids = new Set(reset ? [] : this.notifications.map((n) => n.id))
      this.notifications = [...(reset ? [] : this.notifications), ...res.items.filter((n) => !ids.has(n.id))]
      this.notifyCursor = res.nextCursor
      this.hasMoreNotify = !!res.nextCursor
      this.unreadCount = res.unreadCount
      this.unreadExcludingMuted = res.unreadExcludingMuted
    },
    async setNotifyFilter(type: '' | NotificationType) {
      this.notifyFilter = type
      await this.fetchNotifications(true)
    },
    async markRead(n: CommunityNotification) {
      if (n.isRead || this.readingAll || this.pendingReadIds.includes(n.id)) return
      const generation = this.generation
      this.pendingReadIds.push(n.id)
      this.ticket++
      this.unreadTicket++
      try {
        await notificationsApi.markRead(n.id)
        if (generation !== this.generation) return
        this.ticket++
        this.unreadTicket++
        const current = this.notifications.find((item) => item.id === n.id) ?? n
        const wasUnread = !current.isRead
        n.isRead = current.isRead = true
        if (wasUnread) {
          this.unreadCount = Math.max(0, this.unreadCount - 1)
          if (!(useAppStore().settings.dndMutedTypes ?? []).includes(n.type))
            this.unreadExcludingMuted = Math.max(0, this.unreadExcludingMuted - 1)
        }
      } finally {
        if (generation === this.generation) this.pendingReadIds = this.pendingReadIds.filter((id) => id !== n.id)
      }
    },
    async markAllRead() {
      if (this.readingAll) return
      const generation = this.generation
      this.readingAll = true
      this.ticket++
      this.unreadTicket++
      try {
        await notificationsApi.markAllRead()
        if (generation !== this.generation) return
        this.ticket++
        this.unreadTicket++
        for (const n of this.notifications) n.isRead = true
        this.unreadCount = 0
        this.unreadExcludingMuted = 0
      } finally {
        if (generation === this.generation) this.readingAll = false
      }
    }
  }
})
