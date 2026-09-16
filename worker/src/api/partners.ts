import type { Env } from '../index'
import { on, body } from '../router'
import { all, first, run, batch, uid, HttpError } from '../db'
import { rateLimit } from '../middleware/rateLimit'
import { displayName, notifyStatement } from './community'

const nowSec = () => Math.floor(Date.now() / 1000)

/** 周报四项统计 */
export interface WeeklyStats {
  minutes: number
  problems: number
  pomodoroMinutes: number
  streak: number
}

/** 统计某用户在 [weekStart, weekEnd] 区间（YYYY-MM-DD）的四项学习指标 */
async function weeklyStats(env: Env, uid: string, weekStart: string, weekEnd: string): Promise<WeeklyStats> {
  const [study, problems, pomodoro, gam] = await Promise.all([
    first<{ minutes: number }>(
      env,
      'SELECT COALESCE(SUM(minutes), 0) AS minutes FROM study_records WHERE user_id = ? AND date >= ? AND date <= ?',
      uid,
      weekStart,
      weekEnd
    ),
    first<{ total: number }>(
      env,
      'SELECT COALESCE(SUM(total), 0) AS total FROM problem_sessions WHERE user_id = ? AND date >= ? AND date <= ?',
      uid,
      weekStart,
      weekEnd
    ),
    first<{ minutes: number }>(
      env,
      'SELECT COALESCE(SUM(minutes), 0) AS minutes FROM pomodoro_daily WHERE user_id = ? AND date >= ? AND date <= ?',
      uid,
      weekStart,
      weekEnd
    ),
    first<{ streak: number }>(env, 'SELECT streak FROM gamification WHERE user_id = ?', uid)
  ])
  return {
    minutes: study?.minutes ?? 0,
    problems: problems?.total ?? 0,
    pomodoroMinutes: pomodoro?.minutes ?? 0,
    streak: gam?.streak ?? 0
  }
}

/** IN (...) 分块大小：留出日期等其它绑定参数余量，避免超 D1 100 绑定上限（与社区域 REVOKE_CHUNK 同口径） */
const IN_CHUNK = 90

/** 批量取展示名（用户设置昵称优先，回退用户名；与 displayName 同口径，缺失回退「升本人」） */
async function displayNamesBatch(env: Env, uids: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  for (let i = 0; i < uids.length; i += IN_CHUNK) {
    const part = uids.slice(i, i + IN_CHUNK)
    const rows = await all<{ id: string; name: string }>(
      env,
      `SELECT u.id, COALESCE(s.user_name, u.username) AS name FROM users u
       LEFT JOIN user_settings s ON s.user_id = u.id
       WHERE u.id IN (${part.map(() => '?').join(',')})`,
      ...part
    )
    for (const r of rows) map.set(r.id, r.name || '升本人')
  }
  return map
}

/** 批量周统计（cron 专用）：分块 GROUP BY 一次取全部用户的四项指标，替代逐用户 4 次查询 */
async function weeklyStatsBatch(
  env: Env,
  uids: string[],
  weekStart: string,
  weekEnd: string
): Promise<Map<string, WeeklyStats>> {
  const map = new Map<string, WeeklyStats>()
  for (const u of uids) map.set(u, { minutes: 0, problems: 0, pomodoroMinutes: 0, streak: 0 })
  for (let i = 0; i < uids.length; i += IN_CHUNK) {
    const part = uids.slice(i, i + IN_CHUNK)
    const ph = part.map(() => '?').join(',')
    const [study, problems, pomodoro, gam] = await Promise.all([
      all<{ user_id: string; v: number }>(
        env,
        `SELECT user_id, COALESCE(SUM(minutes), 0) AS v FROM study_records WHERE user_id IN (${ph}) AND date >= ? AND date <= ? GROUP BY user_id`,
        ...part,
        weekStart,
        weekEnd
      ),
      all<{ user_id: string; v: number }>(
        env,
        `SELECT user_id, COALESCE(SUM(total), 0) AS v FROM problem_sessions WHERE user_id IN (${ph}) AND date >= ? AND date <= ? GROUP BY user_id`,
        ...part,
        weekStart,
        weekEnd
      ),
      all<{ user_id: string; v: number }>(
        env,
        `SELECT user_id, COALESCE(SUM(minutes), 0) AS v FROM pomodoro_daily WHERE user_id IN (${ph}) AND date >= ? AND date <= ? GROUP BY user_id`,
        ...part,
        weekStart,
        weekEnd
      ),
      all<{ user_id: string; v: number }>(
        env,
        `SELECT user_id, streak AS v FROM gamification WHERE user_id IN (${ph})`,
        ...part
      )
    ])
    for (const r of study) {
      const s = map.get(r.user_id)
      if (s) s.minutes = r.v ?? 0
    }
    for (const r of problems) {
      const s = map.get(r.user_id)
      if (s) s.problems = r.v ?? 0
    }
    for (const r of pomodoro) {
      const s = map.get(r.user_id)
      if (s) s.pomodoroMinutes = r.v ?? 0
    }
    for (const r of gam) {
      const s = map.get(r.user_id)
      if (s) s.streak = r.v ?? 0
    }
  }
  return map
}

