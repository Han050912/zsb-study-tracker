import type { Ctx } from '../router'
import type { Env } from '../index'
import { HttpError } from '../db'

/**
 * 速率限制：基于 Cloudflare Workers 内置 Rate Limiting binding（2025-09 GA，wrangler.toml [[ratelimits]]）。
 * 计数跨实例共享（按 colo，宽松最终一致），是限流主防线；全局洪水防护依赖 WAF 层（现状未部署，见 docs/waf-rate-limiting.md）。
 * 局限：binding period 仅支持 10/60 秒；计数按 key 分 colo，非全局精确。
 */

/** 限值档位：与 wrangler.toml 的 8 个 [[ratelimits]] 绑定一一对应 */
export type RateLimitTier = 3 | 5 | 10 | 20 | 30 | 60 | 100 | 120

/** 限值档位 → 绑定名 */
const TIER_BINDINGS: Record<RateLimitTier, keyof Env> = {
  3: 'RL_3',
  5: 'RL_5',
  10: 'RL_10',
  20: 'RL_20',
  30: 'RL_30',
  60: 'RL_60',
  100: 'RL_100',
  120: 'RL_120'
}

/**
 * 按 IP + 操作名进行速率限制：超限抛 HttpError(429)，计数由 binding 跨实例共享。
 * 绑定字段缺失时 fail-open（记日志后放行）：限流失效好过请求全挂，auth 仍有 Turnstile 兜底；
 * binding 调用本身出错则上抛，由全局 catch 统一处理（500），不静默掩盖。
 */
export async function rateLimit(ctx: Ctx, action: string, max: RateLimitTier): Promise<void> {
  const ip =
    ctx.request.headers.get('CF-Connecting-IP') ||
    ctx.request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
    'unknown'
  const key = `${ip}:${action}`

  const binding = ctx.env[TIER_BINDINGS[max]] as RateLimit | undefined
  if (!binding) {
    console.error(`[rateLimit] 绑定 ${TIER_BINDINGS[max]} 缺失，限流未生效（fail-open）`)
    return
  }
  const { success } = await binding.limit({ key })
  if (!success) throw new HttpError(429, '操作过于频繁，请稍后再试')
}
