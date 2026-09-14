/**
 * Cache API 中间件：对高频只读 GET 请求提供 Cloudflare 边缘缓存。
 * 两类前缀：
 * - 私有前缀（CACHEABLE_PREFIXES）：auth=true 的用户私有数据，缓存 key = URL + 会话 token 哈希
 *   （`_c` 参数）实现用户隔离；认证可能来自 HttpOnly Cookie 或 Bearer 头，两者都必须纳入 key。
 * - 公开前缀（PUBLIC_PREFIXES）：无需登录的图片/头像，缓存 key 为纯 URL（无 `_c`），全站共享。
 */

import { extractToken } from './auth'

const CACHEABLE_PREFIXES = [
  '/api/subjects',
  '/api/settings',
  '/api/habits',
  '/api/gamification',
  '/api/summaries',
  '/api/pomodoro',
  '/api/todos'
]

/** 公开图片/头像路由：内容不可变（头像每次上传换新文件名），边缘长缓存 */
const PUBLIC_PREFIXES = ['/api/community/images/', '/api/avatar/']

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

export function canCachePublic(request: Request): boolean {
  if (request.method !== 'GET') return false
  const path = new URL(request.url).pathname
  return PUBLIC_PREFIXES.some((p) => path.startsWith(p))
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
      // Cloudflare Cache API 需显式 Cache-Control；响应已自带（如图片 immutable）时保留原值
      if (!res.headers.get('Cache-Control')) res.headers.set('Cache-Control', `public, max-age=${CACHE_TTL}`)
      return cache.put(url, res)
    })
  )
}

/**
 * 写操作后失效该用户的全部可缓存 GET：记录级同步的唯一写入口是 push（POST /api/data/push），
 * 它改动的 subjects/settings/habits/summaries/pomodoro/todos 等域都有 GET 读缓存（gamification 域
 * 数据也经 /api/gamification 暴露），不失效会让用户写入后最长 TTL 内读到旧数据。
 * 缓存 key 只由 pathname + token 哈希构成，按前缀逐个删除即可精确清除当前用户的所有缓存条目。
 */
export function purgeUserCache(request: Request, ctx: ExecutionContext): void {
  if (!extractToken(request)) return
  const cache = caches.default
  ctx.waitUntil(
    Promise.all(
      CACHEABLE_PREFIXES.map(async (prefix) => {
        const url = new URL(request.url)
        url.pathname = prefix
        url.search = ''
        await cache.delete(await cacheKeyUrl(new Request(url, { headers: request.headers })))
      })
    ).then(
      () => undefined,
      (e) => console.error('失效读缓存失败', e)
    )
  )
}
