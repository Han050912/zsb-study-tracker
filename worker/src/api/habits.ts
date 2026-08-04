import type { Env } from '../index'
import { on, body } from '../router'
import { all, first, run, batch, uid, HttpError } from '../db'

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
      id: h.id, name: h.name, type: h.type,
      target: h.target ?? undefined, bad: !!h.bad,
      records: recs, checkins
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
      env.DB.prepare('INSERT INTO habits (id, user_id, name, type, target, bad) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(id, userId, h.name, h.type, h.target ?? null, h.bad ? 1 : 0)
    )
    for (const [date, value] of Object.entries(h.records ?? {})) {
      stmts.push(
        env.DB.prepare('INSERT OR REPLACE INTO habit_records (user_id, habit_id, date, value, checkin) VALUES (?, ?, ?, ?, 0)')
          .bind(userId, id, date, String(value))
      )
    }
    for (const date of Object.keys(h.checkins ?? {})) {
      stmts.push(
        env.DB.prepare('INSERT OR REPLACE INTO habit_records (user_id, habit_id, date, value, checkin) VALUES (?, ?, ?, NULL, 1)')
          .bind(userId, id, date)
      )
    }
  }
  return stmts
}

export function registerHabitRoutes() {
  on('GET', '/api/habits', true, async (ctx) => {
    return Response.json(await getHabits(ctx.env, ctx.userId))
  })

  on('POST', '/api/habits', true, async (ctx) => {
    const b = await body<HabitFull>(ctx.request)
    if (!b?.name) throw new HttpError(400, '习惯名称不能为空')
    const id = b.id || uid()
    const stmts = habitReplaceStatements(ctx.env, ctx.userId, [{ ...b, id }]).slice(2)
    await batch(ctx.env, stmts)
    const created = (await getHabits(ctx.env, ctx.userId)).find(h => h.id === id)
    return Response.json(created, { status: 201 })
  })

  on('PUT', '/api/habits/:id', true, async (ctx) => {
    const id = ctx.params.id
    const exists = await first(ctx.env, 'SELECT id FROM habits WHERE id = ? AND user_id = ?', id, ctx.userId)
    if (!exists) throw new HttpError(404, '习惯不存在')
    const b = await body<HabitFull>(ctx.request)
    await batch(ctx.env, [
      ctx.env.DB.prepare('DELETE FROM habit_records WHERE habit_id = ? AND user_id = ?').bind(id, ctx.userId),
      ctx.env.DB.prepare('DELETE FROM habits WHERE id = ? AND user_id = ?').bind(id, ctx.userId),
      ...habitReplaceStatements(ctx.env, ctx.userId, [{ ...b, id }]).slice(2)
    ])
    const updated = (await getHabits(ctx.env, ctx.userId)).find(h => h.id === id)
    return Response.json(updated)
  })

  on('DELETE', '/api/habits/:id', true, async (ctx) => {
    const id = ctx.params.id
    const res = await run(ctx.env, 'DELETE FROM habits WHERE id = ? AND user_id = ?', id, ctx.userId)
    if (!res.meta.changes) throw new HttpError(404, '习惯不存在')
    await run(ctx.env, 'DELETE FROM habit_records WHERE habit_id = ? AND user_id = ?', id, ctx.userId)
    return Response.json({ ok: true })
  })
}