/** 搭子上限：最多 3 位，防止社交泛滥 */
const MAX_PARTNERS = 3

/**
 * 搭子上限单点校验（所有「成为搭子」入口共用：发起 / 互相接受 / 接受 / 并发互相接受）。
 * userIds 中任一用户已满 MAX_PARTNERS 即抛 400；actorId 为当前操作者，用于区分
 * 「你的上限已满」与「对方上限已满」的提示文案。因接受侧也校验发起方，故「我的搭子 x/3」永不越界。
 */
async function assertPartnersUnderLimit(env: Env, userIds: string[], actorId: string) {
  for (const id of new Set(userIds)) {
    const row = await first<{ n: number }>(
      env,
      `SELECT COUNT(*) AS n FROM study_partners WHERE (from_id = ? OR to_id = ?) AND status = 'accepted'`,
      id,
      id
    )
    if ((row?.n ?? 0) >= MAX_PARTNERS) {
      throw new HttpError(
        400,
        id === actorId
          ? `你的搭子已达上限 ${MAX_PARTNERS} 人，请先解绑后再添加`
          : `对方的搭子已达上限 ${MAX_PARTNERS} 人，暂时无法成为搭子`
      )
    }
  }
}

/** 我当前的已确认搭子 id 集合（协作列表口径单点：只展示对手方仍是搭子的行，解绑后即消失，无「半可用」） */
export async function currentPartnerIds(env: Env, userId: string): Promise<Set<string>> {
  const rows = await all<{ id: string }>(
    env,
    `SELECT CASE WHEN from_id = ? THEN to_id ELSE from_id END AS id
     FROM study_partners WHERE status = 'accepted' AND (from_id = ? OR to_id = ?)`,
    userId,
    userId,
    userId
  )
  return new Set(rows.map((r) => r.id))
}

/** 校验两用户是否为已确认搭子（双向绑定），返回关系行（供协作模块复用） */
export async function assertPartner(env: Env, userId: string, partnerId: string) {
  const pairKey = [userId, partnerId].sort().join(':')
  const rel = await first<{ id: string; from_id: string; to_id: string; status: string }>(
    env,
    `SELECT id, from_id, to_id, status FROM study_partners WHERE pair_key = ?`,
    pairKey
  )
  if (rel?.status !== 'accepted') throw new HttpError(403, '非搭子关系')
  return rel
}

/** 用户近 30 天学习最活跃的 Top 3 小时（UTC+8），用于活跃时段重叠匹配 */
async function topHours(env: Env, userId: string): Promise<number[]> {
  const rows = await all<{ h: number }>(
    env,
    `SELECT CAST(((created_at + 28800) % 86400) / 3600 AS INTEGER) AS h
     FROM study_records WHERE user_id = ? AND created_at >= ? GROUP BY h ORDER BY SUM(minutes) DESC LIMIT 3`,
    userId,
    nowSec() - 30 * 86400
  )
  return rows.map((r) => r.h)
}

