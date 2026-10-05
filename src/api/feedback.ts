import { request } from './client'
import type { Feedback, FeedbackStatus, FeedbackType } from '../types'

export const feedbackApi = {
  create: (data: { type: FeedbackType; content: string; contact?: string; imageUrls?: string[] }) =>
    request<{ id: string }>('/api/feedback', { method: 'POST', body: JSON.stringify(data) }),
  adminList: (status?: FeedbackStatus, cursor?: string) => {
    const query = new URLSearchParams()
    if (status) query.set('status', status)
    if (cursor) query.set('cursor', cursor)
    return request<{ feedbacks: Feedback[]; hasMore?: boolean; nextCursor?: string | null }>(
      `/api/admin/feedback${query.size ? `?${query}` : ''}`
    )
  },
  adminUpdateStatus: (id: string, status: FeedbackStatus) =>
    request<{ ok: boolean }>(`/api/admin/feedback/${id}`, { method: 'PUT', body: JSON.stringify({ status }) })
}
