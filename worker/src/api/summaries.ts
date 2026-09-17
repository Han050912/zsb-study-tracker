import { on } from '../router'
import { all } from '../db'

/** 每日总结（daily_summaries 表，主键 user_id+date，upsert 语义） */
export function registerSummaryRoutes() {
  on('GET', '/api/summaries', true, async (ctx) => {
    const rows = await all(ctx.env, 'SELECT * FROM daily_summaries WHERE user_id = ?', ctx.userId)
    return Response.json(
      rows.map((r: any) => ({
        date: r.date,
        mood: r.mood,
        harvest: r.harvest,
        improve: r.improve,
        plan: r.plan
      }))
    )
  })
}
