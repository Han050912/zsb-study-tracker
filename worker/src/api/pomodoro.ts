import type { Env } from '../index'
import { on, body } from '../router'
import { all, batch } from '../db'

/** 番茄钟统计（pomodoro_daily + pomodoro_interruptions + pomodoro_partial_sessions ↔ 前端 PomodoroStat） */

export interface PomodoroFull {
  daily: Record<string, { count: number; minutes: number; interruptions: number }>
  interruptions: { date: string; reason: string; time: number }[]
  partialSessions: { date: string; minutes: number; time: number }[]
}

export async function getPomodoro(env: Env, userId: string): Promise<PomodoroFull> {
  const dailyRows = await all(env, 'SELECT * FROM pomodoro_daily WHERE user_id = ?', userId)
  const interruptions = await all(env, 'SELECT * FROM pomodoro_interruptions WHERE user_id = ? ORDER BY id', userId)
  const partialSessions = await all(env, 'SELECT * FROM pomodoro_partial_sessions WHERE user_id = ? ORDER BY id', userId)
  const daily: PomodoroFull['daily'] = {}
  for (const r of dailyRows as any[]) {
    daily[r.date] = { count: r.count ?? 0, minutes: r.minutes ?? 0, interruptions: r.interruptions ?? 0 }
  }
  return {
    daily,
    interruptions: interruptions.map((r: any) => ({ date: r.date, reason: r.reason, time: r.time })),
    partialSessions: partialSessions.map((r: any) => ({ date: r.date, minutes: r.minutes, time: r.time }))
  }
}

/** 生成番茄钟数据的替换语句 */
export function pomodoroReplaceStatements(env: Env, userId: string, p: PomodoroFull): D1PreparedStatement[] {
  const stmts: D1PreparedStatement[] = [
    env.DB.prepare('DELETE FROM pomodoro_daily WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM pomodoro_interruptions WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM pomodoro_partial_sessions WHERE user_id = ?').bind(userId)
  ]
  for (const [date, d] of Object.entries(p.daily ?? {})) {
    stmts.push(
      env.DB.prepare('INSERT INTO pomodoro_daily (user_id, date, count, minutes, interruptions) VALUES (?, ?, ?, ?, ?)')
        .bind(userId, date, d.count ?? 0, d.minutes ?? 0, d.interruptions ?? 0)
    )
  }
  for (const i of p.interruptions ?? []) {
    stmts.push(
      env.DB.prepare('INSERT INTO pomodoro_interruptions (user_id, date, reason, time) VALUES (?, ?, ?, ?)')
        .bind(userId, i.date, i.reason, i.time)
    )
  }
  for (const s of p.partialSessions ?? []) {
    stmts.push(
      env.DB.prepare('INSERT INTO pomodoro_partial_sessions (user_id, date, minutes, time) VALUES (?, ?, ?, ?)')
        .bind(userId, s.date, s.minutes, s.time)
    )
  }
  return stmts
}

export function registerPomodoroRoutes() {
  on('GET', '/api/pomodoro', true, async (ctx) => {
    return Response.json(await getPomodoro(ctx.env, ctx.userId))
  })

  on('PUT', '/api/pomodoro', true, async (ctx) => {
    const b = await body<PomodoroFull>(ctx.request)
    await batch(ctx.env, pomodoroReplaceStatements(ctx.env, ctx.userId, b))
    return Response.json(await getPomodoro(ctx.env, ctx.userId))
  })
}
