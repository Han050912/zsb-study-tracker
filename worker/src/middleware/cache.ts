/**
 * Cache API 中间件：对高频只读 GET 请求提供 Cloudflare 边缘缓存。
 * 缓存 key = URL + 会话 token 哈希，实现用户隔离。
 * 注意：这些前缀路由全部是 auth=true 的私有数据，认证可能来自 HttpOnly Cookie
 * （无 Authorization 头）或 Bearer 头，两者都必须纳入 key，否则会跨用户命中缓存。
 */

import { extractToken } from './auth'

const CACHEABLE_PREFIXES = [
  '/api/subjects',
  '/api/settings',
  '/api/habits',
  '/api/gamification',
  '/api/summaries',
  '/api/pomodoro',
  '/api/todos',
]

const CACHE_TTL = 60 // 秒

/** 构造带用户隔离的缓存 key URL：附加会话 token（Cookie 或 Bearer）的 SHA-256 简略哈希 */
async function cacheKeyUrl(request: Request): Promise<string> {
  const url = new URL(request.url)
  const ext = extractToken(request)
  if (ext) {
    // 哈希后取前 16 个十六进制字符（64 位）作为标识：不把 token 原文放进 URL，
    // 且对同一 token 稳定（同一用户多次请求命中同一 key）
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ext.token))
    const hex = Array.from(new Uint8Array(digest).slice(0, 8))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
    url.searchParams.set('_c', hex)
  }
  return url.toString()
}

export function canCache(request: Request): boolean {
  if (request.method !== 'GET') return false
  return CACHEABLE_PREFIXES.some((p) => new URL(request.url).pathname.startsWith(p))
}

export async function getCached(request: Request): Promise<Response | undefined> {
  const cache = caches.default
  return cache.match(await cacheKeyUrl(request))
}

export function putCache(request: Request, response: Response, ctx: ExecutionContext): void {
  const cache = caches.default
  ctx.waitUntil(
    cacheKeyUrl(request).then((url) => {
      const res = new Response(response.body, response)
      // Cloudflare Cache API 对普通请求默认不缓存，需显式设置 Cache-Control
      res.headers.set('Cache-Control', `public, max-age=${CACHE_TTL}`)
      return cache.put(url, res)
    })
  )
}
