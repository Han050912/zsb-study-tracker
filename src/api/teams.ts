import { request } from './client'
import type { StudyTeam, TeamDetail, ChallengeType } from '../types'

/** 获取公开小组列表或我加入的小组 */
export async function getTeams(myTeams = false): Promise<StudyTeam[]> {
  return request<StudyTeam[]>(`/api/teams?my=${myTeams}`)
}

/** 创建学习小组 */
export async function createTeam(data: {
  name: string
  description?: string
  maxMembers?: number
  isPublic?: boolean
}): Promise<{ id: string }> {
  return request<{ id: string }>('/api/teams', {
    method: 'POST',
    body: JSON.stringify(data)
  })
}

/** 获取小组详情 */
export async function getTeamDetail(teamId: string): Promise<TeamDetail> {
  return request<TeamDetail>(`/api/teams/${teamId}`)
}

/** 加入小组 */
export async function joinTeam(teamId: string): Promise<void> {
  await request(`/api/teams/${teamId}/join`, { method: 'POST' })
}

/** 退出小组 */
export async function leaveTeam(teamId: string): Promise<void> {
  await request(`/api/teams/${teamId}/leave`, { method: 'POST' })
}

/** 创建挑战 */
export async function createChallenge(teamId: string, data: {
  type: ChallengeType
  target: number
  durationDays: number
  startDate: string
}): Promise<{ id: string }> {
  return request<{ id: string }>(`/api/teams/${teamId}/challenges`, {
    method: 'POST',
    body: JSON.stringify(data)
  })
}

/** 同步挑战进度 */
export async function syncChallengeProgress(challengeId: string): Promise<{
  currentValue: number
  isCompleted: boolean
  allCompleted: boolean
}> {
  return request<{
    currentValue: number
    isCompleted: boolean
    allCompleted: boolean
  }>(`/api/teams/challenges/${challengeId}/sync`, { method: 'POST' })
}

/** 转让队长 */
export async function transferLeader(teamId: string, newLeaderId: string): Promise<void> {
  await request(`/api/teams/${teamId}/transfer-leader`, {
    method: 'POST',
    body: JSON.stringify({ newLeaderId })
  })
}

/** 解散小组 */
export async function disbandTeam(teamId: string): Promise<void> {
  await request(`/api/teams/${teamId}/disband`, { method: 'POST' })
}

/** 编辑挑战（不含 type） */
export async function updateChallenge(challengeId: string, data: {
  target: number
  durationDays: number
  startDate: string
}): Promise<void> {
  await request(`/api/teams/challenges/${challengeId}`, {
    method: 'PUT',
    body: JSON.stringify(data)
  })
}

/** 删除挑战 */
export async function deleteChallenge(challengeId: string): Promise<void> {
  await request(`/api/teams/challenges/${challengeId}`, { method: 'DELETE' })
}

/** 取消挑战 */
export async function cancelChallenge(challengeId: string): Promise<void> {
  await request(`/api/teams/challenges/${challengeId}/cancel`, { method: 'POST' })
}

/** 恢复挑战 */
export async function resumeChallenge(challengeId: string): Promise<void> {
  await request(`/api/teams/challenges/${challengeId}/resume`, { method: 'POST' })
}
