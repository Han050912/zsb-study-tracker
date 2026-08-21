import type { Env } from '../index'
import { on, body } from '../router'
import { all, first, run, batch, uid, utc8Today, HttpError } from '../db'
import { rateLimit } from '../middleware/rateLimit'
import { notifyStatement } from './community'
import { awardBadge } from './badges'
import { assertClean } from './sensitive'

/**
 * 组队挑战 API（P2-2）
 * 多人组队完成打卡/刷题目标，达标全员获团队徽章
 */

const nowSec = () => Math.floor(Date.now() / 1000)

// ---------- 类型定义 ----------

type ChallengeType = 'streak' | 'minutes' | 'problems'

interface TeamRow {
  id: string
  name: string
  description: string
  creator_id: string
  member_count: number
  max_members: number
  is_public: number
  created_at: number
}

interface ChallengeRow {
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

// ---------- 辅助函数 ----------

function mapTeam(r: TeamRow & { my_role?: string }) {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    creatorId: r.creator_id,
    memberCount: r.member_count,
    maxMembers: r.max_members,
    isPublic: !!r.is_public,
    myRole: r.my_role ?? undefined,
    createdAt: r.created_at
  }
}

function mapChallenge(r: ChallengeRow & { my_progress?: number; my_completed?: number }) {
  return {
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
async function assertTeamMember(env: Env, userId: string, teamId: string): Promise<{ role: string }> {
  const member = await first<{ role: string }>(env,
    'SELECT role FROM team_members WHERE team_id = ? AND user_id = ?', teamId, userId)
  if (!member) throw new HttpError(403, '您不是该小组成员')
  return member
}

/** 校验当前用户为队长（供创建挑战、转让、解散、挑战管理使用） */
async function assertTeamLeader(env: Env, userId: string, teamId: string): Promise<void> {
  const member = await assertTeamMember(env, userId, teamId)
  if (member.role !== 'leader') throw new HttpError(403, '仅队长可操作')
}

/** 计算日期范围的结束日期（含当天） */
function calcEndDate(startDate: string, durationDays: number): string {
  const d = new Date(startDate)
  d.setDate(d.getDate() + durationDays - 1)
  return d.toISOString().split('T')[0]
}

/** 检查挑战是否进行中 */
function isChallengeActive(challenge: ChallengeRow): boolean {
  const today = utc8Today()
  return today >= challenge.start_date && today <= challenge.end_date
}

// ---------- API 路由 ----------

/** GET /api/teams - 获取公开小组列表 */
on('GET', '/api/teams', true, async ctx => {
  await rateLimit(ctx.request, 'teams_list', 60, 300_000)
  
  const url = new URL(ctx.request.url)
  const myTeams = url.searchParams.get('my') === 'true'
  
  if (myTeams) {
    // 我加入的小组
    const teams = await all<TeamRow & { my_role: string }>(ctx.env, `
      SELECT t.*, m.role AS my_role
      FROM study_teams t
      JOIN team_members m ON m.team_id = t.id
      WHERE m.user_id = ?
      ORDER BY m.joined_at DESC
    `, ctx.userId)
    return Response.json(teams.map(mapTeam))
  }
  
  // 公开小组列表
  const teams = await all<TeamRow & { my_role?: string }>(ctx.env, `
    SELECT t.*, m.role AS my_role
    FROM study_teams t
    LEFT JOIN team_members m ON m.team_id = t.id AND m.user_id = ?
    WHERE t.is_public = 1
    ORDER BY t.created_at DESC
    LIMIT 50
  `, ctx.userId)
  
  return Response.json(teams.map(mapTeam))
})

/** POST /api/teams - 创建学习小组 */
on('POST', '/api/teams', true, async ctx => {
  await rateLimit(ctx.request, 'create_team', 10, 60_000)
  
  const { name: nameRaw, description: descRaw, maxMembers, isPublic } = await body<{
    name: unknown
    description?: unknown
    maxMembers?: unknown
    isPublic?: boolean
  }>(ctx.request)

  const name = typeof nameRaw === 'string' ? nameRaw.trim() : ''
  if (name.length < 1 || name.length > 30) {
    throw new HttpError(400, '小组名称长度为 1-30 字')
  }
  assertClean(name)
  const description = typeof descRaw === 'string' ? descRaw.trim().slice(0, 200) : ''
  if (description) assertClean(description)

  const max = Math.round(Number(maxMembers ?? 10))
  if (!Number.isFinite(max) || max < 2 || max > 50) throw new HttpError(400, '小组人数范围为 2-50 人')

  const teamId = uid()
  const now = nowSec()

  await batch(ctx.env, [
    ctx.env.DB.prepare(
      'INSERT INTO study_teams (id, name, description, creator_id, member_count, max_members, is_public, created_at) ' +
      'VALUES (?, ?, ?, ?, 1, ?, ?, ?)'
    ).bind(teamId, name, description, ctx.userId, max, isPublic ? 1 : 0, now),
    ctx.env.DB.prepare(
      "INSERT INTO team_members (team_id, user_id, role, joined_at) VALUES (?, ?, 'leader', ?)"
    ).bind(teamId, ctx.userId, now)
  ])
  
  return Response.json({ id: teamId })
})

/** GET /api/teams/:id - 获取小组详情 */
on('GET', '/api/teams/:id', true, async ctx => {
  const teamId = ctx.params.id
  
  const team = await first<TeamRow & { my_role?: string }>(ctx.env, `
    SELECT t.*, m.role AS my_role
    FROM study_teams t
    LEFT JOIN team_members m ON m.team_id = t.id AND m.user_id = ?
    WHERE t.id = ?
  `, ctx.userId, teamId)
  
  if (!team) throw new HttpError(404, '小组不存在')
  
  // 获取成员列表
  const members = await all<{
    user_id: string
    user_name: string
    role: string
    joined_at: number
  }>(ctx.env, `
    SELECT m.user_id, COALESCE(s.user_name, u.username) AS user_name, m.role, m.joined_at
    FROM team_members m
    JOIN users u ON u.id = m.user_id
    LEFT JOIN user_settings s ON s.user_id = m.user_id
    WHERE m.team_id = ?
    ORDER BY m.role DESC, m.joined_at ASC
  `, teamId)
  
  // 获取挑战列表
  const challenges = await all<ChallengeRow & { my_progress?: number; my_completed?: number }>(ctx.env, `
    SELECT c.*, p.current_value AS my_progress, p.is_completed AS my_completed
    FROM team_challenges c
    LEFT JOIN team_challenge_progress p ON p.challenge_id = c.id AND p.user_id = ?
    WHERE c.team_id = ?
    ORDER BY c.created_at DESC
  `, ctx.userId, teamId)
  
  return Response.json({
    team: mapTeam(team),
    members: members.map(m => ({
      userId: m.user_id,
      userName: m.user_name,
      role: m.role,
      joinedAt: m.joined_at
    })),
    challenges: challenges.map(mapChallenge)
  })
})

/** POST /api/teams/:id/join - 加入小组 */
on('POST', '/api/teams/:id/join', true, async ctx => {
  await rateLimit(ctx.request, 'join_team', 10, 60_000)
  
  const teamId = ctx.params.id
  
  const team = await first<TeamRow>(ctx.env, 'SELECT * FROM study_teams WHERE id = ?', teamId)
  if (!team) throw new HttpError(404, '小组不存在')
  
  // 检查是否已加入
  const existing = await first<{ user_id: string }>(ctx.env,
    'SELECT user_id FROM team_members WHERE team_id = ? AND user_id = ?', teamId, ctx.userId)
  if (existing) throw new HttpError(400, '您已在该小组中')
  
  // 私密小组不可公开加入
  if (!team.is_public) throw new HttpError(403, '私密小组不可加入')
  
  // 原子抢占名额：member_count 未满时才 +1，消除「查上限→插入」的 TOCTOU 窗口
  const claim = await run(ctx.env,
    'UPDATE study_teams SET member_count = member_count + 1 WHERE id = ? AND member_count < max_members', teamId)
  if (!claim.meta.changes) throw new HttpError(400, '小组人数已满')
  
  const now = nowSec()
  
  await batch(ctx.env, [
    ctx.env.DB.prepare(
      "INSERT INTO team_members (team_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)"
    ).bind(teamId, ctx.userId, now)
  ])
  
  // 为所有进行中的挑战初始化进度
  const activeChallenges = await all<{ id: string }>(ctx.env, `
    SELECT id FROM team_challenges WHERE team_id = ? AND end_date >= ?
  `, teamId, utc8Today())
  
  if (activeChallenges.length > 0) {
    await batch(ctx.env, activeChallenges.map(c =>
      ctx.env.DB.prepare(
        'INSERT OR IGNORE INTO team_challenge_progress (challenge_id, user_id, current_value, is_completed) ' +
        'VALUES (?, ?, 0, 0)'
      ).bind(c.id, ctx.userId)
    ))
  }
  
  return Response.json({ success: true })
})

/** POST /api/teams/:id/leave - 退出小组 */
on('POST', '/api/teams/:id/leave', true, async ctx => {
  const teamId = ctx.params.id
  
  const member = await first<{ role: string }>(ctx.env,
    'SELECT role FROM team_members WHERE team_id = ? AND user_id = ?', teamId, ctx.userId)
  if (!member) throw new HttpError(404, '您不在该小组中')
  
  if (member.role === 'leader') {
    throw new HttpError(400, '队长不能退出，请先转让队长或解散小组')
  }
  
  await batch(ctx.env, [
    ctx.env.DB.prepare('DELETE FROM team_members WHERE team_id = ? AND user_id = ?')
      .bind(teamId, ctx.userId),
    ctx.env.DB.prepare('UPDATE study_teams SET member_count = MAX(member_count - 1, 0) WHERE id = ?')
      .bind(teamId),
    // 清理退组者在未完成挑战中的进度，避免其残留进度把「全员达标」永久卡死
    ctx.env.DB.prepare(
      'DELETE FROM team_challenge_progress WHERE user_id = ? AND challenge_id IN ' +
      '(SELECT id FROM team_challenges WHERE team_id = ? AND is_completed = 0)'
    ).bind(ctx.userId, teamId)
  ])
  
  return Response.json({ success: true })
})

/** POST /api/teams/:id/transfer-leader - 转让队长（仅队长） */
on('POST', '/api/teams/:id/transfer-leader', true, async ctx => {
  const teamId = ctx.params.id
  await assertTeamLeader(ctx.env, ctx.userId, teamId)

  const { newLeaderId } = await body<{ newLeaderId: string }>(ctx.request)
  if (typeof newLeaderId !== 'string' || !newLeaderId || newLeaderId === ctx.userId) {
    throw new HttpError(400, '目标成员无效')
  }

  const target = await first<{ user_id: string }>(ctx.env,
    'SELECT user_id FROM team_members WHERE team_id = ? AND user_id = ?', teamId, newLeaderId)
  if (!target) throw new HttpError(400, '目标成员不在该小组中')

  await batch(ctx.env, [
    ctx.env.DB.prepare("UPDATE team_members SET role = 'member' WHERE team_id = ? AND user_id = ?")
      .bind(teamId, ctx.userId),
    ctx.env.DB.prepare("UPDATE team_members SET role = 'leader' WHERE team_id = ? AND user_id = ?")
      .bind(teamId, newLeaderId),
    ctx.env.DB.prepare('UPDATE study_teams SET creator_id = ? WHERE id = ?')
      .bind(newLeaderId, teamId)
  ])

  return Response.json({ success: true })
})

/** POST /api/teams/:id/disband - 解散小组（仅队长，级联删除成员/挑战/进度） */
on('POST', '/api/teams/:id/disband', true, async ctx => {
  const teamId = ctx.params.id
  await assertTeamLeader(ctx.env, ctx.userId, teamId)

  await batch(ctx.env, [
    ctx.env.DB.prepare(
      'DELETE FROM team_challenge_progress WHERE challenge_id IN (SELECT id FROM team_challenges WHERE team_id = ?)'
    ).bind(teamId),
    ctx.env.DB.prepare('DELETE FROM team_challenges WHERE team_id = ?').bind(teamId),
    ctx.env.DB.prepare('DELETE FROM team_members WHERE team_id = ?').bind(teamId),
    ctx.env.DB.prepare('DELETE FROM study_teams WHERE id = ?').bind(teamId)
  ])

  return Response.json({ success: true })
})

/** POST /api/teams/:id/challenges - 创建挑战 */
on('POST', '/api/teams/:id/challenges', true, async ctx => {
  await rateLimit(ctx.request, 'create_challenge', 10, 60_000)
  
  const teamId = ctx.params.id
  await assertTeamLeader(ctx.env, ctx.userId, teamId)
  
  const { type, target, durationDays, startDate } = await body<{
    type: ChallengeType
    target: number
    durationDays: number
    startDate: string
  }>(ctx.request)
  
  if (!['streak', 'minutes', 'problems'].includes(type)) {
    throw new HttpError(400, '挑战类型必须为 streak/minutes/problems')
  }
  if (target < 1 || target > 10000) throw new HttpError(400, '目标值范围为 1-10000')
  if (durationDays < 1 || durationDays > 90) throw new HttpError(400, '挑战天数范围为 1-90 天')
  
  // 验证日期格式
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    throw new HttpError(400, '开始日期格式错误')
  }
  
  const endDate = calcEndDate(startDate, durationDays)
  const challengeId = uid()
  const now = nowSec()
  
  // 获取所有成员并初始化进度
  const members = await all<{ user_id: string }>(ctx.env,
    'SELECT user_id FROM team_members WHERE team_id = ?', teamId)
  
  const stmts: D1PreparedStatement[] = [
    ctx.env.DB.prepare(
      'INSERT INTO team_challenges (id, team_id, type, target, duration_days, start_date, end_date, completed_count, is_completed, created_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?)'
    ).bind(challengeId, teamId, type, target, durationDays, startDate, endDate, now)
  ]
  
  // 为所有成员初始化进度
  for (const m of members) {
    stmts.push(
      ctx.env.DB.prepare(
        'INSERT INTO team_challenge_progress (challenge_id, user_id, current_value, is_completed) ' +
        'VALUES (?, ?, 0, 0)'
      ).bind(challengeId, m.user_id)
    )
  }
  
  await batch(ctx.env, stmts)
  
  return Response.json({ id: challengeId })
})

/** POST /api/teams/challenges/:id/sync - 同步挑战进度 */
on('POST', '/api/teams/challenges/:id/sync', true, async ctx => {
  await rateLimit(ctx.request, 'sync_challenge', 100, 60_000)
  
  const challengeId = ctx.params.id
  
  const challenge = await first<ChallengeRow>(ctx.env,
    'SELECT * FROM team_challenges WHERE id = ?', challengeId)
  if (!challenge) throw new HttpError(404, '挑战不存在')
  
  // 检查是否为成员
  await assertTeamMember(ctx.env, ctx.userId, challenge.team_id)
  
  if (challenge.is_cancelled) throw new HttpError(400, '挑战已取消')
  
  // 检查挑战是否进行中
  if (!isChallengeActive(challenge)) {
    throw new HttpError(400, '挑战已结束')
  }
  
  // 从用户数据计算当前进度
  let currentValue = 0
  
  if (challenge.type === 'streak') {
    // 连续打卡天数
    const g = await first<{ streak: number }>(ctx.env,
      'SELECT streak FROM gamification WHERE user_id = ?', ctx.userId)
    currentValue = g?.streak ?? 0
  } else if (challenge.type === 'minutes') {
    // 挑战期间的学习时长
    const records = await all<{ minutes: number }>(ctx.env, `
      SELECT SUM(minutes) AS minutes FROM study_records
      WHERE user_id = ? AND date >= ? AND date <= ?
    `, ctx.userId, challenge.start_date, challenge.end_date)
    currentValue = records[0]?.minutes ?? 0
  } else if (challenge.type === 'problems') {
    // 挑战期间的刷题数
    const records = await all<{ total: number }>(ctx.env, `
      SELECT SUM(total) AS total FROM problem_sessions
      WHERE user_id = ? AND date >= ? AND date <= ?
    `, ctx.userId, challenge.start_date, challenge.end_date)
    currentValue = records[0]?.total ?? 0
  }
  
  // 更新进度
  const isCompleted = currentValue >= challenge.target
  const stmts: D1PreparedStatement[] = [
    ctx.env.DB.prepare(
      'UPDATE team_challenge_progress SET current_value = ?, is_completed = ?, completed_at = ? ' +
      'WHERE challenge_id = ? AND user_id = ?'
    ).bind(currentValue, isCompleted ? 1 : 0, isCompleted ? nowSec() : null, challengeId, ctx.userId)
  ]
  
  // 如果刚完成，发送成就通知
  const oldProgress = await first<{ is_completed: number }>(ctx.env,
    'SELECT is_completed FROM team_challenge_progress WHERE challenge_id = ? AND user_id = ?',
    challengeId, ctx.userId)
  
  if (isCompleted && !oldProgress?.is_completed) {
    stmts.push(
      ctx.env.DB.prepare(
        'UPDATE team_challenges SET completed_count = completed_count + 1 WHERE id = ?'
      ).bind(challengeId)
    )
    
    const team = await first<{ name: string }>(ctx.env,
      'SELECT name FROM study_teams WHERE id = ?', challenge.team_id)
    
    stmts.push(notifyStatement(ctx.env, {
      userId: ctx.userId,
      type: 'achievement',
      content: `恭喜！您完成了「${team?.name}」的挑战目标`
    }))
  }
  
  await batch(ctx.env, stmts)
  
  // 检查是否全员达标
  const allCompleted = await first<{ total: number; completed: number }>(ctx.env, `
    SELECT COUNT(*) AS total, SUM(is_completed) AS completed
    FROM team_challenge_progress
    WHERE challenge_id = ?
  `, challengeId)
  
  // 全员达标：先原子抢占「已完成」标记，防止并发同步或重复同步导致重复发徽章与通知
  if (!challenge.is_completed && allCompleted && allCompleted.completed === allCompleted.total && allCompleted.total > 0) {
    const claimed = await run(ctx.env,
      'UPDATE team_challenges SET is_completed = 1 WHERE id = ? AND is_completed = 0', challengeId)
    if (claimed.meta.changes) {
      const team = await first<{ name: string }>(ctx.env,
        'SELECT name FROM study_teams WHERE id = ?', challenge.team_id)

      const members = await all<{ user_id: string }>(ctx.env,
        'SELECT user_id FROM team_members WHERE team_id = ?', challenge.team_id)

      const teamStmts: D1PreparedStatement[] = []
      // 为全员发放团队徽章并通知
      for (const m of members) {
        const badgeStmts = await awardBadge(ctx.env, m.user_id, 'team_champion')
        teamStmts.push(...badgeStmts)

        teamStmts.push(notifyStatement(ctx.env, {
          userId: m.user_id,
          type: 'achievement',
          content: `🎉 「${team?.name}」全员达标！获得团队徽章`
        }))
      }

      await batch(ctx.env, teamStmts)
    }
  }
  
  return Response.json({
    currentValue,
    isCompleted,
    allCompleted: allCompleted?.completed === allCompleted?.total
  })
})

/** PUT /api/teams/challenges/:id - 编辑挑战（仅队长；未开始/进行中可编辑；不含 type） */
on('PUT', '/api/teams/challenges/:id', true, async ctx => {
  await rateLimit(ctx.request, 'update_challenge', 10, 60_000)

  const challengeId = ctx.params.id
  const challenge = await first<ChallengeRow>(ctx.env,
    'SELECT * FROM team_challenges WHERE id = ?', challengeId)
  if (!challenge) throw new HttpError(404, '挑战不存在')
  await assertTeamLeader(ctx.env, ctx.userId, challenge.team_id)

  if (challenge.is_cancelled) throw new HttpError(400, '已取消的挑战不可编辑')
  if (challenge.is_completed) throw new HttpError(400, '已完成的挑战不可编辑')
  if (utc8Today() > challenge.end_date) throw new HttpError(400, '挑战已结束，不可编辑')

  const { target, durationDays, startDate } = await body<{
    target: number
    durationDays: number
    startDate: string
  }>(ctx.request)

  if (!Number.isFinite(target) || target < 1 || target > 10000) throw new HttpError(400, '目标值范围为 1-10000')
  if (!Number.isFinite(durationDays) || durationDays < 1 || durationDays > 90) throw new HttpError(400, '挑战天数范围为 1-90 天')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) throw new HttpError(400, '开始日期格式错误')

  const endDate = calcEndDate(startDate, durationDays)
  const now = nowSec()

  await batch(ctx.env, [
    ctx.env.DB.prepare(
      'UPDATE team_challenges SET target = ?, duration_days = ?, start_date = ?, end_date = ? WHERE id = ?'
    ).bind(target, durationDays, startDate, endDate, challengeId),
    ctx.env.DB.prepare(
      'UPDATE team_challenge_progress SET is_completed = CASE WHEN current_value >= ? THEN 1 ELSE 0 END, ' +
      'completed_at = CASE WHEN current_value >= ? THEN ? ELSE NULL END WHERE challenge_id = ?'
    ).bind(target, target, now, challengeId),
    ctx.env.DB.prepare(
      'UPDATE team_challenges SET completed_count = (SELECT COUNT(*) FROM team_challenge_progress WHERE challenge_id = ? AND is_completed = 1) WHERE id = ?'
    ).bind(challengeId, challengeId)
  ])

  return Response.json({ success: true })
})

