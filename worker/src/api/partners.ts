import type { Env } from '../index'
import { on, body } from '../router'
import { all, first, batch, uid, HttpError } from '../db'
import { rateLimit } from '../middleware/rateLimit'
import { notifyStatement } from './community'

const nowSec = () => Math.floor(Date.now() / 1000)

/** 用户近 30 天学习最活跃的 Top 3 小时（UTC+8），用于活跃时段重叠匹配 */
async function topHours(env: Env, userId: string): Promise<number[]> {
  const rows = await all<{ h: number }>(env,
    `SELECT CAST(((created_at + 28800) % 86400) / 3600 AS INTEGER) AS h
     FROM study_records WHERE user_id = ? AND created_at >= ? GROUP BY h ORDER BY SUM(minutes) DESC LIMIT 3`,
    userId, nowSec() - 30 * 86400)
  return rows.map(r => r.h)
}

/** 用户薄弱科目 id 列表（mastery>0 且均值<3；全 0 新用户返回空） */
async function weakSubjects(env: Env, userId: string): Promise<string[]> {
  const rows = await all<{ subject_id: string }>(env,
    `SELECT c.subject_id FROM topics t
     JOIN chapters c ON c.id = t.chapter_id AND c.user_id = t.user_id
     WHERE t.user_id = ? AND t.mastery > 0
     GROUP BY c.subject_id HAVING AVG(t.mastery) < 3`, userId)
  return rows.map(r => r.subject_id)
}

/** 考试日期接近度打分（0-40） */
function examScore(myExam: string | null, otherExam: string | null): number {
  if (!myExam || !otherExam) return 0
  const a = new Date(myExam).getTime(), b = new Date(otherExam).getTime()
  const diff = Math.abs(a - b) / 86400_000
  if (diff <= 30) return 40
  if (diff <= 90) return 20
  return 0
}

/** 薄弱科目重叠度打分（0-30） */
function weakScore(my: string[], other: string[]): number {
  if (!my.length || !other.length) return 0
  const overlap = my.filter(s => other.includes(s)).length
  return Math.round(30 * overlap / my.length)
}

/** 活跃时段重叠度打分（0-30） */
function hoursScore(my: number[], other: number[]): number {
  if (!my.length || !other.length) return 0
  const overlap = my.filter(h => other.includes(h)).length
  return 30 * overlap / 3
}

