import type { Env } from '../index'
import { verifyTokenFull, JWT_TTL_SECONDS } from '../auth'
import { first, HttpError } from '../db'
import { isAllowedOrigin } from '../cors'

export const AUTH_COOKIE = 'zsb_session'

/** 安全方法：GET/HEAD/OPTIONS 无副作用，CSRF 仅针对写请求 */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/** 从请求提取 JWT：优先 HttpOnly Cookie（Web），回退 Authorization Bearer（桌面端） */
export function extractToken(request: Request): { token: string; fromCookie: boolean } | null {
  const cookie = request.headers.get('Cookie') || ''
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${AUTH_COOKIE}=([^;]+)`))
  if (m) return { token: decodeURIComponent(m[1]), fromCookie: true }
  const header = request.headers.get('Authorization') || ''
  const [scheme, token] = header.split(' ')
  if (scheme === 'Bearer' && token) return { token, fromCookie: false }
  return null
}

/** 校验 jti 是否已被登出吊销 */
async function isRevoked(env: Env, jti: string): Promise<boolean> {
  const row = await first(env, 'SELECT 1 AS x FROM jwt_blacklist WHERE jti = ?', jti)
  return !!row
}

/** 会话 Cookie：HttpOnly；https 下 SameSite=None（支持跨站 Web 前端），本地 http 回退 Lax */
export function authCookieHeader(token: string, request: Request): string {
  const secure = new URL(request.url).protocol === 'https:'
  const parts = [
    `${AUTH_COOKIE}=${encodeURIComponent(token)}`,
    'HttpOnly',
    'Path=/',
    `Max-Age=${JWT_TTL_SECONDS}`,
    `SameSite=${secure ? 'None' : 'Lax'}`
  ]
  if (secure) parts.push('Secure')
  return parts.join('; ')
}

/** 清除会话 Cookie（登出） */
export function clearAuthCookieHeader(request: Request): string {
  const secure = new URL(request.url).protocol === 'https:'
  const parts = [`${AUTH_COOKIE}=`, 'HttpOnly', 'Path=/', 'Max-Age=0', `SameSite=${secure ? 'None' : 'Lax'}`]
  if (secure) parts.push('Secure')
  return parts.join('; ')
}

/** 解析并校验 JWT（含黑名单吊销），返回 user_id；失败抛 401 */
async function resolveUser(request: Request, env: Env): Promise<string> {
  const ext = extractToken(request)
  if (!ext) throw new HttpError(401, '未登录或登录已过期')
  // CSRF 防护：Cookie 认证的写请求必须来自可信 Origin（跨站表单/脚本无法伪造 Origin）
  if (ext.fromCookie && !SAFE_METHODS.has(request.method)) {
    const origin = request.headers.get('Origin')
    if (origin && !isAllowedOrigin(origin)) throw new HttpError(403, '请求来源不受信任')
  }
  const payload = await verifyTokenFull(ext.token, env.JWT_SECRET)
  if (!payload) throw new HttpError(401, '未登录或登录已过期')
  if (await isRevoked(env, payload.jti)) throw new HttpError(401, '登录已失效，请重新登录')
  return payload.userId
}

/** 解析 JWT → user_id；缺失/无效/已吊销一律 401 */
export async function requireAuth(request: Request, env: Env): Promise<string> {
  return resolveUser(request, env)
}

/** 可选认证：解析 JWT → user_id；任何失败均返回空字符串（不抛错），供公开接口识别登录态 */
export async function tryGetUser(request: Request, env: Env): Promise<string> {
  try {
    return await resolveUser(request, env)
  } catch {
    return ''
  }
}
