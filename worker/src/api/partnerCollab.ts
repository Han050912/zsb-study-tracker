import type { Env } from '../index'
import { on, body } from '../router'
import { all, first, run, batch, uid, HttpError } from '../db'
import { rateLimit } from '../middleware/rateLimit'
import { displayName, notifyStatement } from './community'
import { assertPartner } from './partners'

const nowSec = () => Math.floor(Date.now() / 1000)

/** 返回双方中"我"对应的前缀（from_/to_），用于区分会话/计划中的己方字段 */
function sideOf(row: { from_id: string; to_id: string }, userId: string): 'from' | 'to' {
  if (row.from_id === userId) return 'from'
  if (row.to_id === userId) return 'to'
  throw new HttpError(403, '无权访问')
}

/** 用户自定义头像相对 URL（未设置返回 undefined，前端回退首字母） */
async function avatarOf(env: Env, userId: string): Promise<string | undefined> {
  const r = await first<{ avatar: string | null }>(env,
    `SELECT avatar FROM user_settings WHERE user_id = ?`, userId)
  return r?.avatar ?? undefined
}

/** 解析专注/休息时长（分钟）：忠实用户输入（含 0 与小数），仅对未提供/非数字兜底默认值，clamp 到 [0, max] */
function sanitizeMinutes(v: unknown, dflt: number, max: number): number {
  if (v === undefined || v === null || v === '') return dflt
  const n = Number(v)
  if (!Number.isFinite(n)) return dflt
  return Math.min(max, Math.max(0, n))
}

/** 番茄自习室会话行 */
interface StudySessionRow {
  id: string
  from_id: string
  to_id: string
  status: string
  mode: string
  focus_minutes: number
  from_state: string
  to_state: string
  from_minutes: number
  to_minutes: number
  from_online_seconds: number
  to_online_seconds: number
  ended_at: number | null
  from_elapsed_seconds: number
  to_elapsed_seconds: number
  from_running: number
  to_running: number
}