export function registerPartnerRoutes() {
  // 推荐：三维打分（考试日期 40 + 薄弱科目 30 + 活跃时段 30）
  on('GET', '/api/community/partners/suggestions', true, async (ctx) => {
    const candidates = await all<any>(ctx.env, `
      SELECT u.id, u.username, u.verified, COALESCE(s.user_name, u.username) AS user_name,
        s.exam_date, COALESCE(g.points, 0) AS total_points
      FROM users u
      LEFT JOIN user_settings s ON s.user_id = u.id
      LEFT JOIN gamification g ON g.user_id = u.id
      WHERE u.id != ?
        AND u.id NOT IN (SELECT to_id FROM study_partners WHERE from_id = ? AND status != 'rejected')
        AND u.id NOT IN (SELECT from_id FROM study_partners WHERE to_id = ? AND status != 'rejected')
      ORDER BY g.points DESC
      LIMIT 50`, ctx.userId, ctx.userId, ctx.userId)

    const myExam = (await first<{ exam_date: string | null }>(ctx.env,
      'SELECT exam_date FROM user_settings WHERE user_id = ?', ctx.userId))?.exam_date ?? null
    const myWeak = await weakSubjects(ctx.env, ctx.userId)
    const myHours = await topHours(ctx.env, ctx.userId)

    const suggestions = []
    for (const c of candidates) {
      const [cWeak, cHours] = await Promise.all([weakSubjects(ctx.env, c.id), topHours(ctx.env, c.id)])
      const exam = examScore(myExam, c.exam_date)
      const weak = weakScore(myWeak, cWeak)
      const hours = hoursScore(myHours, cHours)
      const reasons: string[] = []
      if (exam > 0) reasons.push('考试时间接近')
      if (weak > 0) reasons.push('有相同的薄弱科目')
      if (hours > 0) reasons.push('学习时段相近')
      suggestions.push({
        userId: c.id, userName: c.user_name || '升本人', verified: !!c.verified,
        totalPoints: c.total_points, score: exam + weak + hours, reasons
      })
    }
    suggestions.sort((a: any, b: any) => b.score - a.score)
    return Response.json({ suggestions: suggestions.slice(0, 10) })
  })

  // 我的搭子列表 + 收到的请求
  on('GET', '/api/community/partners', true, async (ctx) => {
    const partners = await all<any>(ctx.env, `
      SELECT sp.id AS reqId, sp.updated_at, u.id AS userId, u.username, u.verified,
        COALESCE(s.user_name, u.username) AS userName, COALESCE(g.points, 0) AS totalPoints
      FROM study_partners sp
      JOIN users u ON u.id = CASE WHEN sp.from_id = ? THEN sp.to_id ELSE sp.from_id END
      LEFT JOIN user_settings s ON s.user_id = u.id
      LEFT JOIN gamification g ON g.user_id = u.id
      WHERE sp.status = 'accepted' AND (sp.from_id = ? OR sp.to_id = ?)
      ORDER BY sp.updated_at DESC`, ctx.userId, ctx.userId, ctx.userId)
    const incoming = await all<any>(ctx.env, `
      SELECT sp.id AS reqId, sp.created_at, u.id AS userId, u.username, u.verified,
        COALESCE(s.user_name, u.username) AS userName, COALESCE(g.points, 0) AS totalPoints
      FROM study_partners sp
      JOIN users u ON u.id = sp.from_id
      LEFT JOIN user_settings s ON s.user_id = u.id
      LEFT JOIN gamification g ON g.user_id = u.id
      WHERE sp.to_id = ? AND sp.status = 'pending'
      ORDER BY sp.created_at DESC`, ctx.userId)
    return Response.json({ partners, incoming })
  })

  // 发起搭子请求（pair_key 唯一约束根治并发；pending 反向 = 互相接受；rejected 后重发回 pending）
  on('POST', '/api/community/partners/:userId', true, async (ctx) => {
    rateLimit(ctx.request, 'community:partner', 10)
    const targetId = ctx.params.userId
    if (targetId === ctx.userId) throw new HttpError(400, '不能与自己成为搭子')
    const target = await first(ctx.env, 'SELECT id FROM users WHERE id = ?', targetId)
    if (!target) throw new HttpError(404, '用户不存在')
    const pairKey = [ctx.userId, targetId].sort().join(':')

    const existing = await first<{ id: string; from_id: string; to_id: string; status: string }>(ctx.env,
      'SELECT id, from_id, to_id, status FROM study_partners WHERE pair_key = ?', pairKey)
    if (existing) {
      if (existing.status === 'accepted') throw new HttpError(400, '你们已是搭子')
      if (existing.status === 'pending') {
        if (existing.to_id === ctx.userId) {
          // 对方已向我发 pending → 互相接受
          await batch(ctx.env, [
            ctx.env.DB.prepare('UPDATE study_partners SET status = ?, updated_at = ? WHERE id = ?').bind('accepted', nowSec(), existing.id),
            notifyStatement(ctx.env, { userId: targetId, type: 'system', content: '🤝 有人已成为你的学习搭子' })
          ])
          return Response.json({ accepted: true })
        }
        throw new HttpError(400, '已发送过请求')
      }
      // rejected → 重新发起：方向改为我→对方
      await batch(ctx.env, [
        ctx.env.DB.prepare('UPDATE study_partners SET from_id = ?, to_id = ?, status = ?, updated_at = ? WHERE id = ?')
          .bind(ctx.userId, targetId, 'pending', nowSec(), existing.id),
        notifyStatement(ctx.env, { userId: targetId, type: 'system', content: '有人想成为你的学习搭子，去看看' })
      ])
      return Response.json({ accepted: false }, { status: 201 })
    }

    // 不存在 → INSERT（UNIQUE 约束防并发重复；并发时一方会因冲突 500，重试即命中「reverse pending → accepted」）
    const id = uid()
    await batch(ctx.env, [
      ctx.env.DB.prepare('INSERT INTO study_partners (id, pair_key, from_id, to_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(id, pairKey, ctx.userId, targetId, 'pending', nowSec(), nowSec()),
      notifyStatement(ctx.env, { userId: targetId, type: 'system', content: '有人想成为你的学习搭子，去看看' })
    ])
    return Response.json({ accepted: false }, { status: 201 })
  })

  // 接受/拒绝请求
  on('PUT', '/api/community/partners/:requestId', true, async (ctx) => {
    const b = await body(ctx.request)
    const action = b?.action === 'accept' || b?.action === 'reject' ? b.action : null
    if (!action) throw new HttpError(400, 'action 需为 accept 或 reject')
    const req = await first<{ id: string; from_id: string }>(ctx.env,
      `SELECT id, from_id FROM study_partners WHERE id = ? AND to_id = ? AND status = 'pending'`, ctx.params.requestId, ctx.userId)
    if (!req) throw new HttpError(404, '请求不存在')
    const stmts = [
      ctx.env.DB.prepare(`UPDATE study_partners SET status = ?, updated_at = ? WHERE id = ?`)
        .bind(action === 'accept' ? 'accepted' : 'rejected', nowSec(), req.id)
    ]
    if (action === 'accept') {
      stmts.push(notifyStatement(ctx.env, { userId: req.from_id, type: 'system', content: '🤝 对方已接受你的学习搭子请求' }))
    }
    await batch(ctx.env, stmts)
    return Response.json({ ok: true })
  })
}