/** 用户薄弱科目 id 列表（mastery>0 且均值<3；全 0 新用户返回空） */
async function weakSubjects(env: Env, userId: string): Promise<string[]> {
  const rows = await all<{ subject_id: string }>(
    env,
    `SELECT c.subject_id FROM topics t
     JOIN chapters c ON c.id = t.chapter_id AND c.user_id = t.user_id
     WHERE t.user_id = ? AND t.mastery > 0
     GROUP BY c.subject_id HAVING AVG(t.mastery) < 3`,
    userId
  )
  return rows.map((r) => r.subject_id)
}

/** 考试日期接近度打分（0-40） */
function examScore(myExam: string | null, otherExam: string | null): number {
  if (!myExam || !otherExam) return 0
  const a = new Date(myExam).getTime(),
    b = new Date(otherExam).getTime()
  const diff = Math.abs(a - b) / 86400_000
  if (diff <= 30) return 40
  if (diff <= 90) return 20
  return 0
}

/** 薄弱科目重叠度打分（0-30） */
function weakScore(my: string[], other: string[]): number {
  if (!my.length || !other.length) return 0
  const overlap = my.filter((s) => other.includes(s)).length
  return Math.round((30 * overlap) / my.length)
}

/** 活跃时段重叠度打分（0-30） */
function hoursScore(my: number[], other: number[]): number {
  if (!my.length || !other.length) return 0
  const overlap = my.filter((h) => other.includes(h)).length
  return (30 * overlap) / 3
}

