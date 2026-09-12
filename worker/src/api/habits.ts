import type { Env } from '../index'
import { on } from '../router'
import { all, uid } from '../db'

/**
 * 习惯追踪：
 * - habits 表存习惯本体；habit_records 表按 (habit_id, date) 存值或坏习惯克制打卡
 * - 前端 Habit 内嵌 records（date → 值）与 checkins（date → 1）
 */

export interface HabitFull {
  id: string
  name: string
  type: string
  target?: number
  bad?: boolean
  records: Record<string, number | string>
  checkins?: Record<string, number>
}

/** 拉取某用户全部习惯（含打卡记录） */
export async function getHabits(env: Env, userId: string): Promise<HabitFull[]> {
  const habits = await all(env, 'SELECT * FROM habits WHERE user_id = ?', userId)
  if (!habits.length) return []
  const records = await all(env, 'SELECT * FROM habit_records WHERE user_id = ?', userId)

  const byHabit = new Map<string, any[]>()
  for (const r of records) {
    const list = byHabit.get(r.habit_id) ?? []
    list.push(r)
    byHabit.set(r.habit_id, list)
  }

  return habits.map((h: any) => {
    const recs: Record<string, number | string> = {}
    const checkins: Record<string, number> = {}
    for (const r of byHabit.get(h.id) ?? []) {
      if (r.checkin) checkins[r.date] = 1
      else if (r.value !== null && r.value !== undefined) {
        const n = Number(r.value)
        recs[r.date] = Number.isNaN(n) ? r.value : n
      }
    }
    return {
      id: h.id,
      name: h.name,
      type: h.type,
      target: h.target ?? undefined,
      bad: !!h.bad,
      records: recs,
      checkins
    }
  })
}

/** 生成某用户全部习惯数据的替换语句（先删后插） */
export function habitReplaceStatements(env: Env, userId: string, habits: HabitFull[]): D1PreparedStatement[] {
  const stmts: D1PreparedStatement[] = [
    env.DB.prepare('DELETE FROM habit_records WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM habits WHERE user_id = ?').bind(userId)
  ]
  for (const h of habits) {
    const id = h.id || uid()
    stmts.push(
      env.DB.prepare('INSERT INTO habits (id, user_id, name, type, target, bad) VALUES (?, ?, ?, ?, ?, ?)').bind(
        id,
        userId,
        h.name,
        h.type,
        h.target ?? null,
        h.bad ? 1 : 0
      )
    )
    for (const [date, value] of Object.entries(h.records ?? {})) {
      stmts.push(
        env.DB.prepare(
          'INSERT OR REPLACE INTO habit_records (user_id, habit_id, date, value, checkin) VALUES (?, ?, ?, ?, 0)'
        ).bind(userId, id, date, String(value))
      )
    }
    for (const date of Object.keys(h.checkins ?? {})) {
      stmts.push(
        env.DB.prepare(
          'INSERT OR REPLACE INTO habit_records (user_id, habit_id, date, value, checkin) VALUES (?, ?, ?, NULL, 1)'
        ).bind(userId, id, date)
      )
    }
  }
  return stmts
}

/**
 * 单个习惯的记录级写入（键 = habitId）：先重建该习惯的打卡表，再 upsert habits 行。
 * 记录级同步下 habits 行与 habit_records 行写入同一份 `updated_at/server_seq`（子表行继承习惯记录的值）。
 */
export function habitUpsertStatements(
  env: Env,
  userId: string,
  h: HabitFull,
  stamp: { updatedAt: number; seq: number }
): D1PreparedStatement[] {
  const id = h.id
  const stmts: D1PreparedStatement[] = [
    env.DB.prepare('DELETE FROM habit_records WHERE user_id = ? AND habit_id = ?').bind(userId, id),
    env.DB.prepare(
      'INSERT INTO habits (id, user_id, name, type, target, bad, updated_at, server_seq) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ' +
        'ON CONFLICT(user_id, id) DO UPDATE SET name = excluded.name, type = excluded.type, target = excluded.target, bad = excluded.bad, updated_at = excluded.updated_at, server_seq = excluded.server_seq'
    ).bind(id, userId, h.name, h.type, h.target ?? null, h.bad ? 1 : 0, stamp.updatedAt, stamp.seq)
  ]
  for (const [date, value] of Object.entries(h.records ?? {})) {
    stmts.push(
      env.DB.prepare(
        'INSERT OR REPLACE INTO habit_records (user_id, habit_id, date, value, checkin, updated_at, server_seq) VALUES (?, ?, ?, ?, 0, ?, ?)'
      ).bind(userId, id, date, String(value), stamp.updatedAt, stamp.seq)
    )
  }
  for (const date of Object.keys(h.checkins ?? {})) {
    stmts.push(
      env.DB.prepare(
        'INSERT OR REPLACE INTO habit_records (user_id, habit_id, date, value, checkin, updated_at, server_seq) VALUES (?, ?, ?, NULL, 1, ?, ?)'
      ).bind(userId, id, date, stamp.updatedAt, stamp.seq)
    )
  }
  return stmts
}

/** 删除单个习惯：打卡表 + 习惯本体 */
export function habitDeleteStatements(env: Env, userId: string, habitId: string): D1PreparedStatement[] {
  return [
    env.DB.prepare('DELETE FROM habit_records WHERE user_id = ? AND habit_id = ?').bind(userId, habitId),
    env.DB.prepare('DELETE FROM habits WHERE user_id = ? AND id = ?').bind(userId, habitId)
  ]
}

export function registerHabitRoutes() {
  on('GET', '/api/habits', true, async (ctx) => {
    return Response.json(await getHabits(ctx.env, ctx.userId))
  })
}
