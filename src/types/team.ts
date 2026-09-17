/** 学习小组域 */

/** 学习小组 */
export interface StudyTeam {
  activeChallenge?: TeamChallenge
  pendingRequestCount?: number
  id: string
  name: string
  description: string
  creatorId: string
  memberCount: number
  maxMembers: number
  isPublic: boolean
  myRole?: 'leader' | 'member'
  createdAt: number
}

/** 小组成员 */
export interface TeamMember {
  userId: string
  userName: string
  role: 'leader' | 'member'
  joinedAt: number
  /** 自定义头像相对 URL（未设置 = undefined） */
  userAvatar?: string
}

/** 入组申请（待审核） */
export interface TeamJoinRequest {
  userId: string
  userName: string
  userAvatar?: string
  createdAt: number
}

/** 挑战类型 */
export type ChallengeType = 'streak' | 'minutes' | 'problems'

/** 组队挑战 */
export interface TeamChallenge {
  status?: 'upcoming' | 'active' | 'cancelled' | 'completed' | 'ended'
  nextTransitionAt?: number | null
  id: string
  teamId: string
  type: ChallengeType
  target: number
  durationDays: number
  startDate: string
  endDate: string
  completedCount: number
  isCompleted: boolean
  myProgress: number
  myCompleted: boolean
  isCancelled: boolean
  remainingDays?: number
  createdAt: number
}

/** 小组详情 */
export interface TeamDetail {
  team: StudyTeam
  members: TeamMember[]
  challenges: TeamChallenge[]
  inviteCode?: string | null
  inviteCodeExpiresAt?: number | null
  myJoinRequest?: boolean
}