// ============================================================
// 双人同步番茄「开黑学习」自习室
// ============================================================
export function registerPartnerStudy() {
  // 发起双人番茄（邀请搭子；双方均不能有进行中的会话）
  on('POST', '/api/partner-study/sessions', true, async (ctx) => {
    rateLimit(ctx.request, 'partner:study', 20)
    const b = await body(ctx.request)
    const partnerId = typeof b?.partnerId === 'string' ? b.partnerId : ''
    if (!partnerId) throw new HttpError(400, 'partnerId 必填')
    if (partnerId === ctx.userId) throw new HttpError(400, '不能与自己开黑')
    await assertPartner(ctx.env, ctx.userId, partnerId)

    // 专注/休息时长（分钟，双方一致）：忠实用户输入，仅对未提供/非数字兜底默认值，clamp 到 [0, 上限]
    const focusMinutes = sanitizeMinutes(b?.focusMinutes, 25, 120)
    const mode = b?.mode === 'countup' ? 'countup' : 'countdown'

    const busy = await first<{ id: string }>(ctx.env,
      `SELECT id FROM partner_study_sessions WHERE status = 'active' AND (from_id IN (?, ?) OR to_id IN (?, ?)) LIMIT 1`,
      ctx.userId, partnerId, ctx.userId, partnerId)
    if (busy) throw new HttpError(400, '有一方正在专注中，稍后再试')

    const id = uid()
    const now = nowSec()
    await batch(ctx.env, [
      ctx.env.DB.prepare(
        `INSERT INTO partner_study_sessions (id, from_id, to_id, status, mode, focus_minutes, from_state, to_state, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?, 'idle', 'idle', ?, ?)`
      ).bind(id, ctx.userId, partnerId, mode, focusMinutes, now, now),
      notifyStatement(ctx.env, {
        userId: partnerId, type: 'partner', actorId: ctx.userId,
        targetType: 'partner_study', targetId: id,
        content: `${await displayName(ctx.env, ctx.userId)} 邀请你一起开黑学习（${mode === 'countup' ? '正计时' : `${focusMinutes}分钟专注`}）`
      })
    ])
    return Response.json({ id }, { status: 201 })
  })

  // 获取我当前进行中的会话（无则返回 null）
  on('GET', '/api/partner-study/sessions/active', true, async (ctx) => {
    const s = await first<StudySessionRow>(ctx.env,
      `SELECT * FROM partner_study_sessions WHERE status = 'active' AND (from_id = ? OR to_id = ?) LIMIT 1`,
      ctx.userId, ctx.userId)
    if (!s) return Response.json({ session: null })
    return Response.json({ session: await mapSession(ctx.env, s, ctx.userId) })
  })

  // 历史开黑记录（我参与且已结束的会话，按结束时间倒序）
  on('GET', '/api/partner-study/sessions/history', true, async (ctx) => {
    const rows = await all<{
      id: string; from_id: string; to_id: string; created_at: number; updated_at: number
      ended_at: number | null; from_online_seconds: number; to_online_seconds: number
    }>(ctx.env, `
      SELECT id, from_id, to_id, created_at, updated_at, ended_at, from_online_seconds, to_online_seconds
      FROM partner_study_sessions
      WHERE status = 'done' AND (from_id = ? OR to_id = ?)
      ORDER BY COALESCE(ended_at, updated_at) DESC LIMIT 50
    `, ctx.userId, ctx.userId)

    const records = await Promise.all(rows.map(async r => {
      const side = r.from_id === ctx.userId ? 'from' : 'to'
      const partnerId = side === 'from' ? r.to_id : r.from_id
      return {
        id: r.id,
        partnerId,
        partnerName: await displayName(ctx.env, partnerId),
        partnerAvatar: await avatarOf(ctx.env, partnerId),
        startedAt: r.created_at,
        endedAt: r.ended_at ?? r.updated_at,
        myOnlineSeconds: side === 'from' ? r.from_online_seconds : r.to_online_seconds,
        partnerOnlineSeconds: side === 'from' ? r.to_online_seconds : r.from_online_seconds
      }
    }))
    return Response.json({ records })
  })

  // 获取会话详情（轮询同步对方状态）
  on('GET', '/api/partner-study/sessions/:id', true, async (ctx) => {
    const s = await getSession(ctx.env, ctx.params.id)
    sideOf(s, ctx.userId)
    return Response.json({ session: await mapSession(ctx.env, s, ctx.userId) })
  })

  // 更新我的状态（idle/focus/done）与累计分钟/在线秒数；双方 done 时会话结束
  on('PUT', '/api/partner-study/sessions/:id', true, async (ctx) => {
    const b = await body(ctx.request)
    const state = b?.state === 'idle' || b?.state === 'focus' || b?.state === 'done' ? b.state : null
    if (!state) throw new HttpError(400, 'state 需为 idle/focus/done')
    const minutes = Math.max(0, Math.floor(Number(b?.minutes) || 0))
    const onlineSeconds = Math.max(0, Math.floor(Number(b?.onlineSeconds) || 0))
    const elapsedSeconds = Math.max(0, Math.floor(Number(b?.elapsedSeconds) || 0))
    const running = b?.running === true ? 1 : 0

    const s = await getSession(ctx.env, ctx.params.id)
    if (s.status !== 'active') throw new HttpError(400, '会话已结束')
    const side = sideOf(s, ctx.userId)

    await run(ctx.env,
      `UPDATE partner_study_sessions SET ${side}_state = ?, ${side}_minutes = ?, ${side}_online_seconds = ?, ${side}_elapsed_seconds = ?, ${side}_running = ?, updated_at = ? WHERE id = ?`,
      state, minutes, onlineSeconds, elapsedSeconds, running, nowSec(), s.id)

    // 重新查询后判断双方均 done → 会话完成（避免并发下基于旧快照漏判）
    const updated = await getSession(ctx.env, s.id)
    if (updated.from_state === 'done' && updated.to_state === 'done' && updated.status === 'active') {
      await run(ctx.env, `UPDATE partner_study_sessions SET status = 'done', ended_at = ?, updated_at = ? WHERE id = ?`, nowSec(), nowSec(), s.id)
      updated.status = 'done'
    }
    return Response.json({ session: await mapSession(ctx.env, updated, ctx.userId) })
  })

  // 结束会话（单方主动结束，无需对方同意）
  on('DELETE', '/api/partner-study/sessions/:id', true, async (ctx) => {
    const s = await getSession(ctx.env, ctx.params.id)
    sideOf(s, ctx.userId)
    await run(ctx.env, `UPDATE partner_study_sessions SET status = 'done', ended_at = ?, updated_at = ? WHERE id = ?`, nowSec(), nowSec(), s.id)
    return Response.json({ ok: true })
  })
}

async function getSession(env: Env, id: string) {
  const s = await first<StudySessionRow>(env, `SELECT * FROM partner_study_sessions WHERE id = ?`, id)
  if (!s) throw new HttpError(404, '会话不存在')
  return s
}

