import { z } from 'zod'
import { HttpError } from './db'

// 全局汉化 zod 4 默认错误文案（类型不匹配等未显式指定 message 的 issue 也返回中文）
z.config(z.locales.zhCN())

/**
 * 请求体 schema 校验层：仅承担「纯数据形状/长度/枚举/格式」校验。
 * DB 查询、敏感词、跨资源所有权、结构化解析一律留在各 handler 内。
 */

/** 解析并校验 JSON 请求体：非法 JSON → 400；schema 不符 → 400（首个 issue 的中文提示）。 */
export async function parseBody<S extends z.ZodTypeAny>(request: Request, schema: S): Promise<z.infer<S>> {
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    throw new HttpError(400, '请求体不是合法 JSON')
  }
  const r = schema.safeParse(raw)
  if (!r.success) {
    throw new HttpError(400, r.error.issues[0]?.message || '请求参数无效')
  }
  return r.data
}

/** 恒定时间字符串比较：两侧分别 SHA-256 后逐字节比对（防时序侧信道；长度差异不泄露）。 */
export async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder()
  const [da, db] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b))
  ])
  const va = new Uint8Array(da)
  const vb = new Uint8Array(db)
  let diff = 0
  for (let i = 0; i < va.length; i++) diff |= va[i]! ^ vb[i]!
  return diff === 0
}

// ---------- 密码策略（唯一新增规则：8-14 位 + 必须同时含字母和数字；仅注册生效） ----------
export const passwordSchema = z.string()
  .min(8, '密码至少 8 位')
  .max(14, '密码最多 14 位')
  .refine(v => /[A-Za-z]/.test(v) && /\d/.test(v), '密码必须同时包含字母和数字')

export const usernameSchema = z.string()
  .transform(s => s.trim())
  .pipe(z.string().min(2, '用户名至少 2 个字符').max(20, '用户名最多 20 个字符'))

export const registerSchema = z.object({
  username: usernameSchema,
  password: passwordSchema
})

export const loginSchema = z.object({
  username: z.string().min(1, '请输入用户名和密码'),
  password: z.string().min(1, '请输入用户名和密码')
})

// ---------- 社区枚举常量（唯一来源，community.ts 后续任务改为从这里 import） ----------
export const POST_TYPES = ['checkin', 'share', 'achievement', 'longform', 'question'] as const
export const QUESTION_SUBJECT_TAGS = ['#高等数学', '#英语'] as const
export const REPORT_REASONS = ['广告', '人身攻击', '不相关内容', '其他'] as const

// ---------- 复用工厂 ----------
/** 帖子/评论/私信配图路径（uploads.ts 同一口径） */
export const IMAGE_URL_PATTERN = /^\/api\/community\/images\/[a-f0-9]{16}$/

/** trim 后校验最大长度（复刻原 `String(x ?? '').trim()` + 长度上限语义） */
export function trimMax(max: number, msg: string) {
  return z.string().transform(s => s.trim()).pipe(z.string().max(max, msg))
}

/** 图片 URL 数组：仅保留字符串 → 去重 → 截断到 max → 逐项校验路径格式（复刻原 handler 语义） */
export function imageUrlsSchema(max: number) {
  return z.array(z.unknown())
    .transform(arr => [...new Set(arr.filter((u): u is string => typeof u === 'string'))].slice(0, max))
    .pipe(z.array(z.string().regex(IMAGE_URL_PATTERN, '图片地址无效')))
}
