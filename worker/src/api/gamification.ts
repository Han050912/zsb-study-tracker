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
 * 积分发放白名单（服务端权威口径，issue #11）。
 *
 * `award` 事件的 `points` 原本完全由客户端决定，可任意铸造（`1e8`…，甚至 `1e308` 让
 * `SUM(points)` 溢出为 `null`）。改为：客户端只上报「行为（`reason`）+ 引用（`refId`）」，
 * **行为的合法性与其分值上限由服务端白名单决定**：未登记 / 形状非法的 award 事件一律**不落账**，
 * 落账分值一律钳制到 `min(points, 该行为上限, MAX_AWARD_POINTS)`——正常用户的值本就 ≤ 上限，
 * 口径不变；伪造的超额值被压回上限，`1e308` 这类整数值浮点也不再可能污染 `SUM(points)`。
 *
 * - 动态 reason（含时长 / 题量 / 习惯名）用正则匹配，静态 reason 精确匹配；上限取该行为的正常
 *   分值上界（略高于实际值），既能容纳「学习 1440 分钟」这类极值，又不给伪造留出量级空间。
 * - 服务端自身产生、且会随 pull 回传、再经「导出 → 导入」重推的 reason（社区行为 / 派生积分）
 *   同样在册，保证 round-trip 不被拒绝。
 */
const AWARD_RULES: readonly { test: RegExp; max: number }[] = [
  // —— 客户端行为（src/stores/app/** 的 addPoints 调用点）——
  { test: /^学习 [\d.]+ 分钟$/, max: 150 },
  { test: /^刷题 [\d.]+ 道$/, max: 200 },
  { test: /^背单词$/, max: 100 },
  { test: /^听力练习$/, max: 100 },
  { test: /^阅读训练$/, max: 5 },
  { test: /^完成真题\/套卷$/, max: 20 },
  { test: /^完成番茄钟$/, max: 5 },
  { test: /^完成待办$/, max: 3 },
  { test: /^完成习惯「.*」$/, max: 2 },
  { test: /^每日打卡$/, max: 10 },
  { test: /^完成每日总结$/, max: 5 },
  { test: /^复习错题$/, max: 2 },
  // —— 服务端行为（社区 / 派生；随 pull 回传后经导入重推，需同样可被接受）——
  { test: /^社区打卡$/, max: 5 },
  { test: /^评论帖子$/, max: 1 },
  { test: /^收到评论$/, max: 2 },
  { test: /^获赞$/, max: 1 },
  { test: /^回答被采纳$/, max: 10 },
  { test: /^提问被解答$/, max: 3 },
  { test: /^今日学习满 60 分钟$/, max: 3 },
  { test: /^连续学习满 \d{1,3} 天$/, max: 20 }
]

/** 单笔 award 分值硬上界：兜底防止 `1e308` 这类「整数值浮点」落账导致 `SUM(points)` 溢出为 `null` */
export const MAX_AWARD_POINTS = 200

/**
 * 服务端权威地裁定一条 `award` 事件（issue #11）：校验行为合法性并将其分值钳制到上限。
 *
 * 无法裁定的事件返回 `null`，由调用方**忽略该事件**（不落账、不报错）：
 * - `reason` 不是非空字符串，或未命中白名单（伪造的行为，如 `'free'`）；
 * - `points` 非安全正整数（`NaN`/`Infinity`/小数/0/负数/`1e308` 这类超出安全整数范围的浮点）。
 *
 * 为什么不是 400 整批拒绝：award 事件来自客户端本地 outbox，一条永远无法通过校验的事件会把**整批**
 * push 变成毒记录（与 issue #4/#5 同类故障），该账号所有域的同步会被永久阻塞；而安全目标
 * 「客户端无法伪造分值」由「服务端白名单 + 上限钳制 + 不落账」已经完全达成。
 *
 * 分值**超额**同样不报错，而是钳制到 `min(points, 该行为上限, MAX_AWARD_POINTS)`：
 * 正常用户的值本就 ≤ 上限（口径不变），而客户端学习时长 / 刷题量输入无上界（`<input type="number">`
 * 仅 `min="1"`），若对超额直接报错会让 outbox 里的该事件永远推送失败。
 */
export function resolveAwardPoints(reason: unknown, points: unknown): { reason: string; points: number } | null {
  if (typeof reason !== 'string' || !reason) return null
  const rule = AWARD_RULES.find((r) => r.test.test(reason))
  if (!rule) return null
  if (typeof points !== 'number' || !Number.isSafeInteger(points) || points < 1) return null
  return { reason, points: Math.min(points, rule.max, MAX_AWARD_POINTS) }
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
