import { request, API_BASE, handleUnauthorized } from './client'
import type {
  AdminReport, CircleDetail, CommunityCircle, CommunityComment, CommunityLeaderboard, CommunityMessage, CommunityNotification, CommunityPost, CommunityUserProfile, MessageConversation, PostType, UserStudyStats
} from '../types'

export interface FeedQuery {
  sort?: 'latest' | 'hot'
  tag?: string
  type?: PostType
  /** 仅看精华帖 */
  featured?: boolean
  /** 仅看我关注的作者的帖子 */
  follow?: boolean
  /** 指定圈子内的帖子流（未指定时仅返回广场公开帖） */
  circle?: string
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
/** 单条评论最多 3 张 */
export const IMAGE_MAX_PER_COMMENT = 3

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
    if (q.featured) params.set('featured', '1')
    if (q.follow) params.set('follow', '1')
    if (q.circle) params.set('circle', q.circle)
    if (q.cursor) params.set('cursor', q.cursor)
    if (q.limit) params.set('limit', String(q.limit))
    const qs = params.toString()
    return request<FeedResult>(`/api/community/posts${qs ? `?${qs}` : ''}`)
  },
  post: (id: string) => request<PostDetail>(`/api/community/posts/${id}`),
  createPost: (data: { type: PostType; content: string; tags: string[]; imageUrls?: string[]; circleId?: string; refType?: string; refId?: string }) =>
    request<CommunityPost>('/api/community/posts', { method: 'POST', body: JSON.stringify(data) }),
  deletePost: (id: string) =>
    request<{ ok: boolean }>(`/api/community/posts/${id}`, { method: 'DELETE' }),
  /** 提问帖标记解决/取消解决（仅楼主；已采纳最佳答案时需先取消采纳） */
  resolvePost: (id: string) =>
    request<{ isResolved: boolean }>(`/api/community/posts/${id}/resolve`, { method: 'PUT' }),
  /** 采纳/取消采纳最佳答案（仅提问帖楼主；重复调用同一评论为取消采纳） */
  acceptAnswer: (postId: string, commentId: string) =>
    request<{ acceptedAnswerId: string | null; isResolved: boolean }>(`/api/community/posts/${postId}/accept`, { method: 'PUT', body: JSON.stringify({ commentId }) }),
  addComment: (postId: string, data: { content: string; parentId?: string; imageUrls?: string[] }) =>
    request<CommunityComment>(`/api/community/posts/${postId}/comments`, { method: 'POST', body: JSON.stringify(data) }),
  deleteComment: (id: string) =>
    request<{ ok: boolean }>(`/api/community/comments/${id}`, { method: 'DELETE' }),
  toggleLike: (targetType: 'post' | 'comment', targetId: string) =>
    request<{ liked: boolean }>('/api/community/likes', { method: 'POST', body: JSON.stringify({ targetType, targetId }) }),
  leaderboard: () => request<CommunityLeaderboard>('/api/community/leaderboard'),
  /** 用户资料卡（等级/徽章墙/认证状态等公开荣誉信息） */
  profile: (userId: string) => request<CommunityUserProfile>(`/api/community/users/${userId}/profile`),
  /** 个人主页学习统计（热力图 + 总览 + 科目分布） */
  stats: (userId: string) => request<UserStudyStats>(`/api/community/users/${userId}/stats`),
  /** 关注/取关（toggle） */
  follow: (userId: string) =>
    request<{ following: boolean }>(`/api/community/users/${userId}/follow`, { method: 'PUT' }),
  /** 每日一题：最新一条被标记且未隐藏的帖子（无则 post 为 null） */
  daily: () => request<{ post: CommunityPost | null }>('/api/community/daily'),
  /** 圈子列表（按成员数倒序） */
  circles: () => request<{ circles: CommunityCircle[] }>('/api/community/circles'),
  /** 建圈 */
  createCircle: (data: { name: string; description?: string; isPublic?: boolean }) =>
    request<CommunityCircle>('/api/community/circles', { method: 'POST', body: JSON.stringify(data) }),
  /** 圈子详情（信息 + 活跃成员 + 圈主可见的待审批列表） */
  circleDetail: (id: string) => request<CircleDetail>(`/api/community/circles/${id}`),
  /** 加入/退圈/取消申请（toggle） */
  joinCircle: (id: string) =>
    request<{ status: 'active' | 'pending' | null }>(`/api/community/circles/${id}/join`, { method: 'PUT' }),
  /** 圈主批准申请 */
  approveCircleMember: (circleId: string, userId: string) =>
    request<{ ok: boolean }>(`/api/community/circles/${circleId}/members/${userId}/approve`, { method: 'PUT' }),
  /** 圈主移除成员/拒绝申请 */
  removeCircleMember: (circleId: string, userId: string) =>
    request<{ ok: boolean }>(`/api/community/circles/${circleId}/members/${userId}`, { method: 'DELETE' }),
  /** 私信会话列表（每 peer 最新一条 + 未读数） */
  conversations: () => request<{ conversations: MessageConversation[] }>('/api/community/messages/conversations'),
  /** 与某用户的消息记录（游标分页；打开即已读对方消息） */
  messagesWith: (peerId: string, cursor?: string | null) => {
    const params = new URLSearchParams()
    if (cursor) params.set('cursor', cursor)
    const qs = params.toString()
    return request<{ messages: CommunityMessage[]; nextCursor: string | null }>(
      `/api/community/messages/with/${peerId}${qs ? `?${qs}` : ''}`)
  },
  /** 发送私信 */
  sendMessage: (peerId: string, content: string) =>
    request<CommunityMessage>(`/api/community/messages/${peerId}`, { method: 'POST', body: JSON.stringify({ content }) }),
  /** 私信未读总数（并入顶栏角标） */
  messageUnreadCount: () => request<{ count: number }>('/api/community/messages/unread-count'),
  report: (targetType: 'post' | 'comment' | 'message', targetId: string, reason: string, detail?: string) =>
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
  adminFeaturePost: (id: string) =>
    request<{ isFeatured: boolean }>(`/api/admin/posts/${id}/feature`, { method: 'PUT' }),
  adminHidePost: (id: string) =>
    request<{ isHidden: boolean }>(`/api/admin/posts/${id}/hide`, { method: 'PUT' }),
  adminHideComment: (id: string) =>
    request<{ isHidden: boolean }>(`/api/admin/comments/${id}/hide`, { method: 'PUT' }),
  adminReports: () =>
    request<{ reports: AdminReport[] }>('/api/admin/reports'),
  adminResolveReport: (id: string, action: 'hide' | 'delete' | 'reject', reason?: string) =>
    request<{ ok: boolean }>(`/api/admin/reports/${id}/resolve`, { method: 'PUT', body: JSON.stringify({ action, reason }) }),
  /** 授予/更新专家认证（蓝 V） */
  adminVerifyUser: (userId: string, expertise: string) =>
    request<{ verified: boolean; expertise: string }>(`/api/admin/users/${userId}/verify`, { method: 'PUT', body: JSON.stringify({ expertise }) }),
  /** 撤销专家认证 */
  adminUnverifyUser: (userId: string) =>
    request<{ verified: boolean }>(`/api/admin/users/${userId}/verify`, { method: 'DELETE' }),
  /** 设置/取消每日一题 */
  adminDailyPost: (id: string) =>
    request<{ isDaily: boolean }>(`/api/admin/posts/${id}/daily`, { method: 'PUT' })
}
