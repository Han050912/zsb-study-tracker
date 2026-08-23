import { request } from './client'
import type { Feedback, FeedbackStatus, FeedbackType } from '../types'

export const feedbackApi = {
  create: (data: { type: FeedbackType; content: string; contact?: string; imageUrls?: string[] }) =>
    request<{ id: string }>('/api/feedback', { method: 'POST', body: JSON.stringify(data) }),
  adminList: (status?: FeedbackStatus) =>
    request<{ feedbacks: Feedback[] }>(`/api/admin/feedback${status ? `?status=${status}` : ''}`),
  adminUpdateStatus: (id: string, status: FeedbackStatus) =>
    request<{ ok: boolean }>(`/api/admin/feedback/${id}`, { method: 'PUT', body: JSON.stringify({ status }) })
}
