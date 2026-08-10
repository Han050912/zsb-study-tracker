import { request } from './client'
import type { CommunityComment, CommunityNotification, CommunityPost, PostType } from '../types'

export interface FeedQuery {
  sort?: 'latest' | 'hot'
  tag?: string
  type?: PostType
  cursor?: string | null
  limit?: number
}

export interface FeedResult {
  posts: CommunityPost[]
  nextCursor: string | null
}

export interface PostDetail {
  post: CommunityPost
  comments: CommunityComment[]
}

export interface NotificationResult {
  items: CommunityNotification[]
  unreadCount: number
  nextCursor: string | null
}

export const communityApi = {
  feed: (q: FeedQuery = {}) => {
    const params = new URLSearchParams()
    if (q.sort) params.set('sort', q.sort)
    if (q.tag) params.set('tag', q.tag)
    if (q.type) params.set('type', q.type)
    if (q.cursor) params.set('cursor', q.cursor)
    if (q.limit) params.set('limit', String(q.limit))
    const qs = params.toString()
    return request<FeedResult>(`/api/community/posts${qs ? `?${qs}` : ''}`)
  },
  post: (id: string) => request<PostDetail>(`/api/community/posts/${id}`),
  createPost: (data: { type: PostType; content: string; tags: string[]; refType?: string; refId?: string }) =>
    request<CommunityPost>('/api/community/posts', { method: 'POST', body: JSON.stringify(data) }),
  deletePost: (id: string) =>
    request<{ ok: boolean }>(`/api/community/posts/${id}`, { method: 'DELETE' }),
  addComment: (postId: string, data: { content: string; parentId?: string }) =>
    request<CommunityComment>(`/api/community/posts/${postId}/comments`, { method: 'POST', body: JSON.stringify(data) }),
  deleteComment: (id: string) =>
    request<{ ok: boolean }>(`/api/community/comments/${id}`, { method: 'DELETE' }),
  toggleLike: (targetType: 'post' | 'comment', targetId: string) =>
    request<{ liked: boolean }>('/api/community/likes', { method: 'POST', body: JSON.stringify({ targetType, targetId }) }),
  notifications: (cursor?: string | null, limit?: number) => {
    const params = new URLSearchParams()
    if (cursor) params.set('cursor', cursor)
    if (limit) params.set('limit', String(limit))
    const qs = params.toString()
    return request<NotificationResult>(`/api/community/notifications${qs ? `?${qs}` : ''}`)
  },
  markRead: (id: string) =>
    request<{ ok: boolean }>(`/api/community/notifications/${id}/read`, { method: 'PUT' }),
  markAllRead: () =>
    request<{ ok: boolean }>('/api/community/notifications/read-all', { method: 'PUT' }),

  // ---- 管理员操作 ----
  adminPinPost: (id: string) =>
    request<{ isPinned: boolean }>(`/api/admin/posts/${id}/pin`, { method: 'PUT' }),
  adminHidePost: (id: string) =>
    request<{ isHidden: boolean }>(`/api/admin/posts/${id}/hide`, { method: 'PUT' }),
  adminHideComment: (id: string) =>
    request<{ isHidden: boolean }>(`/api/admin/comments/${id}/hide`, { method: 'PUT' })
}
