import { z } from 'zod'
import type { Env } from '../index'
import { on, body } from '../router'
import { first, HttpError } from '../db'
import { assertCleanAsync } from './sensitive'
import { encryptSecret } from '../crypto'

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
  /** 仅写入时携带（明文，由后端加密存储）；读取永不回传明文 */
  maimemoToken?: string
  /** 是否已配置墨墨开放 API Token（读取用，不回传明文） */
  maimemoConnected: boolean
  onboarded: boolean
  joinProgressBoard: boolean
  profileVisibility: 'public' | 'login' | 'private'
  avatar?: string
  bio: string
  doNotDisturb: boolean
  dndStartTime: string
  dndEndTime: string
  dndMutedTypes: string[]
  dndMuteMessage: boolean
  /** 允许搭子查看我的学习数据（周报对比/定向分享；默认关闭） */
  partnerShareEnabled: boolean
  /** 允许搭子向我发送学习鼓励提醒（默认开启） */
  partnerRemindEnabled: boolean
}

/**
 * 通知类型白名单（勿扰屏蔽类型的合法取值）
 * 其中 'message' 仅为兼容历史设置值保留（私信已不产生通知行，见 messages/unread-count）；
 * 保留它可让用户设置里历史存储的 dnd_muted_types 中的 'message' 被正常解析，而非被静默丢弃。
 */
export const NOTIF_TYPES = ['like', 'comment', 'follow', 'achievement', 'message', 'system', 'partner'] as const

/** 主题取值（对齐前端 `src/types/settings.ts` 的 'light' | 'dark' | 'auto'） */
export const THEMES = ['light', 'dark', 'auto'] as const

/** 资料可见性取值（对齐前端 `profileVisibility`） */
const PROFILE_VISIBILITIES = ['public', 'login', 'private'] as const

/**
 * 设置字段 schema（**单点定义**）：REST `/api/settings/validate` 与记录级同步 settings 域共用同一份
 * 逐字段类型 / 范围 / 长度 / 枚举校验（issue #39）。
 *
 * 字段全部可选：REST 只提交待校验的公开文本字段（userName/bio），记录级同步提交整条设置记录；
 * 未列出的运行时字段透传（passthrough），D1 bind 只接受标量，对象/数组会被 TypeErrors 报成 500，
 * 故这里必须提前判成 400 中文提示。
 */
export const settingsBodySchema = z
  .object({
    userName: z.string().max(30, '昵称最多 30 个字符').optional(),
    bio: z.string().max(100, '简介最多 100 个字符').optional(),
    dailyGoalMinutes: z.number().min(0, '每日学习目标不能为负数').optional(),
    wordGoal: z.number().min(0, '每日单词目标不能为负数').optional(),
    problemGoal: z.number().min(0, '每日做题目标不能为负数').optional(),
    examDate: z.string().max(10, '考试日期最多 10 个字符（YYYY-MM-DD）').optional(),
    theme: z.enum(THEMES, { message: '主题取值无效' }).optional(),
    reminderEnabled: z.boolean().optional(),
    reminderTime: z.string().max(8, '提醒时间最多 8 个字符').optional(),
    quotes: z.array(z.string().max(200, '单条自定义引言最多 200 字')).optional(),
    maimemoToken: z.string().optional(),
    onboarded: z.boolean().optional(),
    joinProgressBoard: z.boolean().optional(),
    profileVisibility: z.enum(PROFILE_VISIBILITIES, { message: '资料可见性取值无效' }).optional(),
    avatar: z.string().optional(),
    doNotDisturb: z.boolean().optional(),
    dndStartTime: z.string().max(8, '免打扰开始时间最多 8 个字符').optional(),
    dndEndTime: z.string().max(8, '免打扰结束时间最多 8 个字符').optional(),
    dndMutedTypes: z.array(z.enum(NOTIF_TYPES, { message: '通知类型无效' })).optional(),
    dndMuteMessage: z.boolean().optional(),
    partnerShareEnabled: z.boolean().optional(),
    partnerRemindEnabled: z.boolean().optional()
  })
  .passthrough()

