import type { Env } from '../index'
import { z } from 'zod'
import { on, body } from '../router'
import { all, first, run, batch, uid, utc8Today, HttpError } from '../db'
import { parseBody } from '../schemas'
import { rateLimit } from '../middleware/rateLimit'
import { notifyStatement } from './community'
import { awardBadge } from './badges'
import { assertCleanAsync } from './sensitive'

/**
 * 组队挑战 API（P2-2）
 * 多人组队完成打卡/刷题目标，达标全员获团队徽章
 */

const nowSec = () => Math.floor(Date.now() / 1000)

const INVITE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function genInviteCode(): string {
  let code = ''
  for (let i = 0; i < 8; i++) {
    code += INVITE_CHARS[Math.floor(Math.random() * INVITE_CHARS.length)]
  }
  return code
}

/** 生成唯一邀请码：查重，冲突则重试一次（碰撞概率极低，一次重试足够） */
async function newInviteCode(env: Env): Promise<string> {
  const code = genInviteCode()
  const exists = await first<{ id: string }>(env, 'SELECT id FROM study_teams WHERE invite_code = ?', code)
  return exists ? genInviteCode() : code
}

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
  invite_code: string | null
  invite_code_expires_at: number | null
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

/** 小组名称/描述/人数的形状校验（创建与编辑共用；敏感词与 DB 依赖校验留在 validateTeamFields / handler 内） */
const teamFieldsSchema = z.object({
  name: z.string().transform(s => s.trim())
    .pipe(z.string().min(1, '小组名称长度为 1-30 字').max(30, '小组名称长度为 1-30 字')),
  // 复刻原行为：非字符串一律归空（避免数字/对象被 String() 成 '123' / '[object Object]' 落库）；字符串静默截断 200
  description: z.unknown().transform(v => typeof v === 'string' ? v.trim().slice(0, 200) : '').default(''),
  // 复刻原行为：undefined/null 均兜底默认 10，其余四舍五入，2-50
  maxMembers: z.unknown().transform(v => v == null ? 10 : Math.round(Number(v)))
    .pipe(z.number().refine(n => Number.isFinite(n) && n >= 2 && n <= 50, '小组人数范围为 2-50 人'))
})

/** 创建端点专用：仅此处需要 isPublic（缺省视为私密组）；提为模块级常量，避免每次请求重建 schema */
const createTeamSchema = teamFieldsSchema.extend({ isPublic: z.boolean().optional() })