/** 归一化会话状态：旧版 'break' 阶段已废弃，统一视为 'done' */
function normalizeState(state: string): string {
  return state === 'break' ? 'done' : state
}

async function mapSession(env: Env, s: StudySessionRow, userId: string) {
  const side = sideOf(s, userId)
  const partnerId = side === 'from' ? s.to_id : s.from_id
  const partnerName = await displayName(env, partnerId)
  const partnerAvatar = await avatarOf(env, partnerId)
  return {
    id: s.id,
    status: s.status,
    mode: s.mode === 'countup' ? 'countup' : 'countdown',
    partnerId,
    partnerName,
    partnerAvatar,
    focusMinutes: s.focus_minutes,
    myState: normalizeState(side === 'from' ? s.from_state : s.to_state),
    myMinutes: side === 'from' ? s.from_minutes : s.to_minutes,
    partnerState: normalizeState(side === 'from' ? s.to_state : s.from_state),
    partnerMinutes: side === 'from' ? s.to_minutes : s.from_minutes,
    myOnlineSeconds: side === 'from' ? s.from_online_seconds : s.to_online_seconds,
    partnerOnlineSeconds: side === 'from' ? s.to_online_seconds : s.from_online_seconds,
    myElapsedSeconds: side === 'from' ? s.from_elapsed_seconds : s.to_elapsed_seconds,
    partnerElapsedSeconds: side === 'from' ? s.to_elapsed_seconds : s.from_elapsed_seconds,
    partnerRunning: !!(side === 'from' ? s.to_running : s.from_running)
  }
}

