import type { Env } from '../index'
import { on } from '../router'
import { all, first, utc8Today } from '../db'

/**
 * 游戏化（gamification 单行 + points_log 流水 ↔ 前端 Gamification）。
 *
 * 记录级同步（Phase 3）下积分为**服务端权威**：
 * - `points_log` 是唯一积分事实来源，`gamification.points` 是它的投影（`SUM(points_log.points)`），
 *   不再由客户端推送、也不做「加减法」累加（重放/并发天然幂等）。
 * - 客户端只以「积分事件」追加（`POST /api/data/push` 的 `points` 数组），按 `ref_id` 幂等落账。
 * - `streak`/`last_checkin` 由服务端按 `study_records` 的日期集合派生（见 api/sync.ts）。
 * - 徽章由服务端发放（见 api/badges.ts），`user_badges` 主键去重保证仅发一次。
 * - `achievements`（成就 id 列表）由客户端以 `POST /api/data/push` 的 `achievements` 字段上报解锁结果
 *   （规则仍留在客户端 `checkAchievements()`），服务端在同一 batch 内做**只增不减的集合并集**并落库。
 */

export interface GamificationFull {
  points: number
  streak: number
  lastCheckin: string
  achievements: string[]
  pointsLog: { date: string; points: number; reason: string; refId?: string }[]
}

/** 解析 `gamification.achievements` 列（JSON 数组字符串 → 非空字符串数组；非法/损坏 → 空数组） */
function parseStoredAchievements(raw: unknown): string[] {
  try {
    const v = JSON.parse(String(raw ?? '') || '[]')
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x) : []
  } catch {
    return []
  }
}

/** 流水回传窗口（天）：只回传最近一年，响应是展示/导出用快照，服务端仍是完整权威账本 */
const POINTS_LOG_WINDOW_DAYS = 365
/** 流水回传条数上限：窗口内重度用户仍可能超限，只回传最新 1000 条 */
const POINTS_LOG_LIMIT = 1000

export async function getGamification(env: Env, userId: string): Promise<GamificationFull> {
  const row = await first(env, 'SELECT * FROM gamification WHERE user_id = ?', userId)
  // 回传的 pointsLog 只是展示/导出用快照，服务端才是权威账本：限「最近 365 天 + 最新 1000 条」，
  // 避免长期账号每次同步都全量回传整个流水；窗口/上限外的历史不参与客户端逐条撤销，
  // 批量撤销改由 `revoke all` 事件一次性完成（见 api/sync.ts 的 parsePointsEvents）
  const cutoff = new Date(Date.parse(`${utc8Today()}T00:00:00Z`) - POINTS_LOG_WINDOW_DAYS * 86400000)
    .toISOString()
    .slice(0, 10)
  // 取最新 1000 条（ORDER BY id DESC）后反转：响应顺序仍是 id 升序（前端依赖该顺序取最近 20 条）
  const log = await all(
    env,
    'SELECT * FROM points_log WHERE user_id = ? AND date >= ? ORDER BY id DESC LIMIT ?',
    userId,
    cutoff,
    POINTS_LOG_LIMIT
  )
  log.reverse()
  return {
    points: row?.points ?? 0,
    streak: row?.streak ?? 0,
    lastCheckin: row?.last_checkin ?? '',
    achievements: parseStoredAchievements(row?.achievements),
    pointsLog: log.map((l: any) => ({
      date: l.date,
      points: l.points,
      reason: l.reason,
      refId: l.ref_id ?? undefined
    }))
  }
}

/** 一条待落账的积分流水（`refId` 为幂等键：服务端已存在同 `ref_id` 流水则整条跳过） */
export interface PointsAward {
  refId: string
  points: number
  reason: string
  date: string
}

/**
 * 按 `ref_id` 幂等落账积分流水：`WHERE NOT EXISTS` 让「判重 + 插入」在**单条语句**内完成，
 * 因此重放、并发 push 都不会重复记账（客户端事件与 `migrateLegacyData` 的补齐天然安全）。
 */