/** DELETE /api/teams/challenges/:id - 删除挑战（仅队长；任意状态；级联删进度） */
on('DELETE', '/api/teams/challenges/:id', true, async ctx => {
  const challengeId = ctx.params.id
  const challenge = await first<ChallengeRow>(ctx.env,
    'SELECT * FROM team_challenges WHERE id = ?', challengeId)
  if (!challenge) throw new HttpError(404, '挑战不存在')
  await assertTeamLeader(ctx.env, ctx.userId, challenge.team_id)

  await batch(ctx.env, [
    ctx.env.DB.prepare('DELETE FROM team_challenge_progress WHERE challenge_id = ?').bind(challengeId),
    ctx.env.DB.prepare('DELETE FROM team_challenges WHERE id = ?').bind(challengeId)
  ])

  return Response.json({ success: true })
})

/** POST /api/teams/challenges/:id/cancel - 取消挑战（仅队长；仅进行中） */
on('POST', '/api/teams/challenges/:id/cancel', true, async ctx => {
  const challengeId = ctx.params.id
  const challenge = await first<ChallengeRow>(ctx.env,
    'SELECT * FROM team_challenges WHERE id = ?', challengeId)
  if (!challenge) throw new HttpError(404, '挑战不存在')
  await assertTeamLeader(ctx.env, ctx.userId, challenge.team_id)

  if (challenge.is_cancelled) throw new HttpError(400, '挑战已取消')
  if (!isChallengeActive(challenge)) throw new HttpError(400, '仅进行中的挑战可取消')

  const today = new Date(utc8Today())
  const end = new Date(challenge.end_date)
  const remainingDays = Math.round((end.getTime() - today.getTime()) / 86_400_000) + 1

  await run(ctx.env,
    'UPDATE team_challenges SET is_cancelled = 1, remaining_days = ? WHERE id = ?', remainingDays, challengeId)

  return Response.json({ success: true })
})

/** POST /api/teams/challenges/:id/resume - 恢复挑战（仅队长；仅已取消；顺延 endDate） */
on('POST', '/api/teams/challenges/:id/resume', true, async ctx => {
  const challengeId = ctx.params.id
  const challenge = await first<ChallengeRow>(ctx.env,
    'SELECT * FROM team_challenges WHERE id = ?', challengeId)
  if (!challenge) throw new HttpError(404, '挑战不存在')
  await assertTeamLeader(ctx.env, ctx.userId, challenge.team_id)

  if (!challenge.is_cancelled) throw new HttpError(400, '挑战未被取消')

  const remainingDays = challenge.remaining_days ?? 1
  const newEndDate = calcEndDate(utc8Today(), remainingDays)

  await run(ctx.env,
    'UPDATE team_challenges SET is_cancelled = 0, end_date = ?, remaining_days = NULL WHERE id = ?',
    newEndDate, challengeId)

  return Response.json({ success: true })
})
