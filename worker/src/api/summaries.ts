import { on, body } from '../router'
import { all, run, HttpError } from '../db'

/** 每日总结（daily_summaries 表，主键 user_id+date，upsert 语义） */
export function registerSummaryRoutes() {
  on('GET', '/api/summaries', true, async (ctx) => {
    const rows = await all(ctx.env, 'SELECT * FROM daily_summaries WHERE user_id = ?', ctx.userId)
    return Response.json(rows.map((r: any) => ({
      date: r.date, mood: r.mood, harvest: r.harvest, improve: r.improve, plan: r.plan
    })))
  })

  on('PUT', '/api/summaries/:date', true, async (ctx) => {
    const date = ctx.params.date
    const b = await body<{ mood: string; harvest: string; improve: string; plan: string }>(ctx.request)
    if (!b?.mood) throw new HttpError(400, '心情不能为空')
    await run(ctx.env,
      'INSERT INTO daily_summaries (user_id, date, mood, harvest, improve, plan) VALUES (?, ?, ?, ?, ?, ?) ' +
      'ON CONFLICT(user_id, date) DO UPDATE SET mood = excluded.mood, harvest = excluded.harvest, improve = excluded.improve, plan = excluded.plan',
      ctx.userId, date, b.mood, b.harvest ?? '', b.improve ?? '', b.plan ?? '')
    return Response.json({ date, mood: b.mood, harvest: b.harvest ?? '', improve: b.improve ?? '', plan: b.plan ?? '' })
  })

  on('DELETE', '/api/summaries/:date', true, async (ctx) => {
    const res = await run(ctx.env, 'DELETE FROM daily_summaries WHERE user_id = ? AND date = ?', ctx.userId, ctx.params.date)
    if (!res.meta.changes) throw new HttpError(404, '总结不存在')
    return Response.json({ ok: true })
  })
}
