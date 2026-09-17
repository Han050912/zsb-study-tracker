import type { Env } from '../../index'
import { first, HttpError, utc8Today } from '../../db'
import { isAdmin } from '../community/shared'

/**
 * 组队挑战共享 helper：行类型、挑战行 → 前端对象映射、成员/队长/可读性校验。
 * 由 teams.ts 与 challenges.ts 复用；仅额外依赖 community/shared 的 isAdmin（无循环依赖）。
 * 零逻辑改动：本文件声明从原 teams.ts 逐字搬迁，仅加 export。
 */

export const nowSec = () => Math.floor(Date.now() / 1000)

// ---------- 类型定义 ----------

export type ChallengeType = 'streak' | 'minutes' | 'problems'

export interface TeamRow {
  id: string
  name: string
  description: string
  creator_id: string
  member_count: number
  max_members: number
  is_public: number
  invite_code: string | null
  invite_code_expires_at: number | null
  created_at: number
}

export interface ChallengeRow {
  id: string
  team_id: string
  type: ChallengeType
  target: number
  duration_days: number
  start_date: string
  end_date: string
  completed_count: number
  is_completed: number
  is_cancelled: number
  remaining_days: number | null
  created_at: number
}

export function mapChallenge(r: ChallengeRow & { my_progress?: number; my_completed?: number }) {
  const today = utc8Today()
  const status = r.is_cancelled
    ? 'cancelled'
    : r.is_completed
      ? 'completed'
      : today < r.start_date
        ? 'upcoming'
        : today > r.end_date
          ? 'ended'
          : 'active'
  const nextTransitionAt =
    status === 'upcoming'
      ? Date.parse(r.start_date + 'T00:00:00+08:00')
      : status === 'active'
        ? Date.parse(r.end_date + 'T00:00:00+08:00') + 86400000
        : null
  return {
    status,
    nextTransitionAt,
    id: r.id,
    teamId: r.team_id,
    type: r.type,
    target: r.target,
    durationDays: r.duration_days,
    startDate: r.start_date,
    endDate: r.end_date,
    completedCount: r.completed_count,
    isCompleted: !!r.is_completed,
    myProgress: r.my_progress ?? 0,
    myCompleted: !!r.my_completed,
    isCancelled: !!r.is_cancelled,
    remainingDays: r.remaining_days ?? undefined,
    createdAt: r.created_at
  }
}

/** 校验当前用户是否为小组成员 */
export async function assertTeamMember(env: Env, userId: string, teamId: string): Promise<{ role: string }> {
  const member = await first<{ role: string }>(
    env,
    'SELECT role FROM team_members WHERE team_id = ? AND user_id = ?',
    teamId,
    userId
  )
  if (!member) throw new HttpError(403, '您不是该小组成员')
  return member
}

/** 校验当前用户为队长（供创建挑战、转让、解散、挑战管理使用） */
export async function assertTeamLeader(env: Env, userId: string, teamId: string): Promise<void> {
  const member = await assertTeamMember(env, userId, teamId)
  if (member.role !== 'leader') throw new HttpError(403, '仅队长可操作')
}

/** 小组可读性校验：私密小组仅成员/管理员/持有效邀请码或被邀请申请人可读成员与挑战列表 */
export async function assertTeamReadable(
  ctx: { env: Env; userId: string; role?: string },
  team: TeamRow & { my_role?: string | null },
  opts: { inviteCode?: string | null; hasPendingRequest?: boolean } = {}
): Promise<void> {
  if (team.is_public || team.my_role) return
  if (await isAdmin(ctx.env, ctx.userId, ctx.role)) return
  if (opts.hasPendingRequest) return
  // 邀请码口径与 by-invite / apply 一致：trim + 大写，过期时间为空视为无效
  const code = (opts.inviteCode ?? '').trim().toUpperCase()
  if (
    code &&
    code === (team.invite_code ?? '') &&
    !!team.invite_code_expires_at &&
    team.invite_code_expires_at >= nowSec()
  ) {
    return
  }
  throw new HttpError(403, '私密小组仅成员可见')
}
