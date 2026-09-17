import { request } from '../client'
import type { CircleDetail, CommunityCircle } from '../../types'

export const circlesApi = {
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
    request<{ ok: boolean }>(`/api/community/circles/${circleId}/members/${userId}`, { method: 'DELETE' })
}
