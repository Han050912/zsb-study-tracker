import type { Env } from '../index'
import { on, body } from '../router'
import { all, first, batch, utc8Today } from '../db'

/** 游戏化（gamification 单行 + points_log 流水 ↔ 前端 Gamification） */

export interface GamificationFull {
  points: number
  streak: number
  lastCheckin: string
  achievements: string[]
  pointsLog: { date: string; points: number; reason: string; refId?: string }[]
}

export async function getGamification(env: Env, userId: string): Promise<GamificationFull> {
  const row = await first(env, 'SELECT * FROM gamification WHERE user_id = ?', userId)
  const log = await all(env, 'SELECT * FROM points_log WHERE user_id = ? ORDER BY id', userId)
  return {
    points: row?.points ?? 0,
    streak: row?.streak ?? 0,
    lastCheckin: row?.last_checkin ?? '',
    achievements: (() => {
      try {
        const v = JSON.parse(row?.achievements || '[]')
        return Array.isArray(v) ? v : []
      } catch {
        return []
      }
    })(),
    pointsLog: log.map((l: any) => ({
      date: l.date, points: l.points, reason: l.reason, refId: l.ref_id ?? undefined
    }))
  }
}

/**
 * 生成游戏化数据的替换语句。
 * points_log 只替换「本地来源」流水：服务端写入的流水（ref_id 带 'srv:' 前缀，如社区获赞/服务端规则奖励）
 * 必须保留——否则全量同步会冲掉这些流水，导致按 ref_id 精确回收积分（取消点赞/删评论）失效。
 */
export function gamificationReplaceStatements(env: Env, userId: string, g: GamificationFull): D1PreparedStatement[] {
  const stmts: D1PreparedStatement[] = [
    env.DB.prepare(
      'INSERT INTO gamification (user_id, points, streak, last_checkin, achievements) VALUES (?, ?, ?, ?, ?) ' +
      'ON CONFLICT(user_id) DO UPDATE SET points = excluded.points, streak = excluded.streak, last_checkin = excluded.last_checkin, achievements = excluded.achievements'
    ).bind(userId, g.points ?? 0, g.streak ?? 0, g.lastCheckin ?? '', JSON.stringify(g.achievements ?? [])),
    env.DB.prepare("DELETE FROM points_log WHERE user_id = ? AND (ref_id IS NULL OR ref_id NOT LIKE 'srv:%')").bind(userId)
  ]
  for (const l of g.pointsLog ?? []) {
    // 防御：客户端不应回传服务端流水（前端已过滤，这里兜底防伪造/重复）
    if (l.refId?.startsWith('srv:')) continue
    stmts.push(
      env.DB.prepare('INSERT INTO points_log (user_id, date, points, reason, ref_id) VALUES (?, ?, ?, ?, ?)')
        .bind(userId, l.date, l.points, l.reason, l.refId ?? null)
    )
  }
  return stmts
}

/** 服务端积分规则发放：gamification 加分 + points_log 写流水（refId 调用方需带 'srv:' 前缀） */
export function serverAwardStatements(env: Env, userId: string, points: number, reason: string, refId: string): D1PreparedStatement[] {
  return [
    env.DB.prepare(
      'INSERT INTO gamification (user_id, points) VALUES (?, ?) ' +
      'ON CONFLICT(user_id) DO UPDATE SET points = points + excluded.points'
    ).bind(userId, points),
    env.DB.prepare('INSERT INTO points_log (user_id, date, points, reason, ref_id) VALUES (?, ?, ?, ?, ?)')
      .bind(userId, utc8Today(), points, reason, refId)
  ]
}

export function registerGamificationRoutes() {
  on('GET', '/api/gamification', true, async (ctx) => {
    return Response.json(await getGamification(ctx.env, ctx.userId))
  })

  on('PUT', '/api/gamification', true, async (ctx) => {
    const b = await body<GamificationFull>(ctx.request)
    await batch(ctx.env, gamificationReplaceStatements(ctx.env, ctx.userId, b))
    return Response.json(await getGamification(ctx.env, ctx.userId))
  })
}
