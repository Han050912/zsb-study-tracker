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