// ============================================================
// 搭子协作备考计划
// ============================================================
export function registerPartnerPlans() {
  // 创建协作计划
  on('POST', '/api/partner-plans', true, async (ctx) => {
    rateLimit(ctx.request, 'partner:plan', 20)
    const b = await body(ctx.request)
    const partnerId = typeof b?.partnerId === 'string' ? b.partnerId : ''
    const title = typeof b?.title === 'string' ? b.title.trim() : ''
    if (!partnerId || !title) throw new HttpError(400, 'partnerId 与 title 必填')
    if (title.length > 50) throw new HttpError(400, '标题最多 50 字')
    await assertPartner(ctx.env, ctx.userId, partnerId)

    const id = uid()
    const now = nowSec()
    await batch(ctx.env, [
      ctx.env.DB.prepare(
        `INSERT INTO partner_plans (id, from_id, to_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(id, ctx.userId, partnerId, title, now, now),
      notifyStatement(ctx.env, {
        userId: partnerId, type: 'partner', actorId: ctx.userId,
        targetType: 'partner_plan', targetId: id,
        content: `${await displayName(ctx.env, ctx.userId)} 创建了协作备考计划「${title}」`
      })
    ])
    return Response.json({ id }, { status: 201 })
  })

  // 我的计划列表
  on('GET', '/api/partner-plans', true, async (ctx) => {
    const rows = await all<{
      id: string; from_id: string; to_id: string; title: string; created_at: number
      total: number; my_done: number
    }>(ctx.env, `
      SELECT p.*,
        (SELECT COUNT(*) FROM partner_plan_tasks t WHERE t.plan_id = p.id) AS total,
        (SELECT COUNT(*) FROM partner_plan_tasks t WHERE t.plan_id = p.id
          AND (CASE WHEN p.from_id = ? THEN t.done_by_from ELSE t.done_by_to END) = 1) AS my_done
      FROM partner_plans p
      WHERE p.from_id = ? OR p.to_id = ?
      ORDER BY p.created_at DESC LIMIT 50
    `, ctx.userId, ctx.userId, ctx.userId)

    const items = await Promise.all(rows.map(async r => {
      const partnerId = r.from_id === ctx.userId ? r.to_id : r.from_id
      return {
        id: r.id,
        title: r.title,
        partnerId,
        partnerName: await displayName(ctx.env, partnerId),
        taskTotal: r.total,
        myDone: r.my_done,
        createdAt: r.created_at
      }
    }))
    return Response.json({ items })
  })

  // 计划详情（含任务及双方完成状态）
  on('GET', '/api/partner-plans/:id', true, async (ctx) => {
    const plan = await getPlan(ctx.env, ctx.params.id)
    const side = sideOf(plan, ctx.userId)
    const partnerId = side === 'from' ? plan.to_id : plan.from_id

    const tasks = await all<{
      id: string; title: string; phase: string; done_by_from: number; done_by_to: number; created_at: number
    }>(ctx.env, `SELECT * FROM partner_plan_tasks WHERE plan_id = ? ORDER BY created_at ASC`, plan.id)

    return Response.json({
      id: plan.id,
      title: plan.title,
      partnerId,
      partnerName: await displayName(ctx.env, partnerId),
      tasks: tasks.map(t => ({
        id: t.id,
        title: t.title,
        phase: t.phase,
        myDone: (side === 'from' ? t.done_by_from : t.done_by_to) === 1,
        partnerDone: (side === 'from' ? t.done_by_to : t.done_by_from) === 1,
        createdAt: t.created_at
      }))
    })
  })

  // 编辑计划标题
  on('PUT', '/api/partner-plans/:id', true, async (ctx) => {
    const b = await body(ctx.request)
    const title = typeof b?.title === 'string' ? b.title.trim() : ''
    if (!title) throw new HttpError(400, 'title 必填')
    if (title.length > 50) throw new HttpError(400, '标题最多 50 字')
    const plan = await getPlan(ctx.env, ctx.params.id)
    sideOf(plan, ctx.userId)
    await run(ctx.env, `UPDATE partner_plans SET title = ?, updated_at = ? WHERE id = ?`, title, nowSec(), plan.id)
    return Response.json({ ok: true })
  })

  // 删除计划（双方均可删除）
  on('DELETE', '/api/partner-plans/:id', true, async (ctx) => {
    const plan = await getPlan(ctx.env, ctx.params.id)
    sideOf(plan, ctx.userId)
    await batch(ctx.env, [
      ctx.env.DB.prepare(`DELETE FROM partner_plan_tasks WHERE plan_id = ?`).bind(plan.id),
      ctx.env.DB.prepare(`DELETE FROM partner_plans WHERE id = ?`).bind(plan.id)
    ])
    return Response.json({ ok: true })
  })

  // 添加任务
  on('POST', '/api/partner-plans/:id/tasks', true, async (ctx) => {
    rateLimit(ctx.request, 'partner:plan:task', 30)
    const b = await body(ctx.request)
    const title = typeof b?.title === 'string' ? b.title.trim() : ''
    const phase = typeof b?.phase === 'string' ? b.phase.trim() : ''
    if (!title) throw new HttpError(400, '任务标题必填')
    if (title.length > 100) throw new HttpError(400, '任务标题最多 100 字')
    const plan = await getPlan(ctx.env, ctx.params.id)
    sideOf(plan, ctx.userId)

    const id = uid()
    await batch(ctx.env, [
      ctx.env.DB.prepare(
        `INSERT INTO partner_plan_tasks (id, plan_id, title, phase, created_at) VALUES (?, ?, ?, ?, ?)`
      ).bind(id, plan.id, title, phase, nowSec()),
      ctx.env.DB.prepare(`UPDATE partner_plans SET updated_at = ? WHERE id = ?`).bind(nowSec(), plan.id)
    ])
    return Response.json({ id }, { status: 201 })
  })

  // 标记我的任务完成状态（各自完成自己的，进度双向同步）
  on('PUT', '/api/partner-plans/:id/tasks/:taskId', true, async (ctx) => {
    const b = await body(ctx.request)
    const done = b?.done ? 1 : 0
    const plan = await getPlan(ctx.env, ctx.params.id)
    const side = sideOf(plan, ctx.userId)
    const res = await run(ctx.env,
      `UPDATE partner_plan_tasks SET done_by_${side} = ? WHERE id = ? AND plan_id = ?`,
      done, ctx.params.taskId, plan.id)
    if (!res.meta.changes) throw new HttpError(404, '任务不存在')
    return Response.json({ ok: true })
  })

  // 删除任务
  on('DELETE', '/api/partner-plans/:id/tasks/:taskId', true, async (ctx) => {
    const plan = await getPlan(ctx.env, ctx.params.id)
    sideOf(plan, ctx.userId)
    const res = await run(ctx.env,
      `DELETE FROM partner_plan_tasks WHERE id = ? AND plan_id = ?`, ctx.params.taskId, plan.id)
    if (!res.meta.changes) throw new HttpError(404, '任务不存在')
    return Response.json({ ok: true })
  })
}

async function getPlan(env: Env, id: string) {
  const p = await first<{ id: string; from_id: string; to_id: string; title: string }>(env,
    `SELECT * FROM partner_plans WHERE id = ?`, id)
  if (!p) throw new HttpError(404, '计划不存在')
  return p
}

// ============================================================
// 双向复盘邀约（预约 + 记录，不做视频语音）
// ============================================================
export function registerPartnerReviews() {
  // 发起复盘邀约
  on('POST', '/api/partner-reviews', true, async (ctx) => {
    rateLimit(ctx.request, 'partner:review', 20)
    const b = await body(ctx.request)
    const partnerId = typeof b?.partnerId === 'string' ? b.partnerId : ''
    const scheduledAt = Math.floor(Number(b?.scheduledAt) || 0)
    if (!partnerId) throw new HttpError(400, 'partnerId 必填')
    if (!scheduledAt || scheduledAt <= nowSec()) throw new HttpError(400, '预约时间需为未来时间')
    await assertPartner(ctx.env, ctx.userId, partnerId)

    const id = uid()
    const now = nowSec()
    await batch(ctx.env, [
      ctx.env.DB.prepare(
        `INSERT INTO partner_reviews (id, from_id, to_id, scheduled_at, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'pending', ?, ?)`
      ).bind(id, ctx.userId, partnerId, scheduledAt, now, now),
      notifyStatement(ctx.env, {
        userId: partnerId, type: 'partner', actorId: ctx.userId,
        targetType: 'partner_review', targetId: id,
        content: `${await displayName(ctx.env, ctx.userId)} 邀请你复盘学习`
      })
    ])
    return Response.json({ id }, { status: 201 })
  })

  // 邀约列表（我发起的 + 我收到的）
  on('GET', '/api/partner-reviews', true, async (ctx) => {
    const rows = await all<{
      id: string; from_id: string; to_id: string; scheduled_at: number; status: string; note: string; created_at: number
    }>(ctx.env,
      `SELECT * FROM partner_reviews WHERE from_id = ? OR to_id = ? ORDER BY scheduled_at DESC LIMIT 50`,
      ctx.userId, ctx.userId)

    const items = await Promise.all(rows.map(async r => {
      const isFrom = r.from_id === ctx.userId
      const partnerId = isFrom ? r.to_id : r.from_id
      return {
        id: r.id,
        partnerId,
        partnerName: await displayName(ctx.env, partnerId),
        scheduledAt: r.scheduled_at,
        status: r.status,
        note: r.note,
        isFrom,
        createdAt: r.created_at
      }
    }))
    return Response.json({ items })
  })

  // 接受邀约 / 完成复盘（留存记录）
  on('PUT', '/api/partner-reviews/:id', true, async (ctx) => {
    const b = await body(ctx.request)
    const action = b?.action === 'accept' || b?.action === 'done' ? b.action : null
    if (!action) throw new HttpError(400, 'action 需为 accept 或 done')
    const note = typeof b?.note === 'string' ? b.note.trim().slice(0, 500) : ''

    const r = await first<{ id: string; from_id: string; to_id: string; status: string }>(ctx.env,
      `SELECT * FROM partner_reviews WHERE id = ?`, ctx.params.id)
    if (!r) throw new HttpError(404, '邀约不存在')

    if (action === 'accept') {
      if (r.to_id !== ctx.userId) throw new HttpError(403, '仅受邀方可接受')
      if (r.status !== 'pending') throw new HttpError(400, '邀约状态不正确')
      await run(ctx.env, `UPDATE partner_reviews SET status = 'accepted', updated_at = ? WHERE id = ?`, nowSec(), r.id)
    } else {
      sideOf(r, ctx.userId)
      if (r.status === 'pending') throw new HttpError(400, '邀约尚未接受')
      await run(ctx.env, `UPDATE partner_reviews SET status = 'done', note = ?, updated_at = ? WHERE id = ?`, note, nowSec(), r.id)
    }
    return Response.json({ ok: true })
  })

  // 取消邀约（双方均可）
  on('DELETE', '/api/partner-reviews/:id', true, async (ctx) => {
    const r = await first<{ id: string; from_id: string; to_id: string }>(ctx.env,
      `SELECT * FROM partner_reviews WHERE id = ?`, ctx.params.id)
    if (!r) throw new HttpError(404, '邀约不存在')
    sideOf(r, ctx.userId)
    await run(ctx.env, `DELETE FROM partner_reviews WHERE id = ?`, r.id)
    return Response.json({ ok: true })
  })
}

export function registerPartnerCollabRoutes() {
  registerPartnerStudy()
  registerPartnerPlans()
  registerPartnerReviews()
}
