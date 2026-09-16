import type { Env } from '../index'
import { on, body } from '../router'
import { all, first, run, batch, uid, HttpError } from '../db'
import { rateLimit } from '../middleware/rateLimit'
import { displayName, notifyStatement } from './community'
import { assertPartner, currentPartnerIds } from './partners'

const nowSec = () => Math.floor(Date.now() / 1000)

/**
 * 开黑会话「最后活跃」时间窗（秒）：超过此时长无任何心跳即视为僵尸会话。
 * 前端每 10s 心跳一次（PUT），浏览器后台标签页定时器被节流至约 1 次/分钟，取 5 分钟 = 5 倍余量：
 * 既容忍后台节流，又能在用户关页 / 杀进程后约 5 分钟内自动解除对双方新会话的阻塞。
 */
const SESSION_IDLE_TIMEOUT = 300

/** 会话是否已超时无心跳（僵尸会话）：last_active_at 久未刷新 */
function isSessionStale(session: { last_active_at: number }): boolean {
  return nowSec() - session.last_active_at > SESSION_IDLE_TIMEOUT
}

/** 回收超时会话：置 done（保留已累计的在线秒数），供访问惰性回收与 cron 定时清理共用 */
async function reapSession(env: Env, id: string) {
  const now = nowSec()
  await run(
    env,
    `UPDATE partner_study_sessions SET status = 'done', ended_at = ?, updated_at = ? WHERE id = ? AND status = 'active'`,
    now,
    now,
    id
  )
}

/** cron 定时清理僵尸开黑会话（超时无心跳 → 置 done）：与周报 / 孤图 / 黑名单并入同一套调度 */
export async function cleanupStaleSessions(env: Env): Promise<void> {
  const now = nowSec()
  await run(
    env,
    `UPDATE partner_study_sessions SET status = 'done', ended_at = ?, updated_at = ? WHERE status = 'active' AND last_active_at < ?`,
    now,
    now,
    now - SESSION_IDLE_TIMEOUT
  )
}

/** 返回双方中"我"对应的前缀（from_/to_），用于区分会话/计划中的己方字段 */
function sideOf(row: { from_id: string; to_id: string }, userId: string): 'from' | 'to' {
  if (row.from_id === userId) return 'from'
  if (row.to_id === userId) return 'to'
  throw new HttpError(403, '无权访问')
}

/**
 * 协作数据（计划 / 复盘）鉴权单点：对手方仍须是「当前搭子」，解绑后读写一律 403。
 * 与列表侧 currentPartnerIds 过滤同一口径，消除解绑后的「半可用」残留。
 */
async function assertPairStillPartners(env: Env, row: { from_id: string; to_id: string }, userId: string) {
  await assertPartner(env, userId, row.from_id === userId ? row.to_id : row.from_id)
}

/** 用户自定义头像相对 URL（未设置返回 undefined，前端回退首字母） */
async function avatarOf(env: Env, userId: string): Promise<string | undefined> {
  const r = await first<{ avatar: string | null }>(env, `SELECT avatar FROM user_settings WHERE user_id = ?`, userId)
  return r?.avatar ?? undefined
}

/** 解析专注/休息时长（分钟）：忠实用户输入（含 0 与小数），仅对未提供/非数字兜底默认值，clamp 到 [0, max] */
function sanitizeMinutes(v: unknown, dflt: number, max: number): number {
  if (v === undefined || v === null || v === '') return dflt
  const n = Number(v)
  if (!Number.isFinite(n)) return dflt
  return Math.min(max, Math.max(0, n))
}

/** 会话时长上界（秒）：单次会话最长 24 小时，防止客户端写入极端值污染历史展示（P4-14） */
const SESSION_MAX_SECONDS = 24 * 3600
/** 会话时长上界（分钟口径，与 SESSION_MAX_SECONDS 同一上界换算） */
const SESSION_MAX_MINUTES = SESSION_MAX_SECONDS / 60

