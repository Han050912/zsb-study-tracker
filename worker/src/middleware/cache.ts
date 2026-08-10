/**
 * Cache API 中间件：对高频只读 GET 请求提供 Cloudflare 边缘缓存。
 * 缓存 key = URL + Authorization header 哈希，实现用户隔离。
 */

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

/** 构造带用户隔离的缓存 key URL：在原 URL 中附加 Authorization 头部的简略标识 */
function cacheKeyUrl(request: Request): string {
  const url = new URL(request.url)
  const auth = request.headers.get('Authorization') || ''
  // 取 token 末尾 32 字符作为用户标识：JWT 前缀（header/payload 头部）对所有用户相同，
  // 只有末尾签名段随用户/签发时间变化，取前缀会导致跨用户共享缓存
  if (auth) url.searchParams.set('_c', auth.slice(-32))
  return url.toString()
}

export function canCache(request: Request): boolean {
  if (request.method !== 'GET') return false
  return CACHEABLE_PREFIXES.some((p) => new URL(request.url).pathname.startsWith(p))
}

export async function getCached(request: Request): Promise<Response | undefined> {
  const cache = caches.default
  return cache.match(cacheKeyUrl(request))
}

export function putCache(request: Request, response: Response, ctx: ExecutionContext): void {
  const cache = caches.default
  const url = cacheKeyUrl(request)
  const res = new Response(response.body, response)
  // Cloudflare Cache API 对普通请求默认不缓存，需显式设置 Cache-Control
  res.headers.set('Cache-Control', `public, max-age=${CACHE_TTL}`)
  ctx.waitUntil(cache.put(url, res))
}