export function registerPartnerRoutes() {
  // 推荐：三维打分（考试日期 40 + 薄弱科目 30 + 活跃时段 30）
  on('GET', '/api/community/partners/suggestions', true, async (ctx) => {
    // 候选人薄弱科目/活跃时段已合并为 2 次 IN 批量查询（替代逐候选 2 次子查询），限流仍用于控制高频调用总压力
    await rateLimit(ctx, 'community:partner:suggestions', 20)
    const candidates = await all<any>(
      ctx.env,
      `
      SELECT u.id, u.username, u.verified, COALESCE(s.user_name, u.username) AS user_name,
        s.avatar, s.exam_date, COALESCE(g.points, 0) AS total_points
      FROM users u
      LEFT JOIN user_settings s ON s.user_id = u.id
      LEFT JOIN gamification g ON g.user_id = u.id
      WHERE u.id != ?
        AND u.id NOT IN (SELECT to_id FROM study_partners WHERE from_id = ? AND status != 'rejected')
        AND u.id NOT IN (SELECT from_id FROM study_partners WHERE to_id = ? AND status != 'rejected')
      ORDER BY g.points DESC
      LIMIT 50`,
      ctx.userId,
      ctx.userId,
      ctx.userId
    )

    const myExam =
      (
        await first<{ exam_date: string | null }>(
          ctx.env,
          'SELECT exam_date FROM user_settings WHERE user_id = ?',
          ctx.userId
        )
      )?.exam_date ?? null
    const myWeak = await weakSubjects(ctx.env, ctx.userId)
    const myHours = await topHours(ctx.env, ctx.userId)

    // 批量取全部候选人的薄弱科目（按 候选×科目 分组，与逐候选弱科目查询等价）
    const candIds = candidates.map((c) => c.id)
    const weakRows = candIds.length
      ? await all<{ user_id: string; subject_id: string }>(
          ctx.env,
          `SELECT t.user_id, c.subject_id FROM topics t
           JOIN chapters c ON c.id = t.chapter_id AND c.user_id = t.user_id
           WHERE t.user_id IN (${candIds.map(() => '?').join(',')}) AND t.mastery > 0
           GROUP BY t.user_id, c.subject_id HAVING AVG(t.mastery) < 3`,
          ...candIds
        )
      : []
    const candWeak = new Map<string, string[]>()
    for (const r of weakRows) {
      const arr = candWeak.get(r.user_id) ?? []
      arr.push(r.subject_id)
      candWeak.set(r.user_id, arr)
    }

    // 批量取全部候选人的活跃时段（按 候选×小时 分组求和，降序后各取前 3，与逐候选 topHours 等价）
    const hourRows = candIds.length
      ? await all<{ user_id: string; h: number }>(
          ctx.env,
          `SELECT user_id, CAST(((created_at + 28800) % 86400) / 3600 AS INTEGER) AS h
           FROM study_records WHERE user_id IN (${candIds.map(() => '?').join(',')}) AND created_at >= ?
           GROUP BY user_id, h ORDER BY user_id, SUM(minutes) DESC`,
          ...candIds,
          nowSec() - 30 * 86400
        )
      : []
    const candHours = new Map<string, number[]>()
    for (const r of hourRows) {
      const arr = candHours.get(r.user_id) ?? []
      if (arr.length < 3) arr.push(r.h)
      candHours.set(r.user_id, arr)
    }

    const suggestions = []
    for (const c of candidates) {
      const cWeak = candWeak.get(c.id) ?? []
      const cHours = candHours.get(c.id) ?? []
      const exam = examScore(myExam, c.exam_date)
      const weak = weakScore(myWeak, cWeak)
      const hours = hoursScore(myHours, cHours)
      const reasons: string[] = []
      if (exam > 0) reasons.push('考试时间接近')
      if (weak > 0) reasons.push('有相同的薄弱科目')
      if (hours > 0) reasons.push('学习时段相近')
      suggestions.push({
        userId: c.id,
        userName: c.user_name || '升本人',
        verified: !!c.verified,
        userAvatar: c.avatar ?? undefined,
        totalPoints: c.total_points,
        score: exam + weak + hours,
        reasons
      })
    }
    suggestions.sort((a: any, b: any) => b.score - a.score)
    return Response.json({ suggestions: suggestions.slice(0, 10) })
  })

  // 我的搭子列表 + 收到的请求
  on('GET', '/api/community/partners', true, async (ctx) => {
    const partners = (
      await all<any>(
        ctx.env,
        `
      SELECT sp.id AS reqId, sp.updated_at, u.id AS userId, u.username, u.verified,
        COALESCE(s.user_name, u.username) AS userName, s.avatar AS userAvatar, COALESCE(g.points, 0) AS totalPoints
      FROM study_partners sp
      JOIN users u ON u.id = CASE WHEN sp.from_id = ? THEN sp.to_id ELSE sp.from_id END
      LEFT JOIN user_settings s ON s.user_id = u.id
      LEFT JOIN gamification g ON g.user_id = u.id
      WHERE sp.status = 'accepted' AND (sp.from_id = ? OR sp.to_id = ?)
      ORDER BY sp.updated_at DESC`,
        ctx.userId,
        ctx.userId,
        ctx.userId
      )
    ).map((r: any) => ({ ...r, verified: !!r.verified }))
    const incoming = (
      await all<any>(
        ctx.env,
        `
      SELECT sp.id AS reqId, sp.created_at, u.id AS userId, u.username, u.verified,
        COALESCE(s.user_name, u.username) AS userName, s.avatar AS userAvatar, COALESCE(g.points, 0) AS totalPoints
      FROM study_partners sp
      JOIN users u ON u.id = sp.from_id
      LEFT JOIN user_settings s ON s.user_id = u.id
      LEFT JOIN gamification g ON g.user_id = u.id
      WHERE sp.to_id = ? AND sp.status = 'pending'
      ORDER BY sp.created_at DESC`,
        ctx.userId
      )
    ).map((r: any) => ({ ...r, verified: !!r.verified }))
    return Response.json({ partners, incoming })
  })

  // 发起搭子请求（pair_key 唯一约束根治并发；pending 反向 = 互相接受；rejected 后重发回 pending）
  // 状态码约定：新建或复活请求行（首次发起 / rejected 重发 / 并发冲突时行已由并发孪生请求建成）→ 201；
  // 仅在既有行上做状态转移（pending 反向互相接受，含并发冲突分支）→ 200
  on('POST', '/api/community/partners/:userId', true, async (ctx) => {
    await rateLimit(ctx, 'community:partner', 10)
    const targetId = ctx.params.userId
    if (targetId === ctx.userId) throw new HttpError(400, '不能与自己成为搭子')
    const target = await first(ctx.env, 'SELECT id FROM users WHERE id = ?', targetId)
    if (!target) throw new HttpError(404, '用户不存在')
    const pairKey = [ctx.userId, targetId].sort().join(':')

    const existing = await first<{ id: string; from_id: string; to_id: string; status: string }>(
      ctx.env,
      'SELECT id, from_id, to_id, status FROM study_partners WHERE pair_key = ?',
      pairKey
    )
    if (existing?.status === 'accepted') throw new HttpError(400, '你们已是搭子')
    // 发起方上限（新建 / 重发 / 互相接受均需发起方未满）：超限即刻给出明确提示，避免对方接受后越界
    await assertPartnersUnderLimit(ctx.env, [ctx.userId], ctx.userId)
    if (existing) {
      if (existing.status === 'pending') {
        if (existing.to_id === ctx.userId) {
          // 对方已向我发 pending → 互相接受（双方均校验上限）
          await assertPartnersUnderLimit(ctx.env, [ctx.userId, targetId], ctx.userId)
          await batch(ctx.env, [
            ctx.env.DB.prepare('UPDATE study_partners SET status = ?, updated_at = ? WHERE id = ?').bind(
              'accepted',
              nowSec(),
              existing.id
            ),
            notifyStatement(ctx.env, {
              userId: targetId,
              type: 'system',
              targetType: 'partner',
              content: '🤝 有人已成为你的学习搭子'
            })
          ])
          return Response.json({ accepted: true })
        }
        throw new HttpError(400, '已发送过请求')
      }
      // rejected → 重新发起：方向改为我→对方
      await batch(ctx.env, [
        ctx.env.DB.prepare(
          'UPDATE study_partners SET from_id = ?, to_id = ?, status = ?, updated_at = ? WHERE id = ?'
        ).bind(ctx.userId, targetId, 'pending', nowSec(), existing.id),
        notifyStatement(ctx.env, {
          userId: targetId,
          type: 'system',
          targetType: 'partner',
          content: '有人想成为你的学习搭子，去看看'
        })
      ])
      return Response.json({ accepted: false }, { status: 201 })
    }

    // 不存在 → INSERT OR IGNORE（并发互相发起时 changes=0，改为按「互相接受」处理，避免 500）
    const id = uid()
    const inserted = await run(
      ctx.env,
      'INSERT OR IGNORE INTO study_partners (id, pair_key, from_id, to_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      id,
      pairKey,
      ctx.userId,
      targetId,
      'pending',
      nowSec(),
      nowSec()
    )
    if (!inserted.meta.changes) {
      // 并发冲突：对方刚也发起了请求，重新查询并互相接受
      const dup = await first<{ id: string; from_id: string; to_id: string; status: string }>(
        ctx.env,
        'SELECT id, from_id, to_id, status FROM study_partners WHERE pair_key = ?',
        pairKey
      )
      if (dup && dup.status === 'pending' && dup.to_id === ctx.userId) {
        // 并发冲突互相接受（双方均校验上限）
        await assertPartnersUnderLimit(ctx.env, [ctx.userId, targetId], ctx.userId)
        await batch(ctx.env, [
          ctx.env.DB.prepare('UPDATE study_partners SET status = ?, updated_at = ? WHERE id = ?').bind(
            'accepted',
            nowSec(),
            dup.id
          ),
          notifyStatement(ctx.env, {
            userId: targetId,
            type: 'system',
            targetType: 'partner',
            content: '🤝 有人已成为你的学习搭子'
          })
        ])
        return Response.json({ accepted: true })
      }
      return Response.json({ accepted: false }, { status: 201 })
    }

    await batch(ctx.env, [
      notifyStatement(ctx.env, {
        userId: targetId,
        type: 'system',
        targetType: 'partner',
        content: '有人想成为你的学习搭子，去看看'
      })
    ])
    return Response.json({ accepted: false }, { status: 201 })
  })

  // 接受/拒绝请求
  on('PUT', '/api/community/partners/:requestId', true, async (ctx) => {
    const b = await body(ctx.request)
    const action = b?.action === 'accept' || b?.action === 'reject' ? b.action : null
    if (!action) throw new HttpError(400, 'action 需为 accept 或 reject')
    const req = await first<{ id: string; from_id: string }>(
      ctx.env,
      `SELECT id, from_id FROM study_partners WHERE id = ? AND to_id = ? AND status = 'pending'`,
      ctx.params.requestId,
      ctx.userId
    )
    if (!req) throw new HttpError(404, '请求不存在')
    // 接受请求 → 立即成为搭子，双方均校验上限（发起方也可能已满，故不能只查接受方）
    if (action === 'accept') await assertPartnersUnderLimit(ctx.env, [ctx.userId, req.from_id], ctx.userId)
    const stmts = [
      ctx.env.DB.prepare(`UPDATE study_partners SET status = ?, updated_at = ? WHERE id = ?`).bind(
        action === 'accept' ? 'accepted' : 'rejected',
        nowSec(),
        req.id
      )
    ]
    if (action === 'accept') {
      stmts.push(
        notifyStatement(ctx.env, {
          userId: req.from_id,
          type: 'system',
          targetType: 'partner',
          content: '🤝 对方已接受你的学习搭子请求'
        })
      )
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
    const now = nowSec()
    // 通知对方：搭子关系已解除（进入通知中心「搭子」分类）；
    // 同批原子结束该对进行中的开黑会话——解绑即协作终止，避免「已非搭子却仍共用活跃会话」
    await batch(ctx.env, [
      ctx.env.DB.prepare(
        `UPDATE partner_study_sessions SET status = 'done', ended_at = ?, updated_at = ?
         WHERE status = 'active' AND from_id IN (?, ?) AND to_id IN (?, ?)`
      ).bind(now, now, ctx.userId, partnerId, ctx.userId, partnerId),
      notifyStatement(ctx.env, {
        userId: partnerId,
        type: 'partner',
        actorId: ctx.userId,
        targetType: 'partner_unbind',
        targetId: ctx.userId,
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
    const settings = await first<{ partner_share_enabled: number }>(
      ctx.env,
      `SELECT partner_share_enabled FROM user_settings WHERE user_id = ?`,
      partnerId
    )
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

    const [mine, theirs] = await Promise.all([
      weeklyStats(ctx.env, ctx.userId, weekStart, weekEnd),
      weeklyStats(ctx.env, partnerId, weekStart, weekEnd)
    ])
    const partnerName = await displayName(ctx.env, partnerId)
    return Response.json({ shared: true, weekStart, weekEnd, partnerName, mine, theirs })
  })

  // 发送学习鼓励提醒（复用站内通知；受对方提醒开关管控）
  on('POST', '/api/community/partners/:userId/remind', true, async (ctx) => {
    await rateLimit(ctx, 'community:partner:remind', 10)
    const partnerId = ctx.params.userId
    await assertPartner(ctx.env, ctx.userId, partnerId)

    // 对方提醒开关：完全关闭则拒绝，杜绝骚扰
    const settings = await first<{ partner_remind_enabled: number }>(
      ctx.env,
      `SELECT partner_remind_enabled FROM user_settings WHERE user_id = ?`,
      partnerId
    )
    if (!settings?.partner_remind_enabled) throw new HttpError(403, '对方已关闭学习提醒')

    const myName = await displayName(ctx.env, ctx.userId)
    await batch(ctx.env, [
      notifyStatement(ctx.env, {
        userId: partnerId,
        type: 'partner',
        actorId: ctx.userId,
        targetType: 'partner_remind',
        targetId: ctx.userId,
        content: `${myName} 提醒你：该学习啦，一起加油～`
      })
    ])
    return Response.json({ ok: true })
  })
}

/** 上周区间（UTC+8，周一~周日）+ 去重 weekKey（上周一日期） */
function lastWeekRange() {
  const now = new Date(Date.now() + 8 * 3600_000)
  const daysSinceMonday = (now.getUTCDay() + 6) % 7
  const thisMonday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysSinceMonday))
  const lastMonday = new Date(thisMonday.getTime() - 7 * 86400_000)
  const lastSunday = new Date(lastMonday.getTime() + 6 * 86400_000)
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  return { weekStart: fmt(lastMonday), weekEnd: fmt(lastSunday), weekKey: fmt(lastMonday) }
}

/** 周报通知文案（带四项数据摘要） */
function weeklyReportContent(name: string, s: WeeklyStats): string {
  return `${name} 上周学习周报：学习 ${s.minutes} 分钟 · 连续打卡 ${s.streak} 天 · 刷题 ${s.problems} 道 · 番茄 ${s.pomodoroMinutes} 分钟`
}

/** 每周一 cron 触发：双向推送上周学习周报通知（去重 INSERT 与通知 INSERT 同批原子写入，避免标记与落库脱节）。
 *  查询已批量化（原为逐关系 12 次查询：随搭子关系数线性增长，大规模时会撞 Workers 单次调用查询上限）：
 *  已推送标记 1 次、展示名与四项周统计按涉及用户去重后分块 GROUP BY。 */
export async function pushWeeklyReports(env: Env): Promise<void> {
  const { weekStart, weekEnd, weekKey } = lastWeekRange()
  const rels = await all<{ from_id: string; to_id: string }>(
    env,
    // JOIN users 过滤双方均已不存在的关系行（人工改库等留下的孤儿行）：否则单条孤儿关系会让
    // 通知 INSERT 撞 FK，整批失败、所有用户的周报一起推不出去
    `SELECT sp.from_id, sp.to_id FROM study_partners sp
     JOIN users u1 ON u1.id = sp.from_id
     JOIN users u2 ON u2.id = sp.to_id
     WHERE sp.status = 'accepted'`
  )
  if (!rels.length) return

  // 本周已推送标记（一次查询替代逐关系 2 次存在性查询）
  const pushedRows = await all<{ from_id: string; to_id: string }>(
    env,
    `SELECT from_id, to_id FROM weekly_report_push_log WHERE week_key = ?`,
    weekKey
  )
  const pushed = new Set(pushedRows.map((r) => `${r.from_id}:${r.to_id}`))

  // 涉及用户去重后批量取展示名与周统计
  const uids = [...new Set(rels.flatMap((r) => [r.from_id, r.to_id]))]
  const [names, stats] = await Promise.all([
    displayNamesBatch(env, uids),
    weeklyStatsBatch(env, uids, weekStart, weekEnd)
  ])
  const nameOf = (uid: string) => names.get(uid) ?? '升本人'
  const statsOf = (uid: string) => stats.get(uid) ?? { minutes: 0, problems: 0, pomodoroMinutes: 0, streak: 0 }

  const stmts: D1PreparedStatement[] = []
  const pushLog = (fromId: string, toId: string) =>
    env.DB.prepare(
      `INSERT OR IGNORE INTO weekly_report_push_log (week_key, from_id, to_id, created_at) VALUES (?, ?, ?, ?)`
    ).bind(weekKey, fromId, toId, nowSec())

  for (const r of rels) {
    // 我的周报 → 推给搭子
    if (!pushed.has(`${r.from_id}:${r.to_id}`)) {
      stmts.push(pushLog(r.from_id, r.to_id))
      stmts.push(
        notifyStatement(env, {
          userId: r.to_id,
          type: 'partner',
          actorId: r.from_id,
          targetType: 'partner_weekly',
          targetId: r.from_id,
          content: weeklyReportContent(nameOf(r.from_id), statsOf(r.from_id))
        })
      )
    }
    // 搭子的周报 → 推给我
    if (!pushed.has(`${r.to_id}:${r.from_id}`)) {
      stmts.push(pushLog(r.to_id, r.from_id))
      stmts.push(
        notifyStatement(env, {
          userId: r.from_id,
          type: 'partner',
          actorId: r.to_id,
          targetType: 'partner_weekly',
          targetId: r.to_id,
          content: weeklyReportContent(nameOf(r.to_id), statsOf(r.to_id))
        })
      )
    }
  }

  // 分块写入（每批 ≤50，避免 D1 batch 语句数上限）
  for (let i = 0; i < stmts.length; i += 50) {
    await batch(env, stmts.slice(i, i + 50))
  }
}
