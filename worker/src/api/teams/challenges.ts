import { on, body } from '../../router'
import { all, first, run, batch, uid, utc8Today, HttpError } from '../../db'
import { rateLimit } from '../../middleware/rateLimit'
import { notifyStatement } from '../community'
import { awardBadge } from '../badges'
import { nowSec, assertTeamMember, assertTeamLeader } from './shared'
import type { ChallengeRow, ChallengeType } from './shared'

/**
 * 组队挑战域路由：挑战创建 / 进度同步 / 编辑 / 删除 / 取消 / 恢复。
 * 多人组队完成打卡/刷题目标，达标全员获团队徽章。
 * 由 teams/index.ts 的 registerTeamRoutes 聚合注册。
 * 零逻辑改动：on(...) 块从原 teams.ts 逐字搬迁，仅调整 import 与包一层 registerChallengeRoutes()。
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

export function registerChallengeRoutes() {
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

    // 获取所有成员并初始化进度
    const members = await all<{ user_id: string }>(ctx.env, 'SELECT user_id FROM team_members WHERE team_id = ?', teamId)

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

    // 从用户数据计算当前进度
    let currentValue = 0

    if (challenge.type === 'streak') {
      // 连续打卡天数
      const g = await first<{ streak: number }>(ctx.env, 'SELECT streak FROM gamification WHERE user_id = ?', ctx.userId)
      currentValue = g?.streak ?? 0
    } else if (challenge.type === 'minutes') {
      // 挑战期间的学习时长
      const records = await all<{ minutes: number }>(
        ctx.env,
        `
      SELECT SUM(minutes) AS minutes FROM study_records
      WHERE user_id = ? AND date >= ? AND date <= ?
    `,
        ctx.userId,
        challenge.start_date,
        challenge.end_date
      )
      currentValue = records[0]?.minutes ?? 0
    } else if (challenge.type === 'problems') {
      // 挑战期间的刷题数
      const records = await all<{ total: number }>(
        ctx.env,
        `
      SELECT SUM(total) AS total FROM problem_sessions
      WHERE user_id = ? AND date >= ? AND date <= ?
    `,
        ctx.userId,
        challenge.start_date,
        challenge.end_date
      )
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
    const oldProgress = await first<{ is_completed: number }>(
      ctx.env,
      'SELECT is_completed FROM team_challenge_progress WHERE challenge_id = ? AND user_id = ?',
      challengeId,
      ctx.userId
    )

    if (isCompleted && !oldProgress?.is_completed) {
      const team = await first<{ name: string }>(ctx.env, 'SELECT name FROM study_teams WHERE id = ?', challenge.team_id)

      stmts.push(
        notifyStatement(ctx.env, {
          userId: ctx.userId,
          type: 'achievement',
          targetType: 'team',
          targetId: challenge.team_id,
          content: `恭喜！您完成了「${team?.name}」的挑战目标`
        })
      )
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
    const allCompleted = await first<{ total: number; completed: number }>(
      ctx.env,
      `
    SELECT COUNT(*) AS total, SUM(is_completed) AS completed
    FROM team_challenge_progress
    WHERE challenge_id = ?
  `,
      challengeId
    )

    // 全员达标：先原子抢占「已完成」标记，防止并发同步或重复同步导致重复发徽章与通知
    if (
      !challenge.is_completed &&
      allCompleted &&
      allCompleted.completed === allCompleted.total &&
      allCompleted.total > 0
    ) {
      const claimed = await run(
        ctx.env,
        'UPDATE team_challenges SET is_completed = 1 WHERE id = ? AND is_completed = 0',
        challengeId
      )
      if (claimed.meta.changes) {
        const team = await first<{ name: string }>(
          ctx.env,
          'SELECT name FROM study_teams WHERE id = ?',
          challenge.team_id
        )

        const members = await all<{ user_id: string }>(
          ctx.env,
          'SELECT user_id FROM team_members WHERE team_id = ?',
          challenge.team_id
        )

        const teamStmts: D1PreparedStatement[] = []
        // 为全员发放团队徽章并通知
        for (const m of members) {
          const badgeStmts = await awardBadge(ctx.env, m.user_id, 'team_champion')
          teamStmts.push(...badgeStmts)

          teamStmts.push(
            notifyStatement(ctx.env, {
              userId: m.user_id,
              type: 'achievement',
              targetType: 'team',
              targetId: challenge.team_id,
              content: `🎉 「${team?.name}」全员达标！获得团队徽章`
            })
          )
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

    return Response.json({ success: true })
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

    return Response.json({ success: true })
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

    return Response.json({ success: true })
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

    return Response.json({ success: true })
  })
}
