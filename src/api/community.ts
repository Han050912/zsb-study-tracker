import { request, API_BASE, handleUnauthorized } from './client'
import type {
  AdminReport, CommunityComment, CommunityLeaderboard, CommunityNotification, CommunityPost, PostType
} from '../types'

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

/** 单张图片上限 5MB，与 worker/src/api/uploads.ts 保持一致 */
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024
/** 单帖最多 9 张 */
export const IMAGE_MAX_PER_POST = 9

/** 服务端返回的图片路径转绝对地址（图片为公开路由，<img> 直接引用） */
export const imageUrl = (path: string) => `${API_BASE}${path}`

/** 上传结果 */
export interface UploadResult {
  id: string
  url: string
  size: number
  contentType: string
}

/**
 * 上传社区图片（XMLHttpRequest 以获得上传进度回调；fetch 不支持 upload progress）。
 * onProgress 收到 0-1 的进度值；失败抛出带服务端提示的 Error。
 */
export function uploadImage(file: File, onProgress?: (ratio: number) => void): Promise<UploadResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${API_BASE}/api/community/upload?filename=${encodeURIComponent(file.name.slice(0, 100))}`)
    const token = localStorage.getItem('jwt_token')
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream')
    xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress?.(e.loaded / e.total) }
    xhr.onload = () => {
      let data: any = null
      try { data = JSON.parse(xhr.responseText) } catch { /* 非 JSON 响应 */ }
      if (xhr.status >= 200 && xhr.status < 300) { resolve(data as UploadResult); return }
      if (xhr.status === 401) {
        // 与 fetch 通道同一全局处理：清会话 + 跳登录（handleUnauthorized 内部会抛错，捕获后转为 reject）
        try { handleUnauthorized() } catch (e) { reject(e) }
        return
      }
      reject(Object.assign(new Error(data?.message || `上传失败（HTTP ${xhr.status}）`), { status: xhr.status }))
    }
    xhr.onerror = () => reject(new Error('网络错误，上传失败'))
    xhr.send(file)
  })
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
  createPost: (data: { type: PostType; content: string; tags: string[]; imageUrls?: string[]; refType?: string; refId?: string }) =>
    request<CommunityPost>('/api/community/posts', { method: 'POST', body: JSON.stringify(data) }),
  deletePost: (id: string) =>
    request<{ ok: boolean }>(`/api/community/posts/${id}`, { method: 'DELETE' }),
  /** 提问帖标记解决/取消解决（仅楼主） */
  resolvePost: (id: string) =>
    request<{ isResolved: boolean }>(`/api/community/posts/${id}/resolve`, { method: 'PUT' }),
  addComment: (postId: string, data: { content: string; parentId?: string }) =>
    request<CommunityComment>(`/api/community/posts/${postId}/comments`, { method: 'POST', body: JSON.stringify(data) }),
  deleteComment: (id: string) =>
    request<{ ok: boolean }>(`/api/community/comments/${id}`, { method: 'DELETE' }),
  toggleLike: (targetType: 'post' | 'comment', targetId: string) =>
    request<{ liked: boolean }>('/api/community/likes', { method: 'POST', body: JSON.stringify({ targetType, targetId }) }),
  leaderboard: () => request<CommunityLeaderboard>('/api/community/leaderboard'),
  report: (targetType: 'post' | 'comment', targetId: string, reason: string, detail?: string) =>
    request<{ ok: boolean }>('/api/community/reports', { method: 'POST', body: JSON.stringify({ targetType, targetId, reason, detail }) }),
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
    request<{ isHidden: boolean }>(`/api/admin/comments/${id}/hide`, { method: 'PUT' }),
  adminReports: () =>
    request<{ reports: AdminReport[] }>('/api/admin/reports'),
  adminResolveReport: (id: string, action: 'hide' | 'delete' | 'reject', reason?: string) =>
    request<{ ok: boolean }>(`/api/admin/reports/${id}/resolve`, { method: 'PUT', body: JSON.stringify({ action, reason }) })
}
