import { HttpError } from '../db'

/**
 * 轻量内存速率限制：按 IP 滑动窗口计数。
 * Cloudflare Worker 为无状态执行环境，冷启动后计数器归零。
 * 生产环境中建议配合 Cloudflare WAF Rate Limiting 获得更强保护。
 */

interface Bucket {
  count: number
  resetAt: number
}

const store = new Map<string, Bucket>()

/** 定时清理过期桶，避免 Map 无限增长（每分钟执行一次） */
function pruneExpired() {
  const now = Date.now()
  for (const [k, v] of store) {
    if (now >= v.resetAt) store.delete(k)
  }
}

/**
 * 按 IP + 操作名为键进行速率限制。
 * @param max 窗口内允许的最大请求数
 * @param windowMs 时间窗口（毫秒），默认 60 秒
 * @returns 失败时抛出 HttpError(429)
 */
export function rateLimit(request: Request, action: string, max: number, windowMs = 60_000): void {
  // X-Forwarded-For 或 CF-Connecting-IP 优先级高于原始 IP（Worker 场景）
  const ip =
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
    'unknown'

  const key = `${ip}:${action}`
  const now = Date.now()

  if (Math.random() < 0.01) pruneExpired()

  const existing = store.get(key)
  if (!existing || now >= existing.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs })
    return
  }

  existing.count++
  if (existing.count > max) {
    throw new HttpError(429, '操作过于频繁，请稍后再试')
  }
}