/**
 * 设置记录校验入口：REST 预校验与记录级同步共用，返回 trim 后的新对象。
 * 先按 `settingsBodySchema` 做逐字段类型/范围/长度校验（非法一律 400 中文提示），再校验昵称/简介敏感词。
 */
export async function validateSettingsPublicText(value: SettingsFull, env: Env): Promise<SettingsFull> {
  const parsed = settingsBodySchema.safeParse(value)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new HttpError(400, `设置参数无效：${issue.path.join('.')} ${issue.message}`)
  }
  const next: SettingsFull = { ...value }
  if (typeof next.userName === 'string' && next.userName.trim()) {
    const name = next.userName.trim()
    if (name.length > 30) throw new HttpError(400, '昵称最多 30 个字符')
    await assertCleanAsync(name, env)
    next.userName = name
  }
  if (typeof next.bio === 'string') {
    const bio = next.bio.trim()
    if (bio.length > 100) throw new HttpError(400, '简介最多 100 个字符')
    if (bio) await assertCleanAsync(bio, env)
    next.bio = bio
  }
  return next
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
  const row = await first(
    env,
    'SELECT s.*, u.username FROM user_settings s LEFT JOIN users u ON u.id = s.user_id WHERE s.user_id = ?',
    userId
  )
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
    maimemoConnected: !!row?.maimemo_token,
    onboarded: !!row?.onboarded,
    joinProgressBoard: !!row?.join_progress_board,
    profileVisibility: (row?.profile_visibility as 'public' | 'login' | 'private') ?? 'login',
    avatar: row?.avatar ?? undefined,
    bio: row?.bio ?? '',
    doNotDisturb: !!row?.do_not_disturb,
    dndStartTime: row?.dnd_start_time ?? '',
    dndEndTime: row?.dnd_end_time ?? '',
    dndMutedTypes: parseMutedTypes(row?.dnd_muted_types),
    dndMuteMessage: !!row?.dnd_mute_message,
    partnerShareEnabled: !!row?.partner_share_enabled,
    partnerRemindEnabled: row?.partner_remind_enabled !== 0
  }
}

/** 生成设置数据的写入语句（upsert user_settings + default_quotes）。
 *  maimemoToken 仅在传入明文时加密存储；undefined 跳过该列，避免未持有 Token 的设备把云端凭证覆盖掉。 */