export function pointsAwardStatements(env: Env, userId: string, awards: PointsAward[]): D1PreparedStatement[] {
  return awards.map((a) =>
    env.DB.prepare(
      'INSERT INTO points_log (user_id, date, points, reason, ref_id) ' +
        'SELECT ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM points_log WHERE user_id = ? AND ref_id = ?)'
    ).bind(userId, a.date, a.points, a.reason, a.refId, userId, a.refId)
  )
}

/** LIKE 元字符转义：ref 键由客户端提供，可能含 `%`/`_`/`\`，不转义会让前缀撤销误删其它流水 */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`)
}

/**
 * 撤销积分流水：按 `refId` 精确删除、按 `refPrefix` 前缀删除（对齐客户端 `revokePointsByRef` /
 * `revokePointsByRefPrefix` 语义），或 `revokeAll` 一次性删除该用户全部**有 ref_id** 的流水
 * （无 ref_id 的历史流水按语义不可撤销，保持）。删除 0 行亦幂等。
 */
export function pointsRevokeStatements(
  env: Env,
  userId: string,
  refIds: string[],
  refPrefixes: string[],
  revokeAll = false
): D1PreparedStatement[] {
  return [
    ...(revokeAll
      ? [env.DB.prepare('DELETE FROM points_log WHERE user_id = ? AND ref_id IS NOT NULL').bind(userId)]
      : []),
    ...refIds.map((r) => env.DB.prepare('DELETE FROM points_log WHERE user_id = ? AND ref_id = ?').bind(userId, r)),
    ...refPrefixes.map((p) =>
      env.DB.prepare("DELETE FROM points_log WHERE user_id = ? AND ref_id LIKE ? ESCAPE '\\'").bind(
        userId,
        `${escapeLike(p)}%`
      )
    )
  ]
}

/**
 * 权威投影语句：`gamification.points = SUM(points_log.points)`（单条语句内完成读改写，与流水写入同 batch）。
 * `streak` 由服务端派生时一并写回「连续学习天数 + 最后学习日」；不派生时只动积分，避免覆盖已有的 streak。
 */
export function gamificationProjectionStatement(
  env: Env,
  userId: string,
  streak?: { streak: number; lastCheckin: string }
): D1PreparedStatement {
  const sum = '(SELECT COALESCE(SUM(points), 0) FROM points_log WHERE user_id = ?)'
  if (!streak)
    return env.DB.prepare(
      `INSERT INTO gamification (user_id, points) VALUES (?, ${sum}) ` +
        'ON CONFLICT(user_id) DO UPDATE SET points = excluded.points'
    ).bind(userId, userId)
  return env.DB.prepare(
    `INSERT INTO gamification (user_id, points, streak, last_checkin) VALUES (?, ${sum}, ?, ?) ` +
      'ON CONFLICT(user_id) DO UPDATE SET points = excluded.points, streak = excluded.streak, last_checkin = excluded.last_checkin'
  ).bind(userId, userId, streak.streak, streak.lastCheckin)
}

/** 读现存成就 id 列表（保留存储顺序），供 push 侧做「只增不减」的集合并集 */
export async function getAchievements(env: Env, userId: string): Promise<string[]> {
  const row = await first<{ achievements: string | null }>(
    env,
    'SELECT achievements FROM gamification WHERE user_id = ?',
    userId
  )
  return parseStoredAchievements(row?.achievements)
}

/**
 * 成就列表写回语句（并集结果落库）。`achievements` 列存 JSON 数组字符串。
 *
 * 与 `gamificationProjectionStatement`（只写 points/streak/last_checkin）在同一 batch 内**互不覆盖**：
 * 两条语句都走 `ON CONFLICT(user_id) DO UPDATE`，各自只更新自己负责的列，先执行者建行、后执行者更新。
 */
export function achievementsMergeStatement(env: Env, userId: string, achievements: string[]): D1PreparedStatement {
  return env.DB.prepare(
    'INSERT INTO gamification (user_id, achievements) VALUES (?, ?) ' +
      'ON CONFLICT(user_id) DO UPDATE SET achievements = excluded.achievements'
  ).bind(userId, JSON.stringify(achievements))
}

export function registerGamificationRoutes() {
  on('GET', '/api/gamification', true, async (ctx) => {
    return Response.json(await getGamification(ctx.env, ctx.userId))
  })
}
