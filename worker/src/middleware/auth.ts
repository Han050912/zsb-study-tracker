import type { Env } from '../index'
import { verifyToken } from '../auth'
import { HttpError } from '../db'

/** 解析 `Authorization: Bearer <jwt>` → user_id；缺失/无效一律 401 */
export async function requireAuth(request: Request, env: Env): Promise<string> {
  const header = request.headers.get('Authorization') || ''
  const [scheme, token] = header.split(' ')
  if (scheme !== 'Bearer' || !token) throw new HttpError(401, '未登录或登录已过期')
  const userId = await verifyToken(token, env.JWT_SECRET)
  if (!userId) throw new HttpError(401, '未登录或登录已过期')
  return userId
}

/**
 * 解析 `Authorization: Bearer <jwt>` → user_id（可选用户）。
 * 缺失/格式错误/令牌无效均返回空字符串，不抛错。
 * 用于 auth=false 路由中识别「请求方是不是登录用户」（前端 SQL 关联 like/follow 状态、
 * `assertProfileVisible` 等需要 login 可见性判断都依赖于此），避免认证用户访问公开
 * 接口时被误判为匿名、导致 `login` 可见性资料误返 401 触发 `handleUnauthorized()` 清会话。
 */
export async function tryGetUser(request: Request, env: Env): Promise<string> {
  const header = request.headers.get('Authorization') || ''
  const [scheme, token] = header.split(' ')
  if (scheme !== 'Bearer' || !token) return ''
  return (await verifyToken(token, env.JWT_SECRET)) ?? ''
}
