import { request } from '../client'
import type { CommunityUserProfile, FollowListResult, UserLookupResult, UserStudyStats } from '../../types'

function followList(path: string, cursor?: string | null): Promise<FollowListResult> {
  const params = new URLSearchParams()
  if (cursor) params.set('cursor', cursor)
  const qs = params.toString()
  return request<FollowListResult>(`${path}${qs ? `?${qs}` : ''}`)
}

export const usersApi = {
  /** 用户资料卡（等级/徽章墙/认证状态等公开荣誉信息） */
  profile: (userId: string) => request<CommunityUserProfile>(`/api/community/users/${userId}/profile`),
  /** 精确查找用户（按对外用户 ID） */
  lookup: (key: string) => request<UserLookupResult>(`/api/community/users/lookup?key=${encodeURIComponent(key)}`),
  /** 个人主页学习统计（热力图 + 总览 + 科目分布） */
  stats: (userId: string) => request<UserStudyStats>(`/api/community/users/${userId}/stats`),
  /** 关注/取关（toggle） */
  follow: (userId: string) =>
    request<{ following: boolean }>(`/api/community/users/${userId}/follow`, { method: 'PUT' }),
  /** 粉丝列表 */
  followers: (userId: string, cursor?: string | null) => followList(`/api/community/users/${userId}/followers`, cursor),
  /** 关注列表 */
  following: (userId: string, cursor?: string | null) => followList(`/api/community/users/${userId}/following`, cursor),
  /** 互关列表 */
  mutualFollows: (userId: string, cursor?: string | null) => followList(`/api/community/users/${userId}/mutual`, cursor)
}
