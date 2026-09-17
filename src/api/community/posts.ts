import { request } from '../client'
import type {
  CommunityComment,
  CommunityLeaderboard,
  CommunityPost,
  HotTopic,
  PostType,
  ProgressBoardData,
  RecommendFeedData,
  WeeklyReport
} from '../../types'

interface PostDetail {
  nextCursor?: string | null
  post: CommunityPost
  comments: CommunityComment[]
}

interface FeedResult {
  posts: CommunityPost[]
  nextCursor: string | null
  hasMore?: boolean
}

interface FeedQuery {
  keyword?: string
  sort?: 'latest' | 'hot'
  tag?: string
  type?: PostType
  /** 仅看精华帖 */
  featured?: boolean
  /** 仅看我关注的作者的帖子 */
  follow?: boolean
  /** 指定圈子内的帖子流（未指定时仅返回广场公开帖） */
  circle?: string
  /** 知识点讨论流（与 circle 互斥）：章节讨论帖归属 */
  topicSubject?: string
  topicChapter?: string
  cursor?: string | null
  limit?: number
}

export const postsApi = {
  feed: (q: FeedQuery = {}) => {
    const params = new URLSearchParams()
    if (q.keyword) params.set('keyword', q.keyword)
    if (q.sort) params.set('sort', q.sort)
    if (q.tag) params.set('tag', q.tag)
    if (q.type) params.set('type', q.type)
    if (q.featured) params.set('featured', '1')
    if (q.follow) params.set('follow', '1')
    if (q.circle) params.set('circle', q.circle)
    if (q.topicSubject && q.topicChapter) {
      params.set('topicSubject', q.topicSubject)
      params.set('topicChapter', q.topicChapter)
    }
    if (q.cursor) params.set('cursor', q.cursor)
    if (q.limit) params.set('limit', String(q.limit))
    const qs = params.toString()
    return request<FeedResult>(`/api/community/posts${qs ? `?${qs}` : ''}`)
  },
  post: (id: string, sort: 'hot' | 'latest' = 'hot') =>
    request<PostDetail>(`/api/community/posts/${id}?paginate=1&sort=${sort}`),
  comments: (
    postId: string,
    query: { cursor?: string | null; parentId?: string; aroundCommentId?: string; sort?: 'hot' | 'latest' } = {}
  ) => {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(query)) if (value) params.set(key, value)
    return request<{ comments: CommunityComment[]; nextCursor: string | null }>(
      `/api/community/posts/${postId}/comments?${params}`
    )
  },
  createPost: (data: {
    type: PostType
    content: string
    tags: string[]
    imageUrls?: string[]
    circleId?: string
    topicRef?: string
    refType?: string
    refId?: string
  }) => request<CommunityPost>('/api/community/posts', { method: 'POST', body: JSON.stringify(data) }),
  deletePost: (id: string) => request<{ ok: boolean }>(`/api/community/posts/${id}`, { method: 'DELETE' }),
  /** 提问帖标记解决/取消解决（仅楼主；已采纳最佳答案时需先取消采纳） */
  resolvePost: (id: string) =>
    request<{ isResolved: boolean }>(`/api/community/posts/${id}/resolve`, { method: 'PUT' }),
  /** 采纳/取消采纳最佳答案（仅提问帖楼主；重复调用同一评论为取消采纳） */
  acceptAnswer: (postId: string, commentId: string) =>
    request<{ acceptedAnswerId: string | null; isResolved: boolean }>(`/api/community/posts/${postId}/accept`, {
      method: 'PUT',
      body: JSON.stringify({ commentId })
    }),
  addComment: (postId: string, data: { content: string; parentId?: string; imageUrls?: string[] }) =>
    request<CommunityComment>(`/api/community/posts/${postId}/comments`, {
      method: 'POST',
      body: JSON.stringify(data)
    }),
  deleteComment: (id: string) =>
    request<{ ok: boolean; removed: number }>(`/api/community/comments/${id}`, { method: 'DELETE' }),
  toggleLike: (targetType: 'post' | 'comment', targetId: string) =>
    request<{ liked: boolean }>('/api/community/likes', {
      method: 'POST',
      body: JSON.stringify({ targetType, targetId })
    }),
  /** 踩/取消踩（toggle，与赞互斥） */
  dislike: (targetType: 'post' | 'comment', targetId: string) =>
    request<{ disliked: boolean; likeRevoked?: boolean }>('/api/community/dislikes', {
      method: 'POST',
      body: JSON.stringify({ targetType, targetId })
    }),
  leaderboard: () => request<CommunityLeaderboard>('/api/community/leaderboard'),
  /** 上周学习周报（惰性计算） */
  weeklyReport: () => request<WeeklyReport>('/api/community/weekly-report'),
  /** 学习进步榜（本周时长 / 本月刷题 TOP 50 + 本人百分位） */
  progressBoard: () => request<ProgressBoardData>('/api/community/progress-board'),
  /** 热门话题运营位（近 7 天自动统计 + 管理员干预） */
  hotTopics: () => request<{ topics: HotTopic[] }>('/api/community/hot-topics'),
  /** 用户发布的帖子（公开广场帖口径，游标分页） */
  userPosts: (userId: string, cursor?: string | null) => {
    const params = new URLSearchParams()
    if (cursor) params.set('cursor', cursor)
    const qs = params.toString()
    return request<FeedResult>(`/api/community/users/${userId}/posts${qs ? `?${qs}` : ''}`)
  },
  /** 我点赞过的帖子（仅本人，游标分页） */
  likedPosts: (cursor?: string | null) => {
    const params = new URLSearchParams()
    if (cursor) params.set('cursor', cursor)
    const qs = params.toString()
    return request<FeedResult>(`/api/community/me/liked-posts${qs ? `?${qs}` : ''}`)
  },
  /** 每日一题：最新一条被标记且未隐藏的帖子（无则 post 为 null） */
  daily: () => request<{ post: CommunityPost | null }>('/api/community/daily'),
  /** 个性化推荐（帖子 + 圈子 + 用户） */
  recommend: () => request<RecommendFeedData>('/api/community/recommend'),
  report: (targetType: 'post' | 'comment' | 'message', targetId: string, reason: string, detail?: string) =>
    request<{ ok: boolean }>('/api/community/reports', {
      method: 'POST',
      body: JSON.stringify({ targetType, targetId, reason, detail })
    }),
  addShareComment: (shareId: string, content: string) =>
    request<{ id: string }>(`/api/partner-shares/${shareId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ content })
    }),
  deleteShare: (id: string) => request<{ ok: boolean }>(`/api/partner-shares/${id}`, { method: 'DELETE' })
}
