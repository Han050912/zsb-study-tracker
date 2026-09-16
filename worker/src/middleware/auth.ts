import type { Env } from '../index'
import { verifyTokenFull, JWT_TTL_SECONDS } from '../auth'
import { first, HttpError } from '../db'
import { isAllowedOrigin, isLocalHost } from '../cors'

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

/** 吊销判定缓存 TTL 下限（秒）：token 剩余有效期极短时也缓存几秒，避免临界窗口每请求都打 D1 */
const REVOKE_CACHE_MIN_TTL = 5

/** 吊销判定缓存 key：Cache API 的 key 即 URL，用内部伪域名 + jti（UUID）与真实路由的 key 空间隔离 */
function notRevokedCacheKey(jti: string): string {
  return `https://jwt-blacklist.internal/not-revoked/${jti}`
}

/**
 * 校验 jti 是否已被登出吊销。
 * 认证请求的绝大多数是未吊销 token，逐请求查 D1 纯属浪费，故把「未吊销」结果按 jti 缓存进 Cache API：
 * 只缓存否定结果（未吊销），已吊销结果绝不缓存——否则新吊销的 token 会在 TTL 内被旧缓存放行。
 * TTL 取 token 剩余有效期（下限 REVOKE_CACHE_MIN_TTL 秒、上限 JWT_TTL_SECONDS），
 * 保证缓存条目不会比 token 本身活得更久。登出写黑名单后由 api/auth.ts 调 purgeRevokedCache 精确删除，
 * 下一请求即重新查 D1 读到已吊销。
 */
async function isRevoked(env: Env, jti: string, exp: number): Promise<boolean> {
  const cache = caches.default
  const cacheKey = notRevokedCacheKey(jti)
  if (await cache.match(cacheKey)) return false
  const row = await first(env, 'SELECT 1 AS x FROM jwt_blacklist WHERE jti = ?', jti)
  if (row) return true
  const ttl = Math.min(Math.max(exp - Math.floor(Date.now() / 1000), REVOKE_CACHE_MIN_TTL), JWT_TTL_SECONDS)
  // Cache-Control 决定缓存条目有效期；写失败只降级为后续请求继续回源查 D1，不影响本次判定
  const marker = new Response(null, { headers: { 'Cache-Control': `max-age=${ttl}` } })
  await cache.put(cacheKey, marker).catch((e) => console.error('写入吊销判定缓存失败', e))
  return false
}

/** 登出后失效该 jti 的「未吊销」缓存：删除后下一请求重新查 D1，立即读到已吊销 */
export async function purgeRevokedCache(jti: string): Promise<void> {
  await caches.default.delete(notRevokedCacheKey(jti))
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

/** 解析并校验 JWT（含黑名单吊销），返回 user_id + role claim；失败抛 401。
 *  role 为 '' 表示无 role claim（旧 token），消费方需回退 DB 查询角色。
 *  该值仅是签发时快照、签发后不可撤销，只可用于「明确非 admin 即拒绝」的快速否定，
 *  管理员判定必须以 DB 为准（见 isDbAdmin） */
async function resolveUser(request: Request, env: Env): Promise<{ userId: string; role: string }> {
  const ext = extractToken(request)
  if (!ext) throw new HttpError(401, '未登录或登录已过期')
  // CSRF 防护：Cookie 认证的写请求必须来自可信 Origin（跨站表单/脚本无法伪造 Origin）
  if (ext.fromCookie && !SAFE_METHODS.has(request.method)) {
    const origin = request.headers.get('Origin')
    // 与 index.ts 的 CORS 判定一致：本机 host 或 .dev.vars 显式开关（wrangler dev 下 host 被改写时兜底）
    const allowLocal = isLocalHost(new URL(request.url).host) || env.ALLOW_LOCAL_ORIGINS === '1'
    if (origin && !isAllowedOrigin(origin, allowLocal)) throw new HttpError(403, '请求来源不受信任')
  }
  const payload = await verifyTokenFull(ext.token, env.JWT_SECRET)
  if (!payload) throw new HttpError(401, '未登录或登录已过期')
  if (await isRevoked(env, payload.jti, payload.exp)) throw new HttpError(401, '登录已失效，请重新登录')
  return { userId: payload.userId, role: payload.role ?? '' }
}

/** 解析 JWT → { userId, role }；缺失/无效/已吊销一律 401。role 为 '' 表示旧 token 无 role claim */
export async function resolveAuth(request: Request, env: Env): Promise<{ userId: string; role: string }> {
  return resolveUser(request, env)
}

/** 可选认证（内部）：解析 JWT → { userId, role }；任何失败均返回 { userId: '', role: '' }（不抛错） */
export async function tryGetAuth(request: Request, env: Env): Promise<{ userId: string; role: string }> {
  try {
    return await resolveUser(request, env)
  } catch {
    return { userId: '', role: '' }
  }
}

/**
 * 管理员判定的唯一权威来源：以 DB（users.role）为准。
 * JWT 的 role claim 只是签发时快照、签发后无法撤销，不能作为授权依据；
 * 故每次判定都回查 DB（一次主键点查），使管理员在 DB 中被降权后旧 token 立即失去管理能力。
 */
export async function isDbAdmin(env: Env, userId: string): Promise<boolean> {
  if (!userId) return false
  const u = await first<{ role: string }>(env, 'SELECT role FROM users WHERE id = ?', userId)
  return u?.role === 'admin'
}