/** 会话侧累计时长归一化：floor + clamp 到 [0, max]（与 sanitizeMinutes 同为钳制语义） */
function clampSessionValue(v: unknown, max: number): number {
  return Math.min(max, Math.max(0, Math.floor(Number(v) || 0)))
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
  /** 最后活跃时间（任一参与方心跳时刷新），用于判定僵尸会话 */
  last_active_at: number
}

// ============================================================
// 双人同步番茄「开黑学习」自习室
// ============================================================
export function registerPartnerStudy() {
  // 发起双人番茄（邀请搭子；双方均不能有进行中的会话）
  on('POST', '/api/partner-study/sessions', true, async (ctx) => {
    await rateLimit(ctx, 'partner:study', 20)
    const b = await body(ctx.request)
    const partnerId = typeof b?.partnerId === 'string' ? b.partnerId : ''
    if (!partnerId) throw new HttpError(400, 'partnerId 必填')
    if (partnerId === ctx.userId) throw new HttpError(400, '不能与自己开黑')
    await assertPartner(ctx.env, ctx.userId, partnerId)

    // 专注/休息时长（分钟，双方一致）：忠实用户输入，仅对未提供/非数字兜底默认值，clamp 到 [0, 上限]
    const focusMinutes = sanitizeMinutes(b?.focusMinutes, 25, 120)
    const mode = b?.mode === 'countup' ? 'countup' : 'countdown'

    // 阻塞判定带时间窗：只统计「仍活跃」（窗口内有心跳）的会话，超时无更新的僵尸会话不再阻塞
    const busy = await first<{ id: string; from_id: string; to_id: string }>(
      ctx.env,
      `SELECT id, from_id, to_id FROM partner_study_sessions
       WHERE status = 'active' AND last_active_at >= ? AND (from_id IN (?, ?) OR to_id IN (?, ?)) LIMIT 1`,
      nowSec() - SESSION_IDLE_TIMEOUT,
      ctx.userId,
      partnerId,
      ctx.userId,
      partnerId
    )
    if (busy) {
      // 明确说明是哪个会话 / 谁在专注，并给出可操作的恢复路径（进入自习室结束该会话）
      if (busy.from_id === ctx.userId || busy.to_id === ctx.userId) {
        const withId = busy.from_id === ctx.userId ? busy.to_id : busy.from_id
        throw new HttpError(
          400,
          `你正与「${await displayName(ctx.env, withId)}」开黑自习中（会话 ${busy.id}），请先进入自习室结束它再发起新的开黑`
        )
      }
      throw new HttpError(
        400,
        `「${await displayName(ctx.env, partnerId)}」正在开黑自习中（会话 ${busy.id}），请稍后再试或让对方先结束`
      )
    }

    const id = uid()
    const now = nowSec()
    await batch(ctx.env, [
      ctx.env.DB.prepare(
        `INSERT INTO partner_study_sessions (id, from_id, to_id, status, mode, focus_minutes, from_state, to_state, created_at, updated_at, last_active_at) VALUES (?, ?, ?, 'active', ?, ?, 'idle', 'idle', ?, ?, ?)`
      ).bind(id, ctx.userId, partnerId, mode, focusMinutes, now, now, now),
      notifyStatement(ctx.env, {
        userId: partnerId,
        type: 'partner',
        actorId: ctx.userId,
        targetType: 'partner_study',
        targetId: id,
        content: `${await displayName(ctx.env, ctx.userId)} 邀请你一起开黑学习（${mode === 'countup' ? '正计时' : `${focusMinutes}分钟专注`}）`
      })
    ])
    return Response.json({ id }, { status: 201 })
  })

  // 获取我当前进行中的会话（无则返回 null）
  on('GET', '/api/partner-study/sessions/active', true, async (ctx) => {
    const s = await first<StudySessionRow>(
      ctx.env,
      `SELECT * FROM partner_study_sessions WHERE status = 'active' AND (from_id = ? OR to_id = ?) LIMIT 1`,
      ctx.userId,
      ctx.userId
    )
    if (!s) return Response.json({ session: null })
    // 僵尸会话（超时无心跳）：访问时惰性回收为 done 并视为无进行中会话，避免前端恢复已失效会话
    if (isSessionStale(s)) {
      await reapSession(ctx.env, s.id)
      return Response.json({ session: null })
    }
    return Response.json({ session: await mapSession(ctx.env, s, ctx.userId) })
  })

  // 历史开黑记录（我参与且已结束的会话，按结束时间倒序）
  on('GET', '/api/partner-study/sessions/history', true, async (ctx) => {
    const rows = await all<{
      id: string
      from_id: string
      to_id: string
      created_at: number
      updated_at: number
      ended_at: number | null
      from_online_seconds: number
      to_online_seconds: number
    }>(
      ctx.env,
      `
      SELECT id, from_id, to_id, created_at, updated_at, ended_at, from_online_seconds, to_online_seconds
      FROM partner_study_sessions
      WHERE status = 'done' AND (from_id = ? OR to_id = ?)
      ORDER BY COALESCE(ended_at, updated_at) DESC LIMIT 50
    `,
      ctx.userId,
      ctx.userId
    )

    // 批量取全部对手方资料（一次 IN 查询替代逐行 displayName + avatarOf）
    const partnerIds = [...new Set(rows.map((r) => (r.from_id === ctx.userId ? r.to_id : r.from_id)))]
    const profiles = new Map<string, { name: string; avatar: string | null }>()
    if (partnerIds.length) {
      const profRows = await all<{ id: string; name: string; avatar: string | null }>(
        ctx.env,
        `SELECT u.id, COALESCE(s.user_name, u.username) AS name, s.avatar
         FROM users u LEFT JOIN user_settings s ON s.user_id = u.id
         WHERE u.id IN (${partnerIds.map(() => '?').join(',')})`,
        ...partnerIds
      )
      for (const p of profRows) profiles.set(p.id, p)
    }

    const records = rows.map((r) => {
      const side = r.from_id === ctx.userId ? 'from' : 'to'
      const partnerId = side === 'from' ? r.to_id : r.from_id
      const p = profiles.get(partnerId)
      return {
        id: r.id,
        partnerId,
        partnerName: p?.name || '升本人',
        partnerAvatar: p?.avatar ?? undefined,
        startedAt: r.created_at,
        endedAt: r.ended_at ?? r.updated_at,
        myOnlineSeconds: side === 'from' ? r.from_online_seconds : r.to_online_seconds,
        partnerOnlineSeconds: side === 'from' ? r.to_online_seconds : r.from_online_seconds
      }
    })
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
    // 时长上界（P4-14）：单次会话 ≤ 24 小时，超限值钳制到上界——该端点兼作心跳状态同步，
    // 拒绝 400 会打断进行中的会话，钳制与本文件 sanitizeMinutes 的既有语义一致
    const minutes = clampSessionValue(b?.minutes, SESSION_MAX_MINUTES)
    const onlineSeconds = clampSessionValue(b?.onlineSeconds, SESSION_MAX_SECONDS)
    const elapsedSeconds = clampSessionValue(b?.elapsedSeconds, SESSION_MAX_SECONDS)
    const running = b?.running === true ? 1 : 0

    const s = await getSession(ctx.env, ctx.params.id)
    if (s.status !== 'active') throw new HttpError(400, '会话已结束')
    const side = sideOf(s, ctx.userId)

    const now = nowSec()
    await run(
      ctx.env,
      `UPDATE partner_study_sessions SET ${side}_state = ?, ${side}_minutes = ?, ${side}_online_seconds = ?, ${side}_elapsed_seconds = ?, ${side}_running = ?, updated_at = ?, last_active_at = ? WHERE id = ?`,
      state,
      minutes,
      onlineSeconds,
      elapsedSeconds,
      running,
      now,
      now,
      s.id
    )

    // 重新查询后判断双方均 done → 会话完成（避免并发下基于旧快照漏判）
    const updated = await getSession(ctx.env, s.id)
    if (updated.from_state === 'done' && updated.to_state === 'done' && updated.status === 'active') {
      await run(
        ctx.env,
        `UPDATE partner_study_sessions SET status = 'done', ended_at = ?, updated_at = ? WHERE id = ?`,
        nowSec(),
        nowSec(),
        s.id
      )
      updated.status = 'done'
    }
    return Response.json({ session: await mapSession(ctx.env, updated, ctx.userId) })
  })

  // 结束会话（单方主动结束，无需对方同意）
  on('DELETE', '/api/partner-study/sessions/:id', true, async (ctx) => {
    const s = await getSession(ctx.env, ctx.params.id)
    sideOf(s, ctx.userId)
    await run(
      ctx.env,
      `UPDATE partner_study_sessions SET status = 'done', ended_at = ?, updated_at = ? WHERE id = ?`,
      nowSec(),
      nowSec(),
      s.id
    )
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
    await rateLimit(ctx, 'partner:plan', 20)
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
        userId: partnerId,
        type: 'partner',
        actorId: ctx.userId,
        targetType: 'partner_plan',
        targetId: id,
        content: `${await displayName(ctx.env, ctx.userId)} 创建了协作备考计划「${title}」`
      })
    ])
    return Response.json({ id }, { status: 201 })
  })

  // 我的计划列表
  on('GET', '/api/partner-plans', true, async (ctx) => {
    const rows = await all<{
      id: string
      from_id: string
      to_id: string
      title: string
      created_at: number
      total: number
      my_done: number
    }>(
      ctx.env,
      `
      SELECT p.*,
        (SELECT COUNT(*) FROM partner_plan_tasks t WHERE t.plan_id = p.id) AS total,
        (SELECT COUNT(*) FROM partner_plan_tasks t WHERE t.plan_id = p.id
          AND (CASE WHEN p.from_id = ? THEN t.done_by_from ELSE t.done_by_to END) = 1) AS my_done
      FROM partner_plans p
      WHERE p.from_id = ? OR p.to_id = ?
      ORDER BY p.created_at DESC LIMIT 50
    `,
      ctx.userId,
      ctx.userId,
      ctx.userId
    )

    // 批量取全部搭子的展示名（一次 IN 查询替代逐行 displayName）
    const partnerIds = [...new Set(rows.map((r) => (r.from_id === ctx.userId ? r.to_id : r.from_id)))]
    const partnerNames = new Map<string, string>()
    if (partnerIds.length) {
      const nameRows = await all<{ id: string; name: string }>(
        ctx.env,
        `SELECT u.id, COALESCE(s.user_name, u.username) AS name FROM users u
         LEFT JOIN user_settings s ON s.user_id = u.id
         WHERE u.id IN (${partnerIds.map(() => '?').join(',')})`,
        ...partnerIds
      )
      for (const n of nameRows) partnerNames.set(n.id, n.name)
    }

    // 列表口径：只保留对手方仍是当前搭子的计划，解绑后即从列表消失（无「半可用」）
    const partners = await currentPartnerIds(ctx.env, ctx.userId)
    const items = rows
      .filter((r) => partners.has(r.from_id === ctx.userId ? r.to_id : r.from_id))
      .map((r) => {
        const partnerId = r.from_id === ctx.userId ? r.to_id : r.from_id
        return {
          id: r.id,
          title: r.title,
          partnerId,
          partnerName: partnerNames.get(partnerId) || '升本人',
          taskTotal: r.total,
          myDone: r.my_done,
          createdAt: r.created_at
        }
      })
    return Response.json({ items })
  })

  // 计划详情（含任务及双方完成状态）
  on('GET', '/api/partner-plans/:id', true, async (ctx) => {
    const plan = await getPlan(ctx.env, ctx.params.id)
    const side = sideOf(plan, ctx.userId)
    await assertPairStillPartners(ctx.env, plan, ctx.userId)
    const partnerId = side === 'from' ? plan.to_id : plan.from_id

    const tasks = await all<{
      id: string
      title: string
      phase: string
      done_by_from: number
      done_by_to: number
      created_at: number
    }>(ctx.env, `SELECT * FROM partner_plan_tasks WHERE plan_id = ? ORDER BY created_at ASC`, plan.id)

    return Response.json({
      id: plan.id,
      title: plan.title,
      partnerId,
      partnerName: await displayName(ctx.env, partnerId),
      tasks: tasks.map((t) => ({
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
    await assertPairStillPartners(ctx.env, plan, ctx.userId)
    await run(ctx.env, `UPDATE partner_plans SET title = ?, updated_at = ? WHERE id = ?`, title, nowSec(), plan.id)
    return Response.json({ ok: true })
  })

  // 删除计划（双方均可删除）
  on('DELETE', '/api/partner-plans/:id', true, async (ctx) => {
    const plan = await getPlan(ctx.env, ctx.params.id)
    sideOf(plan, ctx.userId)
    await assertPairStillPartners(ctx.env, plan, ctx.userId)
    await batch(ctx.env, [
      ctx.env.DB.prepare(`DELETE FROM partner_plan_tasks WHERE plan_id = ?`).bind(plan.id),
      ctx.env.DB.prepare(`DELETE FROM partner_plans WHERE id = ?`).bind(plan.id)
    ])
    return Response.json({ ok: true })
  })

  // 添加任务
  on('POST', '/api/partner-plans/:id/tasks', true, async (ctx) => {
    await rateLimit(ctx, 'partner:plan:task', 30)
    const b = await body(ctx.request)
    const title = typeof b?.title === 'string' ? b.title.trim() : ''
    const phase = typeof b?.phase === 'string' ? b.phase.trim() : ''
    if (!title) throw new HttpError(400, '任务标题必填')
    if (title.length > 100) throw new HttpError(400, '任务标题最多 100 字')
    const plan = await getPlan(ctx.env, ctx.params.id)
    sideOf(plan, ctx.userId)
    await assertPairStillPartners(ctx.env, plan, ctx.userId)

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
    await assertPairStillPartners(ctx.env, plan, ctx.userId)
    const res = await run(
      ctx.env,
      `UPDATE partner_plan_tasks SET done_by_${side} = ? WHERE id = ? AND plan_id = ?`,
      done,
      ctx.params.taskId,
      plan.id
    )
    if (!res.meta.changes) throw new HttpError(404, '任务不存在')
    return Response.json({ ok: true })
  })

  // 删除任务
  on('DELETE', '/api/partner-plans/:id/tasks/:taskId', true, async (ctx) => {
    const plan = await getPlan(ctx.env, ctx.params.id)
    sideOf(plan, ctx.userId)
    await assertPairStillPartners(ctx.env, plan, ctx.userId)
    const res = await run(
      ctx.env,
      `DELETE FROM partner_plan_tasks WHERE id = ? AND plan_id = ?`,
      ctx.params.taskId,
      plan.id
    )
    if (!res.meta.changes) throw new HttpError(404, '任务不存在')
    return Response.json({ ok: true })
  })
}

async function getPlan(env: Env, id: string) {
  const p = await first<{ id: string; from_id: string; to_id: string; title: string }>(
    env,
    `SELECT * FROM partner_plans WHERE id = ?`,
    id
  )
  if (!p) throw new HttpError(404, '计划不存在')
  return p
}

// ============================================================
// 双向复盘邀约（预约 + 记录，不做视频语音）
// ============================================================
export function registerPartnerReviews() {
  // 发起复盘邀约
  on('POST', '/api/partner-reviews', true, async (ctx) => {
    await rateLimit(ctx, 'partner:review', 20)
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
        userId: partnerId,
        type: 'partner',
        actorId: ctx.userId,
        targetType: 'partner_review',
        targetId: id,
        content: `${await displayName(ctx.env, ctx.userId)} 邀请你复盘学习`
      })
    ])
    return Response.json({ id }, { status: 201 })
  })

  // 邀约列表（我发起的 + 我收到的）
  on('GET', '/api/partner-reviews', true, async (ctx) => {
    const rows = await all<{
      id: string
      from_id: string
      to_id: string
      scheduled_at: number
      status: string
      note: string
      created_at: number
    }>(
      ctx.env,
      `SELECT * FROM partner_reviews WHERE from_id = ? OR to_id = ? ORDER BY scheduled_at DESC LIMIT 50`,
      ctx.userId,
      ctx.userId
    )

    // 批量取全部对手方的展示名（一次 IN 查询替代逐行 displayName）
    const partnerIds = [...new Set(rows.map((r) => (r.from_id === ctx.userId ? r.to_id : r.from_id)))]
    const partnerNames = new Map<string, string>()
    if (partnerIds.length) {
      const nameRows = await all<{ id: string; name: string }>(
        ctx.env,
        `SELECT u.id, COALESCE(s.user_name, u.username) AS name FROM users u
         LEFT JOIN user_settings s ON s.user_id = u.id
         WHERE u.id IN (${partnerIds.map(() => '?').join(',')})`,
        ...partnerIds
      )
      for (const n of nameRows) partnerNames.set(n.id, n.name)
    }

    // 列表口径：只保留对手方仍是当前搭子的邀约，解绑后即从列表消失（无「半可用」）
    const partners = await currentPartnerIds(ctx.env, ctx.userId)
    const items = rows
      .map((r) => {
        const isFrom = r.from_id === ctx.userId
        const partnerId = isFrom ? r.to_id : r.from_id
        return {
          id: r.id,
          partnerId,
          partnerName: partnerNames.get(partnerId) || '升本人',
          scheduledAt: r.scheduled_at,
          status: r.status,
          note: r.note,
          isFrom,
          createdAt: r.created_at
        }
      })
      .filter((r) => partners.has(r.partnerId))
    return Response.json({ items })
  })

  // 接受邀约 / 完成复盘（留存记录）
  on('PUT', '/api/partner-reviews/:id', true, async (ctx) => {
    const b = await body(ctx.request)
    const action = b?.action === 'accept' || b?.action === 'done' ? b.action : null
    if (!action) throw new HttpError(400, 'action 需为 accept 或 done')
    const note = typeof b?.note === 'string' ? b.note.trim().slice(0, 500) : ''

    const r = await first<{ id: string; from_id: string; to_id: string; status: string }>(
      ctx.env,
      `SELECT * FROM partner_reviews WHERE id = ?`,
      ctx.params.id
    )
    if (!r) throw new HttpError(404, '邀约不存在')
    await assertPairStillPartners(ctx.env, r, ctx.userId)

    if (action === 'accept') {
      if (r.to_id !== ctx.userId) throw new HttpError(403, '仅受邀方可接受')
      if (r.status !== 'pending') throw new HttpError(400, '邀约状态不正确')
      await run(ctx.env, `UPDATE partner_reviews SET status = 'accepted', updated_at = ? WHERE id = ?`, nowSec(), r.id)
    } else {
      sideOf(r, ctx.userId)
      if (r.status === 'pending') throw new HttpError(400, '邀约尚未接受')
      await run(
        ctx.env,
        `UPDATE partner_reviews SET status = 'done', note = ?, updated_at = ? WHERE id = ?`,
        note,
        nowSec(),
        r.id
      )
    }
    return Response.json({ ok: true })
  })

  // 取消邀约（双方均可）
  on('DELETE', '/api/partner-reviews/:id', true, async (ctx) => {
    const r = await first<{ id: string; from_id: string; to_id: string }>(
      ctx.env,
      `SELECT * FROM partner_reviews WHERE id = ?`,
      ctx.params.id
    )
    if (!r) throw new HttpError(404, '邀约不存在')
    sideOf(r, ctx.userId)
    await assertPairStillPartners(ctx.env, r, ctx.userId)
    await run(ctx.env, `DELETE FROM partner_reviews WHERE id = ?`, r.id)
    return Response.json({ ok: true })
  })
}

export function registerPartnerCollabRoutes() {
  registerPartnerStudy()
  registerPartnerPlans()
  registerPartnerReviews()
}
