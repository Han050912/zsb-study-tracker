import type { Env } from '../index'

/**
 * GitHub API 统一请求封装（release / feedback 等所有 GitHub 调用均经由此模块）
 *
 * - 服务端统一携带 GITHUB_TOKEN（PAT）发起请求，客户端绝不接触令牌
 * - 限额监控：认证额度 5000 次/小时按 token 计费，为全站所有 GitHub 调用共享。
 *   每次响应自动读取 X-RateLimit-Remaining，剩余低于阈值时打 warn 日志
 *   （Cloudflare observability 可检索），提前暴露额度耗尽风险
 * - 统一超时控制（AbortController）；任何失败均不抛异常，由调用方按需静默降级
 */

/** 限额告警阈值：剩余额度低于总额度该比例时 warn */
const RATE_LIMIT_WARN_RATIO = 0.1

/** 默认超时：略高于 Worker 子请求常见耗时 */
const DEFAULT_TIMEOUT_MS = 8000

export interface GithubResult<T> {
  /** 是否 2xx 成功 */
  ok: boolean
  /** HTTP 状态码；token 缺失 / 超时 / 网络异常时为 0 */
  status: number
  /** 是否因 GitHub 速率限制失败（429，或 403 且 remaining=0） */
  rateLimited: boolean
  /** 环境变量未配置 GITHUB_TOKEN */
  tokenMissing: boolean
  /** 2xx 时解析出的响应体，其余情况为 null */
  data: T | null
}

/**
 * 发起带认证的 GitHub API 请求。
 * @param path 以 `/` 开头的 API 路径，如 `/repos/xxx/yyy/releases/latest`
 */
export async function githubFetch<T = unknown>(
  env: Env,
  path: string,
  init: { method?: string; body?: string; timeoutMs?: number } = {}
): Promise<GithubResult<T>> {
  const token = env.GITHUB_TOKEN
  if (!token) {
    return { ok: false, status: 0, rateLimited: false, tokenMissing: true, data: null }
  }

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), init.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  try {
    const res = await fetch(`https://api.github.com${path}`, {
      method: init.method ?? 'GET',
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${token}`,
        'User-Agent': 'zsb-study-api-worker'
      },
      body: init.body,
      signal: ctrl.signal
    })

    // 限额监控（GitHub REST v3 每个响应都会返回这三个头）
    const remaining = Number(res.headers.get('X-RateLimit-Remaining'))
    const limit = Number(res.headers.get('X-RateLimit-Limit'))
    const resetAt = Number(res.headers.get('X-RateLimit-Reset')) * 1000
    if (Number.isFinite(remaining) && Number.isFinite(limit) && limit > 0
      && remaining <= limit * RATE_LIMIT_WARN_RATIO) {
      const resetText = Number.isFinite(resetAt)
        ? `约 ${Math.max(0, Math.round((resetAt - Date.now()) / 60000))} 分钟后重置`
        : '重置时间未知'
      console.warn(`[github] 额度告急：剩余 ${remaining}/${limit}（${resetText}），全站共享此 token 额度`)
    }

    // 限流判定：主限流 403 + remaining=0；二级限流 429
    const rateLimited = res.status === 429 || (res.status === 403 && remaining === 0)

    if (!res.ok) {
      if (res.body) await res.body.cancel().catch(() => {})
      return { ok: false, status: res.status, rateLimited, tokenMissing: false, data: null }
    }
    const data = await res.json() as T
    return { ok: true, status: res.status, rateLimited: false, tokenMissing: false, data }
  } catch (e) {
    // AbortError 为超时，其余为网络异常；均按失败降级，不向上抛
    console.error(`[github] fetch ${path} 异常:`, e instanceof Error ? e.message : e)
    return { ok: false, status: 0, rateLimited: false, tokenMissing: false, data: null }
  } finally {
    clearTimeout(timer)
  }
}
