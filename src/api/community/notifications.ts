import { request } from '../client'
import type { CommunityNotification, NotificationType } from '../../types'

interface NotificationResult {
  items: CommunityNotification[]
  unreadCount: number
  unreadExcludingMuted: number
  nextCursor: string | null
  hasMore?: boolean
}

export const notificationsApi = {
  notifications: (cursor?: string | null, limit?: number, type?: NotificationType) => {
    const params = new URLSearchParams()
    if (cursor) params.set('cursor', cursor)
    if (limit) params.set('limit', String(limit))
    if (type) params.set('type', type)
    const qs = params.toString()
    return request<NotificationResult>(`/api/community/notifications${qs ? `?${qs}` : ''}`)
  },
  markRead: (id: string) => request<{ ok: boolean }>(`/api/community/notifications/${id}/read`, { method: 'PUT' }),
  markAllRead: () => request<{ ok: boolean }>('/api/community/notifications/read-all', { method: 'PUT' })
}
