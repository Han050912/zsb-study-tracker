/** 只有无需认证的公开图片可在路由前读取 Cache API；私有数据始终经过鉴权。 */
export function canCachePublic(request: Request): boolean {
  if (request.method !== 'GET') return false
  const path = new URL(request.url).pathname
  return (
    /^\/api\/community\/images\/[a-f0-9]{16}$/.test(path) ||
    /^\/api\/avatar\/[a-f0-9]{16}\.(?:png|jpg|webp)$/.test(path)
  )
}

export async function getCached(request: Request): Promise<Response | undefined> {
  if (!canCachePublic(request)) return undefined
  return caches.default.match(request.url)
}

export function putCache(request: Request, response: Response, ctx: ExecutionContext): void {
  if (!canCachePublic(request) || response.status !== 200) return
  ctx.waitUntil(
    caches.default.put(request.url, response).catch((error) => console.error('写入公开图片缓存失败', error))
  )
}
