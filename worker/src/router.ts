import type { Env } from './index'
import { requireAuth, tryGetUser } from './middleware/auth'
import { HttpError } from './db'

export interface Ctx {
  request: Request
  env: Env
  /** 需认证路由由中间件解析注入；公开路由为空字符串 */
  userId: string
  /** 路径参数，如 { id: 'xxx' } */
  params: Record<string, string>
}

type Handler = (ctx: Ctx) => Promise<Response> | Response

interface Route {
  method: string
  /** 路径段数组，':xxx' 为参数段 */
  segments: string[]
  auth: boolean
  handler: Handler
}

const routes: Route[] = []

/** 注册路由。pattern 形如 '/api/records/:id'；auth=true 时自动经过 JWT 中间件。 */
export function on(method: string, pattern: string, auth: boolean, handler: Handler) {
  routes.push({
    method: method.toUpperCase(),
    segments: pattern.split('/').filter(Boolean),
    auth,
    handler
  })
}

function match(segments: string[], path: string[]): Record<string, string> | null {
  if (segments.length !== path.length) return null
  const params: Record<string, string> = {}
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    if (seg.startsWith(':')) {
      try {
        params[seg.slice(1)] = decodeURIComponent(path[i])
      } catch {
        // 畸形百分号编码（如 %zz）视为不匹配，交由上层返回 404，而非 500
        return null
      }
    }
    else if (seg !== path[i]) return null
  }
  return params
}

export async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const path = url.pathname.split('/').filter(Boolean)
  const method = request.method.toUpperCase()

  for (const r of routes) {
    if (r.method !== method) continue
    const params = match(r.segments, path)
    if (!params) continue
    // auth=true：无有效 JWT 直接抛 401（数据接口必须登录态）
    // auth=false：仍尝试解析 JWT，已登录用户 ctx.userId 不再被误清空；
    //   公开接口的 SQL 关联（liked_by_me/disliked_by_me/followed_by_me）和
    //   login 可见性判断依赖于此，否则认证用户访问公开接口会被误判为匿名
    const userId = r.auth ? await requireAuth(request, env) : await tryGetUser(request, env)
    return r.handler({ request, env, userId, params })
  }
  throw new HttpError(404, '接口不存在')
}

/** 解析 JSON 请求体；非法 JSON 抛出 400。 */
export async function body<T = any>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T
  } catch {
    throw new HttpError(400, '请求体不是合法 JSON')
  }
}
