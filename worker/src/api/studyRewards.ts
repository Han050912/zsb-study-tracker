import type { Env } from '../index'
import { utc8Today } from '../db'
import type { PointsAward } from './gamification'

/** UTC+8 自然日学习积分上限；社区互动积分不占用此额度。 */
export const DAILY_STUDY_POINTS_LIMIT = 300

/** 已有流水只用于首次建立当天额度，不回收历史积分，也不把社区互动记入学习额度。 */
function initializeBudget(env: Env, userId: string, day: string): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT OR IGNORE INTO study_reward_daily_usage (user_id, date, spent, last_grant)
    SELECT ?, ?, COALESCE(SUM(MAX(points, 0)), 0), 0 FROM points_log WHERE user_id = ? AND date = ? AND (
      substr(ref_id, 1, 6) = 'study:' OR ref_id GLOB 'srv:study-minutes:*' OR ref_id GLOB 'srv:streak:*'
      OR ((ref_id IS NULL OR (substr(ref_id, 1, 4) <> 'srv:' AND substr(ref_id, 1, 6) <> 'study:')) AND (
        reason GLOB '学习 * 分钟' OR reason GLOB '刷题 * 道' OR reason GLOB '完成习惯「*」'
        OR reason IN ('背单词', '听力练习', '阅读训练', '完成真题/套卷', '完成番茄钟', '完成待办',
          '每日打卡', '完成每日总结', '复习错题', '今日学习满 60 分钟')
        OR reason GLOB '连续学习满 * 天'
      ))
    )`
  ).bind(userId, day, userId, day)
}

/** Only changes accepted by sync's transaction are supplied here, never the raw request domains. */
export interface StudyRewardChange {
  domain: string
  key: string
  operation: 'upsert' | 'delete'
}

interface Reward {
  ref: string
  legacyRef: string
  legacyReason: string
  // A parameterized SELECT returning points and reason, or no row when the action is not eligible.
  source: string
  params: unknown[]
}

/** Keep the existing client cancellation/display contract while storing unambiguous server-owned keys. */
export function clientStudyRef(ref: string | null): string | undefined {
  if (!ref) return undefined
  const mappings: [string, string][] = [
    ['study:records:', ''],
    ['study:problemSessions:', ''],
    ['study:exams:', ''],
    ['study:errorQuestions:', 'error:'],
    ['study:todos:', ''],
    ['study:pomodoro:', ''],
    ['study:english:vocab:', ''],
    ['study:english:reading:', ''],
    ['study:english:listening:', ''],
    ['study:habits:', 'habit:'],
    ['study:summaries:', 'summary:'],
    ['study:checkin:', 'checkin:']
  ]
  for (const [prefix, replacement] of mappings)
    if (ref.startsWith(prefix)) return replacement + ref.slice(prefix.length)
  return ref
}

/**
 * Reconcile one natural reward key against the business rows already written in this batch.
 * Reuse the oldest compatible legacy row instead of issuing a second award on upgrade/import.
 * id is the existing integer PK (NULL allocates a fresh one); no new schema/index is required.
 * SQL-side checks are evaluated at commit time. A client-provided reward amount/date is never bound.
 */
function reconcile(env: Env, userId: string, day: string, reward: Reward): D1PreparedStatement[] {
  const match = `(ref_id = ? OR (ref_id = ? AND reason GLOB ?
    AND substr(ref_id, 1, 4) <> 'srv:' AND substr(ref_id, 1, 6) <> 'study:'))`
  const identity = [userId, reward.ref, reward.legacyRef, reward.legacyReason]
  const existing = `SELECT id, date, points FROM points_log WHERE user_id = ? AND ${match}`
  const oldPoints = 'COALESCE((SELECT points FROM existing ORDER BY id LIMIT 1), 0)'
  // Previously credited days are closed: replay/edit may reduce a reward but cannot grow an old day's leaderboard.
  const delta = `CASE WHEN EXISTS (SELECT 1 FROM existing WHERE date <> ?) THEN 0 ELSE
    MIN(MAX(0, COALESCE((SELECT points FROM reward LIMIT 1), 0) - ${oldPoints}), MAX(0, ? - spent)) END`
  const credited = `MIN(r.points, ${oldPoints} + (SELECT last_grant FROM study_reward_daily_usage WHERE user_id = ? AND date = ?))`
  return [
    // last_grant carries this statement's reserved delta to the next statement within the SAME atomic batch.
    // spent only increases: cancellation/deletion must never reopen today's earning allowance.
    env.DB.prepare(
      `WITH reward AS (${reward.source}), existing AS (${existing})
      UPDATE study_reward_daily_usage SET last_grant = ${delta}, spent = spent + ${delta}
      WHERE user_id = ? AND date = ?
    `
    ).bind(...reward.params, ...identity, day, DAILY_STUDY_POINTS_LIMIT, day, DAILY_STUDY_POINTS_LIMIT, userId, day),
    env.DB.prepare(
      `
      WITH reward AS (${reward.source}), existing AS (${existing})
      INSERT INTO points_log (id, user_id, date, points, reason, ref_id)
      SELECT (SELECT MIN(id) FROM existing), ?,
        COALESCE((SELECT date FROM existing ORDER BY id LIMIT 1), ?), ${credited}, r.reason, ?
      FROM reward r WHERE r.points > 0 AND ${credited} > 0
      ON CONFLICT(id) DO UPDATE SET points = excluded.points, reason = excluded.reason, ref_id = excluded.ref_id
    `
    ).bind(...reward.params, ...identity, userId, day, userId, day, reward.ref, userId, day),
    env.DB.prepare(
      `
      WITH reward AS (${reward.source}), existing AS (${existing})
      DELETE FROM points_log WHERE user_id = ? AND ${match}
        AND (NOT EXISTS (SELECT 1 FROM reward WHERE points > 0) OR id <> (SELECT MIN(id) FROM existing))
    `
    ).bind(...reward.params, ...identity, ...identity)
  ]
}

/**
 * Append after accepted business writes and before gamificationProjectionStatement, in the SAME batch.
 * Raw points are compatibility intents only: daily check-in, or a completed pomodoro referencing a
 * persisted record. All other awards/revokes are derived from business state; refPrefix/all are ignored.
 * The surrounding sync CAS must rebuild this array on a conflict (including the server business day).
 */
export function studyRewardStatements(
  env: Env,
  userId: string,
  changes: StudyRewardChange[],
  rawPoints: unknown,
  day = utc8Today()
): D1PreparedStatement[] {
  let checkin = false
  const completedPomodoros = new Set<string>()
  for (const value of Array.isArray(rawPoints) ? rawPoints : []) {
    if (!value || typeof value !== 'object' || value.op !== 'award') continue
    if (value.reason === '每日打卡') checkin = true
    if (value.reason === '完成番茄钟' && typeof value.refId === 'string' && value.refId) {
      completedPomodoros.add(value.refId)
    }
  }

  const pending = new Map<string, StudyRewardChange>()
  for (const change of changes) pending.set(`${change.domain}:${change.key}`, change)
  // Legacy clients may flush the completion intent separately from its already persisted record.
  for (const id of completedPomodoros) {
    const key = `rec:${id}`
    if (!pending.has(`pomodoro:${key}`))
      pending.set(`pomodoro:${key}`, { domain: 'pomodoro', key, operation: 'upsert' })
  }
  const statements: D1PreparedStatement[] = [initializeBudget(env, userId, day)]
  for (const { domain, key, operation } of pending.values()) {
    let reward: Reward | undefined
    const row = (table: string, points: string, reason: string, condition = '1') =>
      `SELECT ${points} AS points, ${reason} AS reason FROM ${table} WHERE user_id = ? AND id = ? AND (${condition})`
    const basic = (source: string, legacyReason: string, legacyRef = key, ref = `study:${domain}:${key}`): Reward => ({
      ref,
      legacyRef,
      legacyReason,
      source,
      params: [userId, key]
    })
    if (domain === 'records') {
      reward = basic(
        row(
          'study_records',
          'MIN(150, MAX(1, CAST(ROUND(minutes / 10.0) AS INTEGER)))',
          "'学习 ' || minutes || ' 分钟'",
          'minutes > 0'
        ),
        '学习 * 分钟'
      )
    } else if (domain === 'problemSessions') {
      reward = basic(
        row(
          'problem_sessions',
          'MIN(200, MAX(0, CAST(ROUND(total / 5.0) AS INTEGER)))',
          "'刷题 ' || total || ' 道'",
          'total > 0'
        ),
        '刷题 * 道'
      )
    } else if (domain === 'exams') {
      reward = basic(row('exam_records', '20', "'完成真题/套卷'"), '完成真题/套卷')
    } else if (domain === 'errorQuestions') {
      reward = basic(row('error_questions', '2', "'复习错题'", 'review_count > 0'), '复习错题', `error:${key}`)
    } else if (domain === 'todos') {
      reward = basic(row('todos', '3', "'完成待办'", 'done = 1'), '完成待办')
    } else if (domain === 'english') {
      const split = key.indexOf(':')
      const type = key.slice(0, split)
      const id = key.slice(split + 1)
      if (type === 'vocab')
        reward = basic(
          row(
            'vocab_records',
            'MIN(100, MAX(0, CAST(ROUND((new_words + review_words) / 20.0) AS INTEGER)))',
            "'背单词'"
          ),
          '背单词',
          id
        )
      if (type === 'reading') reward = basic(row('reading_records', '5', "'阅读训练'"), '阅读训练', id)
      if (type === 'listening')
        reward = basic(
          row(
            'listening_records',
            'MIN(100, MAX(0, CAST(ROUND(minutes / 10.0) AS INTEGER)))',
            "'听力练习'",
            'minutes > 0'
          ),
          '听力练习',
          id
        )
      if (reward) reward.params = [userId, id]
    } else if (domain === 'pomodoro' && key.startsWith('rec:')) {
      const id = key.slice(4)
      const ref = `study:pomodoro:${id}`
      // Persisted completion is the fact source; raw completion intents cannot reward early stops.
      // Legacy rows are migrated with completed=1, retaining their original completion semantics.
      reward = {
        ref,
        legacyRef: id,
        legacyReason: '完成番茄钟',
        source: row('pomodoro_records', '5', "'完成番茄钟'", 'minutes >= 1 AND completed = 1'),
        params: [userId, id]
      }
    } else if (domain === 'summaries') {
      const ref = `study:summaries:${key}`
      reward = {
        ref,
        legacyRef: `summary:${key}`,
        legacyReason: '完成每日总结',
        source: `SELECT 5 AS points, '完成每日总结' AS reason FROM daily_summaries
          WHERE user_id = ? AND date = ? AND (date = ? OR EXISTS (
            SELECT 1 FROM points_log p WHERE p.user_id = ? AND p.reason = '完成每日总结'
              AND (p.ref_id = ? OR p.ref_id = ?)))`,
        params: [userId, key, day, userId, ref, `summary:${key}`]
      }
    } else if (domain === 'habits') {
      // Deleting the habit revokes all its days. Editing historical dates has never awarded points.
      statements.push(
        env.DB.prepare(
          `DELETE FROM points_log WHERE user_id = ?
        AND ((instr(ref_id, ?) = 1 AND length(ref_id) = ?) OR
          (instr(ref_id, ?) = 1 AND length(ref_id) = ? AND reason GLOB '完成习惯「*」'))
        AND NOT EXISTS (SELECT 1 FROM habits WHERE user_id = ? AND id = ?)
      `
        ).bind(
          userId,
          `study:habits:${key}:`,
          `study:habits:${key}:`.length + 10,
          `habit:${key}:`,
          `habit:${key}:`.length + 10,
          userId,
          key
        )
      )
      reward = {
        ref: `study:habits:${key}:${day}`,
        legacyRef: `habit:${key}:${day}`,
        legacyReason: '完成习惯「*」',
        source: `SELECT 2 AS points, '完成习惯「' || h.name || '」' AS reason
          FROM habits h JOIN habit_records r ON r.user_id = h.user_id AND r.habit_id = h.id
          WHERE h.user_id = ? AND h.id = ? AND r.date = ? AND h.bad = 0 AND r.checkin = 0
            AND CASE WHEN COALESCE(h.target, 0) = 0 OR h.type IN ('checkbox', 'time')
              THEN r.value IS NOT NULL AND r.value <> '' AND r.value <> '0'
              ELSE CAST(r.value AS REAL) >= h.target END`,
        params: [userId, key, day]
      }
    }
    if (!reward) continue
    // A deleted row has no candidate source; evaluating the DB also makes direct revoke-only requests inert.
    if (operation === 'delete') {
      reward.source = "SELECT 0 AS points, '' AS reason WHERE 0"
      reward.params = []
    }
    statements.push(...reconcile(env, userId, day, reward))
  }

  if (checkin)
    statements.push(
      ...reconcile(env, userId, day, {
        ref: `study:checkin:${day}`,
        legacyRef: `checkin:${day}`,
        legacyReason: '每日打卡',
        source: "SELECT 10 AS points, '每日打卡' AS reason",
        params: []
      })
    )
  return statements
}

/** 服务端派生学习奖励（满60分钟/连续学习里程碑）共用学习额度；绝不传客户端 awards。 */
export function cappedStudyAwardStatements(
  env: Env,
  userId: string,
  awards: PointsAward[],
  day = utc8Today()
): D1PreparedStatement[] {
  return [
    initializeBudget(env, userId, day),
    ...awards.flatMap((award) =>
      reconcile(env, userId, day, {
        ref: award.refId,
        legacyRef: award.refId,
        legacyReason: award.reason,
        source: 'SELECT ? AS points, ? AS reason',
        params: [award.points, award.reason]
      })
    )
  ]
}
