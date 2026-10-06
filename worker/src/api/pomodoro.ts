import type { Env } from '../index'
import { on } from '../router'
import { all } from '../db'

/** 番茄钟统计（pomodoro_daily + pomodoro_interruptions + pomodoro_records ↔ 前端 PomodoroStat） */

export interface PomodoroFull {
  daily: Record<string, { count: number; minutes: number; interruptions: number }>
  interruptions: { id?: string; date: string; reason: string; time: number }[]
  records: {
    id: string
    date: string
    time: number
    minutes: number
    completed?: boolean
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
    completed: r.completed !== 0,
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
    interruptions: interruptions.map((r: any) => ({ id: r.event_id, date: r.date, reason: r.reason, time: r.time })),
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
    `INSERT INTO pomodoro_daily (user_id, date, legacy_count, legacy_minutes, legacy_interruptions, legacy_updated_at, updated_at, server_seq)
     SELECT ?, ?,
       MAX(0, ? - (SELECT COUNT(*) FROM pomodoro_records WHERE user_id = ? AND date = ? AND completed = 1)),
       MAX(0, ? - (SELECT COALESCE(SUM(minutes), 0) FROM pomodoro_records WHERE user_id = ? AND date = ?)),
       MAX(0, ? - (SELECT COUNT(*) FROM pomodoro_interruptions WHERE user_id = ? AND date = ?)), ?, ?, ?
     ON CONFLICT(user_id, date) DO UPDATE SET
       legacy_count = CASE WHEN ? THEN excluded.legacy_count ELSE MAX(pomodoro_daily.legacy_count, excluded.legacy_count) END,
       legacy_minutes = CASE WHEN ? THEN excluded.legacy_minutes ELSE MAX(pomodoro_daily.legacy_minutes, excluded.legacy_minutes) END,
       legacy_interruptions = CASE WHEN ? THEN excluded.legacy_interruptions ELSE MAX(pomodoro_daily.legacy_interruptions, excluded.legacy_interruptions) END,
       legacy_updated_at = MAX(pomodoro_daily.legacy_updated_at, excluded.legacy_updated_at),
       updated_at = MAX(pomodoro_daily.updated_at, excluded.updated_at), server_seq = excluded.server_seq`
  ).bind(
    userId,
    date,
    value.derived ? 0 : (value.count ?? 0),
    userId,
    date,
    value.derived ? 0 : (value.minutes ?? 0),
    userId,
    date,
    value.derived ? 0 : (value.interruptions ?? 0),
    userId,
    date,
    value.derived ? 0 : stamp.updatedAt,
    stamp.updatedAt,
    stamp.seq,
    value.replace ? 1 : 0,
    value.replace ? 1 : 0,
    value.replace ? 1 : 0
  )
}

