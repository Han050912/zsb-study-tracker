import type { Ctx } from '../../router'
import { on, body } from '../../router'
import { all, first, run, batch, uid, utc8Today, HttpError } from '../../db'
import { rateLimit } from '../../middleware/rateLimit'
import { badgeAwardStatements } from '../badges'
import { nowSec, assertTeamMember, assertTeamLeader, mapChallenge } from './shared'
import type { ChallengeRow, ChallengeType } from './shared'

/**
 * 组队挑战域路由：挑战创建 / 进度同步 / 编辑 / 删除 / 取消 / 恢复。
 * 多人组队完成打卡/刷题目标，达标全员获团队徽章。
 * 由 teams/index.ts 的 registerTeamRoutes 聚合注册。
 * 进度、成员资格、徽章与完成标记在同一事务内判定与提交。
 */

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

async function syncProgress(ctx: Ctx, challenge: ChallengeRow) {
  const challengeId = challenge.id
  const today = utc8Today()
  const now = nowSec()
  // All membership, progress and completion decisions run in the same transaction. In particular,
  // a cancellation/member departure after route authorization cannot leave a completed-but-unpaid team.
  const active = `EXISTS (SELECT 1 FROM team_challenges c
    WHERE c.id = p.challenge_id AND c.is_cancelled = 0 AND c.is_completed = 0
      AND c.start_date <= ? AND c.end_date >= ?
      AND EXISTS (SELECT 1 FROM team_members m WHERE m.team_id = c.team_id AND m.user_id = p.user_id))`
  const stmts: D1PreparedStatement[] = [
    ctx.env.DB.prepare(
      `INSERT OR IGNORE INTO team_challenge_progress (challenge_id, user_id, current_value, is_completed)
       SELECT c.id, m.user_id, 0, 0 FROM team_challenges c JOIN team_members m ON m.team_id = c.team_id
       WHERE c.id = ? AND c.is_cancelled = 0 AND c.is_completed = 0 AND c.start_date <= ? AND c.end_date >= ?`
    ).bind(challengeId, today, today),
    ctx.env.DB.prepare(
      `UPDATE team_challenge_progress AS p SET current_value = (
      SELECT CASE c.type
        WHEN 'streak' THEN (SELECT COALESCE(MAX(g.streak), 0) FROM gamification g WHERE g.user_id = p.user_id)
        WHEN 'minutes' THEN (SELECT COALESCE(SUM(r.minutes), 0) FROM study_records r
          WHERE r.user_id = p.user_id AND r.date >= c.start_date AND r.date <= c.end_date)
        WHEN 'problems' THEN (SELECT COALESCE(SUM(r.total), 0) FROM problem_sessions r
          WHERE r.user_id = p.user_id AND r.date >= c.start_date AND r.date <= c.end_date)
        ELSE 0 END FROM team_challenges c WHERE c.id = p.challenge_id
      ) WHERE p.challenge_id = ? AND p.user_id = ? AND ${active}
    `
    ).bind(challengeId, ctx.userId, today, today),
    ctx.env.DB.prepare(
      `UPDATE team_challenge_progress AS p SET
      is_completed = CASE WHEN current_value >= (SELECT target FROM team_challenges WHERE id = p.challenge_id) THEN 1 ELSE 0 END,
      completed_at = CASE WHEN current_value >= (SELECT target FROM team_challenges WHERE id = p.challenge_id)
        THEN COALESCE(completed_at, ?) ELSE NULL END
      WHERE p.challenge_id = ? AND p.user_id = ? AND ${active}
    `
    ).bind(now, challengeId, ctx.userId, today, today),
    ctx.env.DB.prepare(
      `INSERT OR IGNORE INTO community_notifications
      (id, user_id, type, target_type, target_id, content, is_read, created_at)
      SELECT 'team-progress:' || c.id || ':' || p.user_id, p.user_id, 'achievement', 'team', c.team_id,
        '恭喜！您完成了「' || t.name || '」的挑战目标', 0, ?
      FROM team_challenge_progress p JOIN team_challenges c ON c.id = p.challenge_id
      JOIN study_teams t ON t.id = c.team_id
      WHERE p.challenge_id = ? AND p.user_id = ? AND p.is_completed = 1 AND ${active}
    `
    ).bind(now, challengeId, ctx.userId, today, today),
    ctx.env.DB.prepare(
      `UPDATE team_challenges SET completed_count = (
      SELECT COUNT(*) FROM team_challenge_progress p JOIN team_members m
        ON m.user_id = p.user_id AND m.team_id = team_challenges.team_id
      WHERE p.challenge_id = team_challenges.id AND p.is_completed = 1
    ) WHERE id = ? AND is_completed = 0`
    ).bind(challengeId)
  ]
  const ready = `c.is_cancelled = 0 AND c.is_completed = 0
    AND c.start_date <= ? AND c.end_date >= ?
    AND EXISTS (SELECT 1 FROM team_members m WHERE m.team_id = c.team_id)
    AND NOT EXISTS (SELECT 1 FROM team_members m
      LEFT JOIN team_challenge_progress p ON p.challenge_id = c.id AND p.user_id = m.user_id
      WHERE m.team_id = c.team_id AND COALESCE(p.is_completed, 0) = 0)`
  const recipients = `SELECT m.user_id FROM team_members m JOIN team_challenges c ON c.team_id = m.team_id
    WHERE c.id = ? AND ${ready}`
  stmts.push(...badgeAwardStatements(ctx.env, 'team_champion', recipients, [challengeId, today, today]))
  stmts.push(
    ctx.env.DB.prepare(
      `INSERT OR IGNORE INTO community_notifications
      (id, user_id, type, target_type, target_id, content, is_read, created_at)
      SELECT 'team-completed:' || c.id || ':' || m.user_id, m.user_id, 'achievement', 'team', c.team_id,
        '🎉 「' || t.name || '」全员达标！获得团队徽章', 0, ?
      FROM team_members m JOIN team_challenges c ON c.team_id = m.team_id JOIN study_teams t ON t.id = c.team_id
      WHERE c.id = ? AND ${ready}
    `
    ).bind(now, challengeId, today, today),
    // Last statement: a failure in any recipient's award rolls this marker AND progress back.
    ctx.env.DB.prepare(`UPDATE team_challenges AS c SET is_completed = 1 WHERE c.id = ? AND ${ready}`).bind(
      challengeId,
      today,
      today
    )
  )
  await batch(ctx.env, stmts)
  const result = await first<{ current_value: number; is_completed: number; all_completed: number }>(
    ctx.env,
    `SELECT p.current_value, p.is_completed, c.is_completed AS all_completed
      FROM team_challenge_progress p JOIN team_challenges c ON c.id = p.challenge_id
      WHERE p.challenge_id = ? AND p.user_id = ?`,
    challengeId,
    ctx.userId
  )
  return {
    currentValue: result?.current_value ?? 0,
    isCompleted: !!result?.is_completed,
    allCompleted: !!result?.all_completed
  }
}
export function registerChallengeRoutes() {
  on('POST', '/api/teams/:id/sync-active', true, async (ctx) => {
    await rateLimit(ctx, 'sync_active_challenges', 30)
    await assertTeamMember(ctx.env, ctx.userId, ctx.params.id)
    const today = utc8Today()
    const active = await all<ChallengeRow>(
      ctx.env,
      'SELECT * FROM team_challenges WHERE team_id = ? AND is_cancelled = 0 AND is_completed = 0 AND start_date <= ? AND end_date >= ?',
      ctx.params.id,
      today,
      today
    )
    // 一个 HTTP 命令复用单挑战的计分/徽章规则，避免客户端 N 次请求和第二次详情加载。
    for (const challenge of active) await syncProgress(ctx, challenge)
    const challenges = await all<ChallengeRow & { my_progress: number; my_completed: number }>(
      ctx.env,
      'SELECT c.*, p.current_value AS my_progress, p.is_completed AS my_completed FROM team_challenges c ' +
        'LEFT JOIN team_challenge_progress p ON p.challenge_id = c.id AND p.user_id = ? WHERE c.team_id = ? ORDER BY c.created_at DESC',
      ctx.userId,
      ctx.params.id
    )
    return Response.json({ challenges: challenges.map(mapChallenge) })
  })

  /** POST /api/teams/:id/challenges - 创建挑战 */
  on('POST', '/api/teams/:id/challenges', true, async (ctx) => {
    await rateLimit(ctx, 'create_challenge', 10)

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
    if (!Number.isFinite(durationDays) || durationDays < 1 || durationDays > 90)
      throw new HttpError(400, '挑战天数范围为 1-90 天')

    if (!isValidDateStr(startDate)) throw new HttpError(400, '开始日期格式错误')

    const endDate = calcEndDate(startDate, durationDays)
    const challengeId = uid()
    const now = nowSec()

    const stmts: D1PreparedStatement[] = [
      ctx.env.DB.prepare(
        'INSERT INTO team_challenges (id, team_id, type, target, duration_days, start_date, end_date, completed_count, is_completed, created_at) ' +
          'VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?)'
      ).bind(challengeId, teamId, type, target, durationDays, startDate, endDate, now)
    ]

    // 当前成员快照在提交事务内读取，与并发加入共享同一原子边界。
    stmts.push(
      ctx.env.DB.prepare(
        'INSERT OR IGNORE INTO team_challenge_progress (challenge_id, user_id, current_value, is_completed) ' +
          'SELECT ?, user_id, 0, 0 FROM team_members WHERE team_id = ?'
      ).bind(challengeId, teamId)
    )

    await batch(ctx.env, stmts)

    return Response.json({ id: challengeId }, { status: 201 })
  })

  /** POST /api/teams/challenges/:id/sync - 同步挑战进度 */
  on('POST', '/api/teams/challenges/:id/sync', true, async (ctx) => {
    await rateLimit(ctx, 'sync_challenge', 100)

    const challengeId = ctx.params.id

    const challenge = await first<ChallengeRow>(ctx.env, 'SELECT * FROM team_challenges WHERE id = ?', challengeId)
    if (!challenge) throw new HttpError(404, '挑战不存在')

    // 检查是否为成员
    await assertTeamMember(ctx.env, ctx.userId, challenge.team_id)

    if (challenge.is_cancelled) throw new HttpError(400, '挑战已取消')

    // 检查挑战是否进行中
    if (!isChallengeActive(challenge)) {
      throw new HttpError(400, '挑战已结束')
    }

    return Response.json(await syncProgress(ctx, challenge))
  })

  /** PUT /api/teams/challenges/:id - 编辑挑战（仅队长；未开始/进行中可编辑；不含 type） */
  on('PUT', '/api/teams/challenges/:id', true, async (ctx) => {
    await rateLimit(ctx, 'update_challenge', 10)

    const challengeId = ctx.params.id
    const challenge = await first<ChallengeRow>(ctx.env, 'SELECT * FROM team_challenges WHERE id = ?', challengeId)
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
    if (!Number.isFinite(durationDays) || durationDays < 1 || durationDays > 90)
      throw new HttpError(400, '挑战天数范围为 1-90 天')
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

    return Response.json({ ok: true })
  })

  /** DELETE /api/teams/challenges/:id - 删除挑战（仅队长；任意状态；级联删进度） */
  on('DELETE', '/api/teams/challenges/:id', true, async (ctx) => {
    const challengeId = ctx.params.id
    const challenge = await first<ChallengeRow>(ctx.env, 'SELECT * FROM team_challenges WHERE id = ?', challengeId)
    if (!challenge) throw new HttpError(404, '挑战不存在')
    await assertTeamLeader(ctx.env, ctx.userId, challenge.team_id)

    await batch(ctx.env, [
      ctx.env.DB.prepare('DELETE FROM team_challenge_progress WHERE challenge_id = ?').bind(challengeId),
      ctx.env.DB.prepare('DELETE FROM team_challenges WHERE id = ?').bind(challengeId)
    ])

    return Response.json({ ok: true })
  })

  /** POST /api/teams/challenges/:id/cancel - 取消挑战（仅队长；仅进行中） */
  on('POST', '/api/teams/challenges/:id/cancel', true, async (ctx) => {
    const challengeId = ctx.params.id
    const challenge = await first<ChallengeRow>(ctx.env, 'SELECT * FROM team_challenges WHERE id = ?', challengeId)
    if (!challenge) throw new HttpError(404, '挑战不存在')
    await assertTeamLeader(ctx.env, ctx.userId, challenge.team_id)

    if (challenge.is_cancelled) throw new HttpError(400, '挑战已取消')
    if (!isChallengeActive(challenge)) throw new HttpError(400, '仅进行中的挑战可取消')

    const today = new Date(utc8Today())
    const end = new Date(challenge.end_date)
    const remainingDays = Math.round((end.getTime() - today.getTime()) / 86_400_000) + 1

    await run(
      ctx.env,
      'UPDATE team_challenges SET is_cancelled = 1, remaining_days = ? WHERE id = ?',
      remainingDays,
      challengeId
    )

    return Response.json({ ok: true })
  })

  /** POST /api/teams/challenges/:id/resume - 恢复挑战（仅队长；仅已取消；顺延 endDate） */
  on('POST', '/api/teams/challenges/:id/resume', true, async (ctx) => {
    const challengeId = ctx.params.id
    const challenge = await first<ChallengeRow>(ctx.env, 'SELECT * FROM team_challenges WHERE id = ?', challengeId)
    if (!challenge) throw new HttpError(404, '挑战不存在')
    await assertTeamLeader(ctx.env, ctx.userId, challenge.team_id)

    if (!challenge.is_cancelled) throw new HttpError(400, '挑战未被取消')

    const remainingDays = challenge.remaining_days ?? 1
    const newEndDate = calcEndDate(utc8Today(), remainingDays)

    await run(
      ctx.env,
      'UPDATE team_challenges SET is_cancelled = 0, end_date = ?, remaining_days = NULL WHERE id = ?',
      newEndDate,
      challengeId
    )

    return Response.json({ ok: true })
  })
}
