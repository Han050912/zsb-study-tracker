import type { Env } from '../index'
import { on, body } from '../router'
import { first, batch, HttpError } from '../db'
import { assertClean } from './sensitive'

/** 用户设置（user_settings 单行 + default_quotes ↔ 前端 Settings） */

export interface SettingsFull {
  userName: string
  dailyGoalMinutes: number
  wordGoal: number
  problemGoal: number
  examDate: string
  theme: string
  reminderEnabled: boolean
  reminderTime: string
  quotes?: string[]
  maimemoToken?: string
  onboarded: boolean
  joinProgressBoard: boolean
  profileVisibility: 'public' | 'login' | 'private'
  avatar?: string
  bio: string
  doNotDisturb: boolean
  dndStartTime: string
  dndEndTime: string
  dndMutedTypes: string[]
}

/** 容错解析 quotes JSON：数据损坏时降级为 undefined（用默认值），不拖垮整个设置接口 */
function parseQuotes(raw: unknown): string[] | undefined {
  if (typeof raw !== 'string') return undefined
  try {
    const v = JSON.parse(raw)
    return Array.isArray(v) ? v : undefined
  } catch {
    return undefined
  }
}

/** 通知类型白名单（勿扰屏蔽类型的合法取值） */
export const NOTIF_TYPES = ['like', 'comment', 'follow', 'achievement', 'message', 'system'] as const

/** 容错解析勿扰屏蔽类型 JSON：非法/损坏时回退空数组 */
export function parseMutedTypes(raw: unknown): string[] {
  if (typeof raw !== 'string' || !raw) return []
  try {
    const v = JSON.parse(raw)
    return Array.isArray(v)
      ? v.filter((t): t is string => typeof t === 'string' && (NOTIF_TYPES as readonly string[]).includes(t))
      : []
  } catch {
    return []
  }
}

export async function getSettings(env: Env, userId: string): Promise<SettingsFull> {
  const row = await first(env, 'SELECT s.*, u.username FROM user_settings s LEFT JOIN users u ON u.id = s.user_id WHERE s.user_id = ?', userId)
  const quotesRow = await first(env, 'SELECT quotes FROM default_quotes WHERE user_id = ?', userId)
  return {
    userName: row?.user_name ?? row?.username ?? '',
    dailyGoalMinutes: row?.daily_goal_minutes ?? 240,
    wordGoal: row?.word_goal ?? 50,
    problemGoal: row?.problem_goal ?? 30,
    examDate: row?.exam_date ?? '',
    theme: row?.theme ?? 'light',
    reminderEnabled: !!row?.reminder_enabled,
    reminderTime: row?.reminder_time ?? '08:00',
    quotes: quotesRow ? parseQuotes((quotesRow as any).quotes) : undefined,
    maimemoToken: row?.maimemo_token ?? undefined,
    onboarded: !!row?.onboarded,
    joinProgressBoard: !!row?.join_progress_board,
    profileVisibility: (row?.profile_visibility as 'public' | 'login' | 'private') ?? 'login',
    avatar: row?.avatar ?? undefined,
    bio: row?.bio ?? '',
    doNotDisturb: !!row?.do_not_disturb,
    dndStartTime: row?.dnd_start_time ?? '',
    dndEndTime: row?.dnd_end_time ?? '',
    dndMutedTypes: parseMutedTypes(row?.dnd_muted_types),
  }
}

/** 生成设置数据的写入语句（upsert user_settings + default_quotes）。
 *  maimemoToken 为 undefined 时跳过该列，避免未持有 Token 的设备把云端 Token 覆盖为 NULL。 */
