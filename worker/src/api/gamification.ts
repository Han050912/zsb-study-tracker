import type { Env } from '../index'
import { on, body } from '../router'
import { all, first, batch } from '../db'

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

/** 生成游戏化数据的替换语句（含流水全量重写） */
export function gamificationReplaceStatements(env: Env, userId: string, g: GamificationFull): D1PreparedStatement[] {
  const stmts: D1PreparedStatement[] = [
    env.DB.prepare(
      'INSERT INTO gamification (user_id, points, streak, last_checkin, achievements) VALUES (?, ?, ?, ?, ?) ' +
      'ON CONFLICT(user_id) DO UPDATE SET points = excluded.points, streak = excluded.streak, last_checkin = excluded.last_checkin, achievements = excluded.achievements'
    ).bind(userId, g.points ?? 0, g.streak ?? 0, g.lastCheckin ?? '', JSON.stringify(g.achievements ?? [])),
    env.DB.prepare('DELETE FROM points_log WHERE user_id = ?').bind(userId)
  ]
  for (const l of g.pointsLog ?? []) {
    stmts.push(
      env.DB.prepare('INSERT INTO points_log (user_id, date, points, reason, ref_id) VALUES (?, ?, ?, ?, ?)')
        .bind(userId, l.date, l.points, l.reason, l.refId ?? null)
    )
  }
  return stmts
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