/** 日列表按唯一事件合并；旧客户端没有 id 时使用稳定的历史身份。 */
export function pomodoroInterruptionsStatements(
  env: Env,
  userId: string,
  date: string,
  items: { id?: string; reason: string; time: number; independent?: boolean }[],
  stamp: { updatedAt: number; seq: number }
): D1PreparedStatement[] {
  const stmts: D1PreparedStatement[] = []
  for (const it of items) {
    const eventId = it.id || `legacy:${crypto.randomUUID()}`
    stmts.push(
      env.DB.prepare(
        `UPDATE pomodoro_daily SET legacy_interruptions = MAX(0, legacy_interruptions - 1)
      WHERE user_id = ? AND date = ? AND legacy_updated_at >= ? AND ? = 0
        AND NOT EXISTS (SELECT 1 FROM pomodoro_interruptions WHERE user_id = ? AND event_id = ?)`
      ).bind(userId, date, it.time, it.independent ? 1 : 0, userId, eventId)
    )
    stmts.push(
      env.DB.prepare(
        'INSERT OR IGNORE INTO pomodoro_interruptions (user_id, date, reason, time, event_id, updated_at, server_seq) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).bind(userId, date, it.reason, it.time, eventId, stamp.updatedAt, stamp.seq)
    )
  }
  // 同日期的增量仍回传完整列表，兼容客户端按日替换的合并契约。
  stmts.push(
    env.DB.prepare(
      'UPDATE pomodoro_interruptions SET updated_at = MAX(updated_at, ?) + 1, server_seq = ? WHERE user_id = ? AND date = ?'
    ).bind(stamp.updatedAt, stamp.seq, userId, date)
  )
  return stmts
}

/** A legacy daily snapshot may arrive before its missing detail. Consume only that snapshot's gap. */
export function consumePomodoroLegacyRecord(
  env: Env,
  userId: string,
  id: string,
  value: { date: string; time: number; minutes?: number; completed?: boolean; independent?: boolean }
) {
  return env.DB.prepare(
    `UPDATE pomodoro_daily SET
    legacy_count = MAX(0, legacy_count - ?), legacy_minutes = MAX(0, legacy_minutes - ?)
    WHERE user_id = ? AND date = ? AND legacy_updated_at >= ? AND ? = 0
      AND NOT EXISTS (SELECT 1 FROM pomodoro_records WHERE user_id = ? AND id = ? AND date = ?)`
  ).bind(
    value.completed === false ? 0 : 1,
    value.minutes ?? 0,
    userId,
    value.date,
    value.time,
    value.independent ? 1 : 0,
    userId,
    id,
    value.date
  )
}

/** 明细/打断已写入后，以唯一事实重算日汇总；legacy 列只保存升级前的缺失明细部分。 */
export function reconcilePomodoroDay(
  env: Env,
  userId: string,
  date: string,
  stamp: { updatedAt: number; seq: number }
) {
  return [
    env.DB.prepare('INSERT OR IGNORE INTO pomodoro_daily (user_id, date) VALUES (?, ?)').bind(userId, date),
    env.DB.prepare(
      `UPDATE pomodoro_daily SET
      count = legacy_count + (SELECT COUNT(*) FROM pomodoro_records WHERE user_id = ? AND date = ? AND completed = 1),
      minutes = legacy_minutes + (SELECT COALESCE(SUM(minutes), 0) FROM pomodoro_records WHERE user_id = ? AND date = ?),
      interruptions = legacy_interruptions + (SELECT COUNT(*) FROM pomodoro_interruptions WHERE user_id = ? AND date = ?),
      updated_at = MAX(updated_at, ?) + 1, server_seq = ? WHERE user_id = ? AND date = ?`
    ).bind(userId, date, userId, date, userId, date, stamp.updatedAt, stamp.seq, userId, date)
  ]
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
    'INSERT INTO pomodoro_records (id, user_id, date, time, minutes, description, source, partner_name, completed, updated_at, server_seq) VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, 1), ?, ?) ' +
      'ON CONFLICT(user_id, id) DO UPDATE SET date = excluded.date, time = excluded.time, minutes = excluded.minutes, description = excluded.description, source = excluded.source, partner_name = excluded.partner_name, completed = COALESCE(?, pomodoro_records.completed), updated_at = excluded.updated_at, server_seq = excluded.server_seq'
  ).bind(
    id,
    userId,
    value.date,
    value.time,
    value.minutes ?? 0,
    value.description ?? '',
    value.source ?? 'solo',
    value.partnerName ?? null,
    value.completed === undefined ? null : value.completed ? 1 : 0,
    stamp.updatedAt,
    stamp.seq,
    // 旧客户端编辑描述时不携带状态：保留现有 false；旧记录首次写入默认为已完成。
    value.completed === undefined ? null : value.completed ? 1 : 0
  )
}

export function registerPomodoroRoutes() {
  on('GET', '/api/pomodoro', true, async (ctx) => {
    return Response.json(await getPomodoro(ctx.env, ctx.userId))
  })
}