export function settingsReplaceStatements(env: Env, userId: string, s: SettingsFull): D1PreparedStatement[] {
  const commonCols = 'user_name = excluded.user_name, daily_goal_minutes = excluded.daily_goal_minutes, word_goal = excluded.word_goal, ' +
    'problem_goal = excluded.problem_goal, exam_date = excluded.exam_date, theme = excluded.theme, reminder_enabled = excluded.reminder_enabled, ' +
    'reminder_time = excluded.reminder_time, onboarded = excluded.onboarded, join_progress_board = excluded.join_progress_board, profile_visibility = excluded.profile_visibility, bio = excluded.bio, ' +
    'do_not_disturb = excluded.do_not_disturb, dnd_start_time = excluded.dnd_start_time, dnd_end_time = excluded.dnd_end_time, dnd_muted_types = excluded.dnd_muted_types'
  // 昵称缺失或为空（含纯空白）时写入 NULL：展示端统一回退登录用户名（COALESCE 口径），
  // 避免前端误传空字符串导致社区/团队等处出现空白作者名
  const userName = typeof s.userName === 'string' && s.userName.trim() ? s.userName.trim() : null
  const mutedJson = JSON.stringify(Array.isArray(s.dndMutedTypes) ? s.dndMutedTypes : [])
  const baseParams = [
    userId, userName, s.dailyGoalMinutes ?? 240, s.wordGoal ?? 50, s.problemGoal ?? 30,
    s.examDate ?? '', s.theme ?? 'light', s.reminderEnabled ? 1 : 0, s.reminderTime ?? '08:00', s.onboarded ? 1 : 0,
    s.joinProgressBoard ? 1 : 0, s.profileVisibility ?? 'login', s.bio ?? '',
    s.doNotDisturb ? 1 : 0, s.dndStartTime ?? '', s.dndEndTime ?? '', mutedJson
  ]
  const stmts: D1PreparedStatement[] = []
  const newCols = ', do_not_disturb, dnd_start_time, dnd_end_time, dnd_muted_types'
  if (s.maimemoToken === undefined) {
    stmts.push(
      env.DB.prepare(
        'INSERT INTO user_settings (user_id, user_name, daily_goal_minutes, word_goal, problem_goal, exam_date, theme, reminder_enabled, reminder_time, onboarded, join_progress_board, profile_visibility, bio' + newCols + ') ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ' +
        `ON CONFLICT(user_id) DO UPDATE SET ${commonCols}`
      ).bind(...baseParams)
    )
  } else {
    stmts.push(
      env.DB.prepare(
        'INSERT INTO user_settings (user_id, user_name, daily_goal_minutes, word_goal, problem_goal, exam_date, theme, reminder_enabled, reminder_time, onboarded, join_progress_board, profile_visibility, bio, maimemo_token' + newCols + ') ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ' +
        `ON CONFLICT(user_id) DO UPDATE SET ${commonCols}, maimemo_token = excluded.maimemo_token`
      ).bind(...baseParams, s.maimemoToken)
    )
  }
  if (Array.isArray(s.quotes)) {
    stmts.push(
      env.DB.prepare(
        'INSERT INTO default_quotes (user_id, quotes) VALUES (?, ?) ' +
        'ON CONFLICT(user_id) DO UPDATE SET quotes = excluded.quotes'
      ).bind(userId, JSON.stringify(s.quotes))
    )
  }
  return stmts
}

export function registerSettingsRoutes() {
  on('GET', '/api/settings', true, async (ctx) => {
    return Response.json(await getSettings(ctx.env, ctx.userId))
  })

  on('PUT', '/api/settings', true, async (ctx) => {
    const b = await body<SettingsFull>(ctx.request)
    // 昵称在社区公开可见（发帖/评论/榜单/资料卡），过敏感词 + 长度限制
    if (typeof b?.userName === 'string' && b.userName.trim()) {
      const name = b.userName.trim()
      if (name.length > 30) throw new HttpError(400, '昵称最多 30 个字符')
      assertClean(name)
      b.userName = name
    }
    // 简介在我的页/访客主页公开可见，与昵称同口径过敏感词 + 长度限制；纯空白归一为 ''
    if (typeof b?.bio === 'string') {
      const bio = b.bio.trim()
      if (bio.length > 100) throw new HttpError(400, '简介最多 100 个字符')
      if (bio) assertClean(bio)
      b.bio = bio
    }
    await batch(ctx.env, settingsReplaceStatements(ctx.env, ctx.userId, b))
    return Response.json(await getSettings(ctx.env, ctx.userId))
  })
}