/** 校验小组名称/描述的敏感词（形状校验已由 teamFieldsSchema 完成），返回规范化后的字段值（创建与编辑共用） */
async function validateTeamFields(env: Env, parsed: { name: string; description: string; maxMembers: number }): Promise<{ name: string; description: string; max: number }> {
  const { name, description, maxMembers: max } = parsed
  await assertCleanAsync(name, env)
  if (description) await assertCleanAsync(description, env)
  return { name, description, max }
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

/** 校验 YYYY-MM-DD 是否为真实存在的日期（如 2026-02-30 非法），避免非法日期在 calcEndDate 中抛异常导致 500 */
function isValidDateStr(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

/** 检查挑战是否进行中 */
function isChallengeActive(challenge: ChallengeRow): boolean {
  const today = utc8Today()
  return today >= challenge.start_date && today <= challenge.end_date
}

// ---------- API 路由 ----------

/** GET /api/teams - 获取公开小组列表（公开：访客可浏览公开小组，my=true 分支依赖登录态返回空） */
on('GET', '/api/teams', false, async ctx => {
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
  
  // isPublic 仅创建端点需要，在共享 schema 上扩展：仅接受布尔，缺省视为私密组
  const parsed = await parseBody(ctx.request, createTeamSchema)
  const fields = await validateTeamFields(ctx.env, parsed)
  const isPublic = parsed.isPublic ?? false

  const teamId = uid()
  const now = nowSec()

  const inviteCode = isPublic ? null : await newInviteCode(ctx.env)
  const inviteExpiresAt = isPublic ? null : now + 3 * 24 * 3600

  await batch(ctx.env, [
    ctx.env.DB.prepare(
      'INSERT INTO study_teams (id, name, description, creator_id, member_count, max_members, is_public, invite_code, invite_code_expires_at, created_at) ' +
      'VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?)'
    ).bind(teamId, fields.name, fields.description, ctx.userId, fields.max, isPublic ? 1 : 0, inviteCode, inviteExpiresAt, now),
    ctx.env.DB.prepare(
      "INSERT INTO team_members (team_id, user_id, role, joined_at) VALUES (?, ?, 'leader', ?)"
    ).bind(teamId, ctx.userId, now)
  ])
  
  return Response.json({ id: teamId })
})

/** GET /api/teams/by-invite - 按邀请码查询私密小组（须注册在 /api/teams/:id 之前） */
on('GET', '/api/teams/by-invite', true, async ctx => {
  const url = new URL(ctx.request.url)
  const code = (url.searchParams.get('code') || '').trim().toUpperCase()
  if (!code) throw new HttpError(400, '请输入邀请码')

  const team = await first<TeamRow>(ctx.env,
    'SELECT * FROM study_teams WHERE invite_code = ? AND is_public = 0', code)
  if (!team) throw new HttpError(404, '邀请码无效')
  if (!team.invite_code_expires_at || team.invite_code_expires_at < nowSec()) {
    throw new HttpError(410, '邀请码已过期')
  }

  return Response.json({
    id: team.id,
    name: team.name,
    description: team.description,
    memberCount: team.member_count,
    maxMembers: team.max_members
  })
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
    user_avatar?: string
  }>(ctx.env, `
    SELECT m.user_id, COALESCE(s.user_name, u.username) AS user_name, m.role, m.joined_at, s.avatar AS user_avatar
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
  
  const myRequest = await first<{ user_id: string }>(ctx.env,
    'SELECT user_id FROM team_join_requests WHERE team_id = ? AND user_id = ?', teamId, ctx.userId)

  return Response.json({
    team: mapTeam(team),
    members: members.map(m => ({
      userId: m.user_id,
      userName: m.user_name,
      role: m.role,
      joinedAt: m.joined_at,
      userAvatar: m.user_avatar ?? undefined
    })),
    challenges: challenges.map(mapChallenge),
    inviteCode: team.my_role === 'leader' ? (team.invite_code ?? null) : null,
    inviteCodeExpiresAt: team.my_role === 'leader' ? (team.invite_code_expires_at ?? null) : null,
    myJoinRequest: !!myRequest
  })
})

/** 将成员写入小组：原子抢占名额 + 插入成员 + 初始化进行中挑战进度（公开 join 与审批同意复用） */
async function addMember(env: Env, teamId: string, userId: string): Promise<void> {
  const claim = await run(env,
    'UPDATE study_teams SET member_count = member_count + 1 WHERE id = ? AND member_count < max_members', teamId)
  if (!claim.meta.changes) throw new HttpError(400, '小组人数已满')

  await batch(env, [
    env.DB.prepare(
      "INSERT INTO team_members (team_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)"
    ).bind(teamId, userId, nowSec())
  ])

  const activeChallenges = await all<{ id: string }>(env, `
    SELECT id FROM team_challenges WHERE team_id = ? AND end_date >= ? AND is_cancelled = 0
  `, teamId, utc8Today())

  if (activeChallenges.length > 0) {
    await batch(env, activeChallenges.map(c =>
      env.DB.prepare(
        'INSERT OR IGNORE INTO team_challenge_progress (challenge_id, user_id, current_value, is_completed) ' +
        'VALUES (?, ?, 0, 0)'
      ).bind(c.id, userId)
    ))
  }
}

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
  
  // 私密小组不可公开加入，请使用邀请码申请
  if (!team.is_public) throw new HttpError(403, '私密小组请使用邀请码申请')

  await addMember(ctx.env, teamId, ctx.userId)

  return Response.json({ success: true })
})

/** POST /api/teams/:id/apply - 通过邀请码申请加入私密小组 */
on('POST', '/api/teams/:id/apply', true, async ctx => {
  await rateLimit(ctx.request, 'apply_team', 10, 60_000)

  const teamId = ctx.params.id
  const team = await first<TeamRow>(ctx.env, 'SELECT * FROM study_teams WHERE id = ?', teamId)
  if (!team) throw new HttpError(404, '小组不存在')
  if (team.is_public) throw new HttpError(400, '公开小组请直接加入')

  const { inviteCode } = await body<{ inviteCode?: unknown }>(ctx.request)
  const code = typeof inviteCode === 'string' ? inviteCode.trim().toUpperCase() : ''
  if (!code || code !== (team.invite_code ?? '')) throw new HttpError(400, '邀请码错误')
  if (!team.invite_code_expires_at || team.invite_code_expires_at < nowSec()) {
    throw new HttpError(410, '邀请码已过期')
  }

  const existing = await first<{ user_id: string }>(ctx.env,
    'SELECT user_id FROM team_members WHERE team_id = ? AND user_id = ?', teamId, ctx.userId)
  if (existing) throw new HttpError(400, '您已在该小组中')

  const pending = await first<{ user_id: string }>(ctx.env,
    'SELECT user_id FROM team_join_requests WHERE team_id = ? AND user_id = ?', teamId, ctx.userId)
  if (pending) throw new HttpError(400, '已有待审核的申请')

  if (team.member_count >= team.max_members) throw new HttpError(400, '小组人数已满')

  const applicant = await first<{ name: string }>(ctx.env,
    'SELECT COALESCE(s.user_name, u.username) AS name FROM users u LEFT JOIN user_settings s ON s.user_id = u.id WHERE u.id = ?', ctx.userId)

  await batch(ctx.env, [
    ctx.env.DB.prepare(
      'INSERT INTO team_join_requests (team_id, user_id, created_at) VALUES (?, ?, ?)'
    ).bind(teamId, ctx.userId, nowSec()),
    notifyStatement(ctx.env, {
      userId: team.creator_id,
      type: 'system',
      actorId: ctx.userId,
      targetType: 'team', targetId: teamId,
      content: `${applicant?.name ?? '有人'} 申请加入小组「${team.name}」`
    })
  ])

  return Response.json({ success: true })
})

/** 移除成员（自退或踢出）共用的清理语句：删成员 + 减计数 + 清未完成挑战进度 + 重算达标数 + 可选通知 */
function removeMemberStmts(env: Env, teamId: string, userId: string, notify?: { actorId: string; content: string }): D1PreparedStatement[] {
  const stmts: D1PreparedStatement[] = [
    env.DB.prepare('DELETE FROM team_members WHERE team_id = ? AND user_id = ?').bind(teamId, userId),
    env.DB.prepare('UPDATE study_teams SET member_count = MAX(member_count - 1, 0) WHERE id = ?').bind(teamId),
    // 清理退组/被踢者在未完成挑战中的进度，避免其残留进度把「全员达标」永久卡死
    env.DB.prepare(
      'DELETE FROM team_challenge_progress WHERE user_id = ? AND challenge_id IN ' +
      '(SELECT id FROM team_challenges WHERE team_id = ? AND is_completed = 0)'
    ).bind(userId, teamId),
    // 其可能已达标，删除进度后重算达标人数，避免 completed_count 虚增导致「全员达标」误判
    env.DB.prepare(
      'UPDATE team_challenges SET completed_count = ' +
      '(SELECT COUNT(*) FROM team_challenge_progress p WHERE p.challenge_id = team_challenges.id AND p.is_completed = 1) ' +
      'WHERE team_id = ? AND is_completed = 0'
    ).bind(teamId)
  ]
  if (notify) {
    stmts.push(notifyStatement(env, {
      userId, type: 'system', actorId: notify.actorId,
      targetType: 'team', targetId: teamId,
      content: notify.content
    }))
  }
  return stmts
}

/** POST /api/teams/:id/leave - 退出小组 */
on('POST', '/api/teams/:id/leave', true, async ctx => {
  const teamId = ctx.params.id
  
  const member = await first<{ role: string }>(ctx.env,
    'SELECT role FROM team_members WHERE team_id = ? AND user_id = ?', teamId, ctx.userId)
  if (!member) throw new HttpError(404, '您不在该小组中')
  
  if (member.role === 'leader') {
    throw new HttpError(400, '队长不能退出，请先转让队长或解散小组')
  }
  
  await batch(ctx.env, removeMemberStmts(ctx.env, teamId, ctx.userId))
  
  return Response.json({ success: true })
})

/** POST /api/teams/:id/remove-member - 踢出成员（仅队长） */
on('POST', '/api/teams/:id/remove-member', true, async ctx => {
  const teamId = ctx.params.id
  await assertTeamLeader(ctx.env, ctx.userId, teamId)

  const { userId } = await body<{ userId: string }>(ctx.request)
  if (typeof userId !== 'string' || !userId || userId === ctx.userId) {
    throw new HttpError(400, '不能踢出自己')
  }

  const target = await first<{ role: string }>(ctx.env,
    'SELECT role FROM team_members WHERE team_id = ? AND user_id = ?', teamId, userId)
  if (!target || target.role !== 'member') throw new HttpError(400, '目标不是可踢出的成员')

  const team = await first<{ name: string }>(ctx.env,
    'SELECT name FROM study_teams WHERE id = ?', teamId)

  await batch(ctx.env, removeMemberStmts(ctx.env, teamId, userId, {
    actorId: ctx.userId,
    content: `你已被移出小组「${team?.name ?? ''}」`
  }))

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

  const team = await first<{ name: string }>(ctx.env,
    'SELECT name FROM study_teams WHERE id = ?', teamId)

  await batch(ctx.env, [
    ctx.env.DB.prepare("UPDATE team_members SET role = 'member' WHERE team_id = ? AND user_id = ?")
      .bind(teamId, ctx.userId),
    ctx.env.DB.prepare("UPDATE team_members SET role = 'leader' WHERE team_id = ? AND user_id = ?")
      .bind(teamId, newLeaderId),
    ctx.env.DB.prepare('UPDATE study_teams SET creator_id = ? WHERE id = ?')
      .bind(newLeaderId, teamId),
    notifyStatement(ctx.env, {
      userId: newLeaderId,
      type: 'system',
      actorId: ctx.userId,
      targetType: 'team', targetId: teamId,
      content: `你已成为小组「${team?.name ?? ''}」的队长`
    })
  ])

  return Response.json({ success: true })
})

/** PUT /api/teams/:id - 编辑小组信息（名称/描述/人数上限，仅队长） */
on('PUT', '/api/teams/:id', true, async ctx => {
  const teamId = ctx.params.id
  await assertTeamLeader(ctx.env, ctx.userId, teamId)

  const team = await first<{ member_count: number }>(ctx.env,
    'SELECT member_count FROM study_teams WHERE id = ?', teamId)
  if (!team) throw new HttpError(404, '小组不存在')

  const fields = await validateTeamFields(ctx.env, await parseBody(ctx.request, teamFieldsSchema))

  if (fields.max < team.member_count) {
    throw new HttpError(400, `人数上限不能低于当前成员数（${team.member_count} 人）`)
  }

  await run(ctx.env,
    'UPDATE study_teams SET name = ?, description = ?, max_members = ? WHERE id = ?',
    fields.name, fields.description, fields.max, teamId)

  return Response.json({ success: true })
})

/** GET /api/teams/:id/requests - 队长查看待审核申请 */
on('GET', '/api/teams/:id/requests', true, async ctx => {
  const teamId = ctx.params.id
  await assertTeamLeader(ctx.env, ctx.userId, teamId)

  const requests = await all<{ user_id: string; user_name: string; user_avatar?: string; created_at: number }>(ctx.env, `
    SELECT r.user_id, COALESCE(s.user_name, u.username) AS user_name, s.avatar AS user_avatar, r.created_at
    FROM team_join_requests r
    JOIN users u ON u.id = r.user_id
    LEFT JOIN user_settings s ON s.user_id = r.user_id
    WHERE r.team_id = ?
    ORDER BY r.created_at ASC
  `, teamId)

  return Response.json(requests.map(r => ({
    userId: r.user_id,
    userName: r.user_name,
    userAvatar: r.user_avatar ?? undefined,
    createdAt: r.created_at
  })))
})

/** POST /api/teams/:id/requests/:userId/approve - 队长同意申请 */
on('POST', '/api/teams/:id/requests/:userId/approve', true, async ctx => {
  const teamId = ctx.params.id
  const targetId = ctx.params.userId
  await assertTeamLeader(ctx.env, ctx.userId, teamId)

  const req = await first<{ user_id: string }>(ctx.env,
    'SELECT user_id FROM team_join_requests WHERE team_id = ? AND user_id = ?', teamId, targetId)
  if (!req) throw new HttpError(404, '申请不存在')

  const team = await first<{ name: string }>(ctx.env,
    'SELECT name FROM study_teams WHERE id = ?', teamId)

  await addMember(ctx.env, teamId, targetId)

  await batch(ctx.env, [
    ctx.env.DB.prepare('DELETE FROM team_join_requests WHERE team_id = ? AND user_id = ?').bind(teamId, targetId),
    notifyStatement(ctx.env, {
      userId: targetId,
      type: 'system',
      actorId: ctx.userId,
      targetType: 'team', targetId: teamId,
      content: `你已加入小组「${team?.name ?? ''}」`
    })
  ])

  return Response.json({ success: true })
})

/** POST /api/teams/:id/requests/:userId/reject - 队长拒绝申请 */
on('POST', '/api/teams/:id/requests/:userId/reject', true, async ctx => {
  const teamId = ctx.params.id
  const targetId = ctx.params.userId
  await assertTeamLeader(ctx.env, ctx.userId, teamId)

  const req = await first<{ user_id: string }>(ctx.env,
    'SELECT user_id FROM team_join_requests WHERE team_id = ? AND user_id = ?', teamId, targetId)
  if (!req) throw new HttpError(404, '申请不存在')

  const { reason } = await body<{ reason?: unknown }>(ctx.request)
  const reasonStr = typeof reason === 'string' ? reason.trim().slice(0, 200) : ''

  const team = await first<{ name: string }>(ctx.env,
    'SELECT name FROM study_teams WHERE id = ?', teamId)

  await batch(ctx.env, [
    ctx.env.DB.prepare('DELETE FROM team_join_requests WHERE team_id = ? AND user_id = ?').bind(teamId, targetId),
    notifyStatement(ctx.env, {
      userId: targetId,
      type: 'system',
      actorId: ctx.userId,
      targetType: 'team', targetId: teamId,
      content: reasonStr
        ? `你的加入小组「${team?.name ?? ''}」申请被拒绝，原因：${reasonStr}`
        : `你的加入小组「${team?.name ?? ''}」申请被拒绝`
    })
  ])

  return Response.json({ success: true })
})

/** POST /api/teams/:id/requests/withdraw - 申请人撤回申请 */
on('POST', '/api/teams/:id/requests/withdraw', true, async ctx => {
  const teamId = ctx.params.id
  const req = await first<{ user_id: string }>(ctx.env,
    'SELECT user_id FROM team_join_requests WHERE team_id = ? AND user_id = ?', teamId, ctx.userId)
  if (!req) throw new HttpError(404, '申请不存在')

  await run(ctx.env, 'DELETE FROM team_join_requests WHERE team_id = ? AND user_id = ?', teamId, ctx.userId)

  return Response.json({ success: true })
})

/** POST /api/teams/:id/invite-code - 队长重新生成邀请码 */
on('POST', '/api/teams/:id/invite-code', true, async ctx => {
  const teamId = ctx.params.id
  await assertTeamLeader(ctx.env, ctx.userId, teamId)

  const team = await first<{ is_public: number }>(ctx.env,
    'SELECT is_public FROM study_teams WHERE id = ?', teamId)
  if (!team) throw new HttpError(404, '小组不存在')
  if (team.is_public) throw new HttpError(400, '公开小组无邀请码')

  const code = await newInviteCode(ctx.env)
  const expiresAt = nowSec() + 3 * 24 * 3600
  await run(ctx.env,
    'UPDATE study_teams SET invite_code = ?, invite_code_expires_at = ? WHERE id = ?',
    code, expiresAt, teamId)

  return Response.json({ inviteCode: code, inviteCodeExpiresAt: expiresAt })
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
  if (!Number.isFinite(target) || target < 1 || target > 10000) throw new HttpError(400, '目标值范围为 1-10000')
  if (!Number.isFinite(durationDays) || durationDays < 1 || durationDays > 90) throw new HttpError(400, '挑战天数范围为 1-90 天')

  if (!isValidDateStr(startDate)) throw new HttpError(400, '开始日期格式错误')
  
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
    const team = await first<{ name: string }>(ctx.env,
      'SELECT name FROM study_teams WHERE id = ?', challenge.team_id)
    
    stmts.push(notifyStatement(ctx.env, {
      userId: ctx.userId,
      type: 'achievement',
      targetType: 'team', targetId: challenge.team_id,
      content: `恭喜！您完成了「${team?.name}」的挑战目标`
    }))
  }
  
  // 重算达标人数（而非 +1），消除并发重复同步导致的 completed_count 虚增
  stmts.push(
    ctx.env.DB.prepare(
      'UPDATE team_challenges SET completed_count = ' +
      '(SELECT COUNT(*) FROM team_challenge_progress WHERE challenge_id = ? AND is_completed = 1) WHERE id = ?'
    ).bind(challengeId, challengeId)
  )
  
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
          targetType: 'team', targetId: challenge.team_id,
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
  if (!isValidDateStr(startDate)) throw new HttpError(400, '开始日期格式错误')

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
