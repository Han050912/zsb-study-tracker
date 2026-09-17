import { request } from '../client'
import type { AdminReport, HotTopicOverride } from '../../types'

export const moderationApi = {
  // ---- 管理员操作 ----
  adminPinPost: (id: string) => request<{ isPinned: boolean }>(`/api/admin/posts/${id}/pin`, { method: 'PUT' }),
  adminFeaturePost: (id: string) =>
    request<{ isFeatured: boolean }>(`/api/admin/posts/${id}/feature`, { method: 'PUT' }),
  adminHidePost: (id: string) => request<{ isHidden: boolean }>(`/api/admin/posts/${id}/hide`, { method: 'PUT' }),
  adminHideComment: (id: string) => request<{ isHidden: boolean }>(`/api/admin/comments/${id}/hide`, { method: 'PUT' }),
  adminReports: () =>
    request<{ reports: AdminReport[]; hasMore?: boolean; nextCursor?: string | null }>('/api/admin/reports'),
  adminResolveReport: (id: string, action: 'hide' | 'delete' | 'reject', reason?: string) =>
    request<{ ok: boolean }>(`/api/admin/reports/${id}/resolve`, {
      method: 'PUT',
      body: JSON.stringify({ action, reason })
    }),
  /** 授予/更新专家认证（蓝 V） */
  adminVerifyUser: (userId: string, expertise: string) =>
    request<{ verified: boolean; expertise: string }>(`/api/admin/users/${userId}/verify`, {
      method: 'PUT',
      body: JSON.stringify({ expertise })
    }),
  /** 撤销专家认证 */
  adminUnverifyUser: (userId: string) =>
    request<{ verified: boolean }>(`/api/admin/users/${userId}/verify`, { method: 'DELETE' }),
  /** 设置/取消每日一题 */
  adminDailyPost: (id: string) => request<{ isDaily: boolean }>(`/api/admin/posts/${id}/daily`, { method: 'PUT' }),
  /** 热门话题：自动统计快照 + 干预名单 */
  adminHotTopics: () =>
    request<{ stats: { tag: string; count: number }[]; overrides: HotTopicOverride[] }>('/api/admin/hot-topics'),
  /** 热门话题：添加置顶/屏蔽 */
  adminAddHotTopic: (data: { text: string; tag: string; action: 'pin' | 'block' }) =>
    request<HotTopicOverride>('/api/admin/hot-topics', { method: 'POST', body: JSON.stringify(data) }),
  /** 热门话题：删除干预条目 */
  adminDeleteHotTopic: (id: string) => request<{ ok: boolean }>(`/api/admin/hot-topics/${id}`, { method: 'DELETE' })
}
