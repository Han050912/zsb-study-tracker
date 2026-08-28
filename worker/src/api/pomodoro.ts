import type { Env } from '../index'
import { on, body } from '../router'
import { all, batch } from '../db'

/** 番茄钟统计（pomodoro_daily + pomodoro_interruptions + pomodoro_records ↔ 前端 PomodoroStat） */

export interface PomodoroFull {
  daily: Record<string, { count: number; minutes: number; interruptions: number }>
  interruptions: { date: string; reason: string; time: number }[]
  records: { id: string; date: string; time: number; minutes: number; description: string; source: string; partnerName?: string }[]
}

export async function getPomodoro(env: Env, userId: string): Promise<PomodoroFull> {
  const dailyRows = await all(env, 'SELECT * FROM pomodoro_daily WHERE user_id = ?', userId)
  const interruptions = await all(env, 'SELECT * FROM pomodoro_interruptions WHERE user_id = ? ORDER BY id', userId)
  const recordRows = await all(env, 'SELECT * FROM pomodoro_records WHERE user_id = ? ORDER BY time', userId)
  const daily: PomodoroFull['daily'] = {}
  for (const r of dailyRows as any[]) {
    daily[r.date] = { count: r.count ?? 0, minutes: r.minutes ?? 0, interruptions: r.interruptions ?? 0 }
  }
  return {
    daily,
    interruptions: interruptions.map((r: any) => ({ date: r.date, reason: r.reason, time: r.time })),
    records: (recordRows as any[]).map((r) => ({
      id: r.id, date: r.date, time: r.time, minutes: r.minutes ?? 0,
      description: r.description ?? '', source: r.source ?? 'solo',
      partnerName: r.partner_name || undefined
    }))
  }
}

/** 生成番茄钟数据的替换语句 */
export function pomodoroReplaceStatements(env: Env, userId: string, p: PomodoroFull): D1PreparedStatement[] {
  const stmts: D1PreparedStatement[] = [
    env.DB.prepare('DELETE FROM pomodoro_daily WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM pomodoro_interruptions WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM pomodoro_records WHERE user_id = ?').bind(userId)
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
  for (const r of p.records ?? []) {
    // 跳过字段不完整的记录：D1 bind 不接受 undefined，否则整批 batch 原子回滚成 500
    if (!r?.id || !r.date || r.time == null) continue
    stmts.push(
      env.DB.prepare('INSERT INTO pomodoro_records (id, user_id, date, time, minutes, description, source, partner_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(r.id, userId, r.date, r.time, r.minutes ?? 0, r.description ?? '', r.source ?? 'solo', r.partnerName ?? null)
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
