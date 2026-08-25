import type { Env } from '../index'
import { on, body } from '../router'
import { all, first, run, batch, uid, HttpError } from '../db'
import { rateLimit } from '../middleware/rateLimit'
import { displayName, notifyStatement } from './community'

const nowSec = () => Math.floor(Date.now() / 1000)

/** 搭子上限：最多 3 位，防止社交泛滥 */
const MAX_PARTNERS = 3

/** 校验当前用户搭子数是否已达上限（accepted 状态计入） */
async function checkPartnerLimit(env: Env, userId: string) {
  const row = await first<{ n: number }>(env,
    `SELECT COUNT(*) AS n FROM study_partners WHERE (from_id = ? OR to_id = ?) AND status = 'accepted'`,
    userId, userId)
  if ((row?.n ?? 0) >= MAX_PARTNERS) throw new HttpError(400, `搭子上限 ${MAX_PARTNERS} 人，请先解绑后再添加`)
}

/** 校验两用户是否为已确认搭子（双向绑定），返回关系行（供协作模块复用） */
export async function assertPartner(env: Env, userId: string, partnerId: string) {
  const pairKey = [userId, partnerId].sort().join(':')
  const rel = await first<{ id: string; from_id: string; to_id: string; status: string }>(env,
    `SELECT id, from_id, to_id, status FROM study_partners WHERE pair_key = ?`, pairKey)
  if (rel?.status !== 'accepted') throw new HttpError(403, '非搭子关系')
  return rel
}

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
    // 该接口对每位候选做 2 次子查询，限制调用频率避免放大查询压力
    rateLimit(ctx.request, 'community:partner:suggestions', 20, 60_000)
    const candidates = await all<any>(ctx.env, `
      SELECT u.id, u.username, u.verified, COALESCE(s.user_name, u.username) AS user_name,
        s.avatar, s.exam_date, COALESCE(g.points, 0) AS total_points
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
        userAvatar: c.avatar ?? undefined,
        totalPoints: c.total_points, score: exam + weak + hours, reasons
      })
    }
    suggestions.sort((a: any, b: any) => b.score - a.score)
    return Response.json({ suggestions: suggestions.slice(0, 10) })
  })

  // 我的搭子列表 + 收到的请求
  on('GET', '/api/community/partners', true, async (ctx) => {
    const partners = (await all<any>(ctx.env, `
      SELECT sp.id AS reqId, sp.updated_at, u.id AS userId, u.username, u.verified,
        COALESCE(s.user_name, u.username) AS userName, s.avatar AS userAvatar, COALESCE(g.points, 0) AS totalPoints
      FROM study_partners sp
      JOIN users u ON u.id = CASE WHEN sp.from_id = ? THEN sp.to_id ELSE sp.from_id END
      LEFT JOIN user_settings s ON s.user_id = u.id
      LEFT JOIN gamification g ON g.user_id = u.id
      WHERE sp.status = 'accepted' AND (sp.from_id = ? OR sp.to_id = ?)
      ORDER BY sp.updated_at DESC`, ctx.userId, ctx.userId, ctx.userId))
      .map((r: any) => ({ ...r, verified: !!r.verified }))
    const incoming = (await all<any>(ctx.env, `
      SELECT sp.id AS reqId, sp.created_at, u.id AS userId, u.username, u.verified,
        COALESCE(s.user_name, u.username) AS userName, s.avatar AS userAvatar, COALESCE(g.points, 0) AS totalPoints
      FROM study_partners sp
      JOIN users u ON u.id = sp.from_id
      LEFT JOIN user_settings s ON s.user_id = u.id
      LEFT JOIN gamification g ON g.user_id = u.id
      WHERE sp.to_id = ? AND sp.status = 'pending'
      ORDER BY sp.created_at DESC`, ctx.userId))
      .map((r: any) => ({ ...r, verified: !!r.verified }))
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
          // 对方已向我发 pending → 互相接受（立即成为搭子，校验上限）
          await checkPartnerLimit(ctx.env, ctx.userId)
          await batch(ctx.env, [
            ctx.env.DB.prepare('UPDATE study_partners SET status = ?, updated_at = ? WHERE id = ?').bind('accepted', nowSec(), existing.id),
            notifyStatement(ctx.env, { userId: targetId, type: 'system', targetType: 'partner', content: '🤝 有人已成为你的学习搭子' })
          ])
          return Response.json({ accepted: true })
        }
        throw new HttpError(400, '已发送过请求')
      }
      // rejected → 重新发起：方向改为我→对方
      await batch(ctx.env, [
        ctx.env.DB.prepare('UPDATE study_partners SET from_id = ?, to_id = ?, status = ?, updated_at = ? WHERE id = ?')
          .bind(ctx.userId, targetId, 'pending', nowSec(), existing.id),
        notifyStatement(ctx.env, { userId: targetId, type: 'system', targetType: 'partner', content: '有人想成为你的学习搭子，去看看' })
      ])
      return Response.json({ accepted: false }, { status: 201 })
    }

    // 不存在 → INSERT OR IGNORE（并发互相发起时 changes=0，改为按「互相接受」处理，避免 500）
    const id = uid()
    const inserted = await run(ctx.env,
      'INSERT OR IGNORE INTO study_partners (id, pair_key, from_id, to_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      id, pairKey, ctx.userId, targetId, 'pending', nowSec(), nowSec())
    if (!inserted.meta.changes) {
      // 并发冲突：对方刚也发起了请求，重新查询并互相接受
      const dup = await first<{ id: string; from_id: string; to_id: string; status: string }>(ctx.env,
        'SELECT id, from_id, to_id, status FROM study_partners WHERE pair_key = ?', pairKey)
      if (dup && dup.status === 'pending' && dup.to_id === ctx.userId) {
        // 并发冲突互相接受（立即成为搭子，校验上限）
        await checkPartnerLimit(ctx.env, ctx.userId)
        await batch(ctx.env, [
          ctx.env.DB.prepare('UPDATE study_partners SET status = ?, updated_at = ? WHERE id = ?').bind('accepted', nowSec(), dup.id),
          notifyStatement(ctx.env, { userId: targetId, type: 'system', targetType: 'partner', content: '🤝 有人已成为你的学习搭子' })
        ])
        return Response.json({ accepted: true })
      }
      return Response.json({ accepted: false }, { status: 201 })
    }

    await batch(ctx.env, [
      notifyStatement(ctx.env, { userId: targetId, type: 'system', targetType: 'partner', content: '有人想成为你的学习搭子，去看看' })
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
    // 接受请求 → 立即成为搭子，校验我的上限
    if (action === 'accept') await checkPartnerLimit(ctx.env, ctx.userId)
    const stmts = [
      ctx.env.DB.prepare(`UPDATE study_partners SET status = ?, updated_at = ? WHERE id = ?`)
        .bind(action === 'accept' ? 'accepted' : 'rejected', nowSec(), req.id)
    ]
    if (action === 'accept') {
      stmts.push(notifyStatement(ctx.env, { userId: req.from_id, type: 'system', targetType: 'partner', content: '🤝 对方已接受你的学习搭子请求' }))
    }
    await batch(ctx.env, stmts)
    return Response.json({ ok: true })
  })

  // 一键解绑搭子（无需对方同意，浅社交无心理负担）
  on('DELETE', '/api/community/partners/:userId', true, async (ctx) => {
    const partnerId = ctx.params.userId
    if (partnerId === ctx.userId) throw new HttpError(400, '不能解绑自己')
    const pairKey = [ctx.userId, partnerId].sort().join(':')
    const res = await run(ctx.env, `DELETE FROM study_partners WHERE pair_key = ?`, pairKey)
    if (!res.meta.changes) throw new HttpError(404, '搭子关系不存在')
    // 通知对方：搭子关系已解除（进入通知中心「搭子」分类）
    await batch(ctx.env, [
      notifyStatement(ctx.env, {
        userId: partnerId, type: 'partner', actorId: ctx.userId,
        targetType: 'partner', targetId: ctx.userId,
        content: `${await displayName(ctx.env, ctx.userId)} 解除了与你的搭子关系`
      })
    ])
    return Response.json({ ok: true })
  })

  // 搭子周报对比（本周学习时长/连续打卡/刷题数/番茄专注时长；受对方隐私开关管控）
  on('GET', '/api/community/partners/:userId/weekly-report', true, async (ctx) => {
    const partnerId = ctx.params.userId
    await assertPartner(ctx.env, ctx.userId, partnerId)

    // 对方隐私开关：未开放则仅返回标识，前端展示提示
    const settings = await first<{ partner_share_enabled: number }>(ctx.env,
      `SELECT partner_share_enabled FROM user_settings WHERE user_id = ?`, partnerId)
    if (!settings?.partner_share_enabled) {
      return Response.json({ shared: false })
    }

    // 本周区间（本周一至周日，UTC+8）
    const t = new Date(Date.now() + 8 * 3600_000)
    const daysSinceMonday = (t.getUTCDay() + 6) % 7
    const monday = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate() - daysSinceMonday))
    const fmt = (d: Date) => d.toISOString().slice(0, 10)
    const weekStart = fmt(monday)
    const weekEnd = fmt(new Date(monday.getTime() + 6 * 86400_000))

    async function stats(uid: string) {
      const [study, problems, pomodoro, gam] = await Promise.all([
        first<{ minutes: number }>(ctx.env,
          'SELECT COALESCE(SUM(minutes), 0) AS minutes FROM study_records WHERE user_id = ? AND date >= ? AND date <= ?',
          uid, weekStart, weekEnd),
        first<{ total: number }>(ctx.env,
          'SELECT COALESCE(SUM(total), 0) AS total FROM problem_sessions WHERE user_id = ? AND date >= ? AND date <= ?',
          uid, weekStart, weekEnd),
        first<{ minutes: number }>(ctx.env,
          'SELECT COALESCE(SUM(minutes), 0) AS minutes FROM pomodoro_daily WHERE user_id = ? AND date >= ? AND date <= ?',
          uid, weekStart, weekEnd),
        first<{ streak: number }>(ctx.env, 'SELECT streak FROM gamification WHERE user_id = ?', uid)
      ])
      return {
        minutes: study?.minutes ?? 0,           // 本周学习时长（分钟）
        problems: problems?.total ?? 0,         // 本周刷题数
        pomodoroMinutes: pomodoro?.minutes ?? 0, // 本周番茄专注时长（分钟）
        streak: gam?.streak ?? 0                // 连续打卡天数
      }
    }

    const [mine, theirs] = await Promise.all([stats(ctx.userId), stats(partnerId)])
    const partnerName = await displayName(ctx.env, partnerId)
    return Response.json({ shared: true, weekStart, weekEnd, partnerName, mine, theirs })
  })

  // 发送学习鼓励提醒（复用站内通知；受对方提醒开关管控）
  on('POST', '/api/community/partners/:userId/remind', true, async (ctx) => {
    rateLimit(ctx.request, 'community:partner:remind', 10)
    const partnerId = ctx.params.userId
    await assertPartner(ctx.env, ctx.userId, partnerId)

    // 对方提醒开关：完全关闭则拒绝，杜绝骚扰
    const settings = await first<{ partner_remind_enabled: number }>(ctx.env,
      `SELECT partner_remind_enabled FROM user_settings WHERE user_id = ?`, partnerId)
    if (!settings?.partner_remind_enabled) throw new HttpError(403, '对方已关闭学习提醒')

    const myName = await displayName(ctx.env, ctx.userId)
    await batch(ctx.env, [
      notifyStatement(ctx.env, {
        userId: partnerId, type: 'partner', actorId: ctx.userId,
        targetType: 'partner', targetId: ctx.userId,
        content: `${myName} 提醒你：该学习啦，一起加油～`
      })
    ])
    return Response.json({ ok: true })
  })
}
