import type { Env } from '../index'
import { on } from '../router'
import { all } from '../db'

/** 番茄钟统计（pomodoro_daily + pomodoro_interruptions + pomodoro_records ↔ 前端 PomodoroStat） */

export interface PomodoroFull {
  daily: Record<string, { count: number; minutes: number; interruptions: number }>
  interruptions: { date: string; reason: string; time: number }[]
  records: {
    id: string
    date: string
    time: number
    minutes: number
    description: string
    source: string
    partnerName?: string
  }[]
}

/** DB 行 → 前端番茄钟记录（getPomodoro 与记录级同步共用同一套字段映射） */
export function pomodoroRecordFromRow(r: any) {
  return {
    id: r.id,
    date: r.date,
    time: r.time,
    minutes: r.minutes ?? 0,
    description: r.description ?? '',
    source: r.source ?? 'solo',
    partnerName: r.partner_name || undefined
  }
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
    records: (recordRows as any[]).map(pomodoroRecordFromRow)
  }
}

/** `day:<date>` → pomodoro_daily 记录级 upsert（键即日期，值内的 date 以键为准） */
export function pomodoroDailyStatement(
  env: Env,
  userId: string,
  date: string,
  value: any,
  stamp: { updatedAt: number; seq: number }
): D1PreparedStatement {
  return env.DB.prepare(
    'INSERT INTO pomodoro_daily (user_id, date, count, minutes, interruptions, updated_at, server_seq) VALUES (?, ?, ?, ?, ?, ?, ?) ' +
      'ON CONFLICT(user_id, date) DO UPDATE SET count = excluded.count, minutes = excluded.minutes, interruptions = excluded.interruptions, updated_at = excluded.updated_at, server_seq = excluded.server_seq'
  ).bind(userId, date, value.count ?? 0, value.minutes ?? 0, value.interruptions ?? 0, stamp.updatedAt, stamp.seq)
}

/** `itr:<date>` → 该日打断列表整体替换（列表元素无业务 id，故先按 date 删除再插入） */
export function pomodoroInterruptionsStatements(
  env: Env,
  userId: string,
  date: string,
  items: { reason: string; time: number }[],
  stamp: { updatedAt: number; seq: number }
): D1PreparedStatement[] {
  const stmts: D1PreparedStatement[] = [
    env.DB.prepare('DELETE FROM pomodoro_interruptions WHERE user_id = ? AND date = ?').bind(userId, date)
  ]
  for (const it of items) {
    stmts.push(
      env.DB.prepare(
        'INSERT INTO pomodoro_interruptions (user_id, date, reason, time, updated_at, server_seq) VALUES (?, ?, ?, ?, ?, ?)'
      ).bind(userId, date, it.reason, it.time, stamp.updatedAt, stamp.seq)
    )
  }
  return stmts
}

/** `rec:<id>` → pomodoro_records 记录级 upsert（键即记录 id） */
export function pomodoroRecordStatement(
  env: Env,
  userId: string,
  id: string,
  value: any,
  stamp: { updatedAt: number; seq: number }
): D1PreparedStatement {
  return env.DB.prepare(
    'INSERT INTO pomodoro_records (id, user_id, date, time, minutes, description, source, partner_name, updated_at, server_seq) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ' +
      'ON CONFLICT(user_id, id) DO UPDATE SET date = excluded.date, time = excluded.time, minutes = excluded.minutes, description = excluded.description, source = excluded.source, partner_name = excluded.partner_name, updated_at = excluded.updated_at, server_seq = excluded.server_seq'
  ).bind(
    id,
    userId,
    value.date,
    value.time,
    value.minutes ?? 0,
    value.description ?? '',
    value.source ?? 'solo',
    value.partnerName ?? null,
    stamp.updatedAt,
    stamp.seq
  )
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
      env.DB.prepare(
        'INSERT INTO pomodoro_daily (user_id, date, count, minutes, interruptions) VALUES (?, ?, ?, ?, ?)'
      ).bind(userId, date, d.count ?? 0, d.minutes ?? 0, d.interruptions ?? 0)
    )
  }
  for (const i of p.interruptions ?? []) {
    stmts.push(
      env.DB.prepare('INSERT INTO pomodoro_interruptions (user_id, date, reason, time) VALUES (?, ?, ?, ?)').bind(
        userId,
        i.date,
        i.reason,
        i.time
      )
    )
  }
  for (const r of p.records ?? []) {
    // 跳过字段不完整的记录：D1 bind 不接受 undefined，否则整批 batch 原子回滚成 500
    if (!r?.id || !r.date || r.time == null) continue
    stmts.push(
      env.DB.prepare(
        'INSERT INTO pomodoro_records (id, user_id, date, time, minutes, description, source, partner_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(
        r.id,
        userId,
        r.date,
        r.time,
        r.minutes ?? 0,
        r.description ?? '',
        r.source ?? 'solo',
        r.partnerName ?? null
      )
    )
  }
  return stmts
}

export function registerPomodoroRoutes() {
  on('GET', '/api/pomodoro', true, async (ctx) => {
    return Response.json(await getPomodoro(ctx.env, ctx.userId))
  })
}