export async function settingsReplaceStatements(
  env: Env,
  userId: string,
  s: SettingsFull
): Promise<D1PreparedStatement[]> {
  const commonCols =
    'user_name = excluded.user_name, daily_goal_minutes = excluded.daily_goal_minutes, word_goal = excluded.word_goal, ' +
    'problem_goal = excluded.problem_goal, exam_date = excluded.exam_date, theme = excluded.theme, reminder_enabled = excluded.reminder_enabled, ' +
    'reminder_time = excluded.reminder_time, onboarded = excluded.onboarded, join_progress_board = excluded.join_progress_board, profile_visibility = excluded.profile_visibility, bio = excluded.bio, ' +
    'do_not_disturb = excluded.do_not_disturb, dnd_start_time = excluded.dnd_start_time, dnd_end_time = excluded.dnd_end_time, dnd_muted_types = excluded.dnd_muted_types, dnd_mute_message = excluded.dnd_mute_message, ' +
    'partner_share_enabled = excluded.partner_share_enabled, partner_remind_enabled = excluded.partner_remind_enabled, avatar = excluded.avatar'
  // 昵称缺失或为空（含纯空白）时写入 NULL：展示端统一回退登录用户名（COALESCE 口径），
  // 避免前端误传空字符串导致社区/团队等处出现空白作者名
  const userName = typeof s.userName === 'string' && s.userName.trim() ? s.userName.trim() : null
  const mutedJson = JSON.stringify(Array.isArray(s.dndMutedTypes) ? s.dndMutedTypes : [])
  const baseParams = [
    userId,
    userName,
    s.dailyGoalMinutes ?? 240,
    s.wordGoal ?? 50,
    s.problemGoal ?? 30,
    s.examDate ?? '',
    s.theme ?? 'light',
    s.reminderEnabled ? 1 : 0,
    s.reminderTime ?? '08:00',
    s.onboarded ? 1 : 0,
    s.joinProgressBoard ? 1 : 0,
    s.profileVisibility ?? 'login',
    s.bio ?? '',
    s.doNotDisturb ? 1 : 0,
    s.dndStartTime ?? '',
    s.dndEndTime ?? '',
    mutedJson,
    s.dndMuteMessage ? 1 : 0,
    s.partnerShareEnabled ? 1 : 0,
    s.partnerRemindEnabled ? 1 : 0
  ]
  const stmts: D1PreparedStatement[] = []
  const newCols =
    ', do_not_disturb, dnd_start_time, dnd_end_time, dnd_muted_types, dnd_mute_message, partner_share_enabled, partner_remind_enabled'

  // 墨墨 Token 仅写入时加密存储（AES-256-GCM，密钥派生自 JWT_SECRET）
  const tokenCipher =
    typeof s.maimemoToken === 'string' && s.maimemoToken.trim() ? await encryptSecret(env, s.maimemoToken) : undefined

  if (tokenCipher === undefined) {
    stmts.push(
      env.DB.prepare(
        'INSERT INTO user_settings (user_id, user_name, daily_goal_minutes, word_goal, problem_goal, exam_date, theme, reminder_enabled, reminder_time, onboarded, join_progress_board, profile_visibility, bio' +
          newCols +
          ') ' +
          'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ' +
          `ON CONFLICT(user_id) DO UPDATE SET ${commonCols}`
      ).bind(...baseParams)
    )
  } else {
    stmts.push(
      env.DB.prepare(
        'INSERT INTO user_settings (user_id, user_name, daily_goal_minutes, word_goal, problem_goal, exam_date, theme, reminder_enabled, reminder_time, onboarded, join_progress_board, profile_visibility, bio' +
          newCols +
          ', maimemo_token) ' +
          'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ' +
          `ON CONFLICT(user_id) DO UPDATE SET ${commonCols}, maimemo_token = excluded.maimemo_token`
      ).bind(...baseParams, tokenCipher)
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

/**
 * 设置域的记录级写入（键 = self）：复用 settingsReplaceStatements 的语义
 * （`maimemoToken` 仅明文传入时覆盖，未传则保留云端已有凭证），并补写记录级 `updated_at/server_seq`
 * ——该记录跨 user_settings（设置本体）与 default_quotes（自定义引言）两张行记录。
 */
export async function settingsRecordStatements(
  env: Env,
  userId: string,
  value: SettingsFull,
  stamp: { updatedAt: number; seq: number }
): Promise<D1PreparedStatement[]> {
  return [
    ...(await settingsReplaceStatements(env, userId, value)),
    env.DB.prepare('UPDATE user_settings SET updated_at = ?, server_seq = ? WHERE user_id = ?').bind(
      stamp.updatedAt,
      stamp.seq,
      userId
    ),
    env.DB.prepare('UPDATE default_quotes SET updated_at = ?, server_seq = ? WHERE user_id = ?').bind(
      stamp.updatedAt,
      stamp.seq,
      userId
    )
  ]
}

export function registerSettingsRoutes() {
  on('GET', '/api/settings', true, async (ctx) => {
    return Response.json(await getSettings(ctx.env, ctx.userId))
  })

  on('POST', '/api/settings/validate', true, async (ctx) => {
    const b = await body<SettingsFull>(ctx.request)
    const validated = await validateSettingsPublicText(b, ctx.env)
    return Response.json({ userName: validated.userName, bio: validated.bio })
  })
}
