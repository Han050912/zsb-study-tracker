import { on } from '../router'
import { githubFetch } from './github'

/**
 * GET /api/latest-release
 *
 * 中转 GitHub Releases API，规避国内网络访问 api.github.com 的限流与不稳定问题。
 * 从 Worker 环境变量 GITHUB_TOKEN 读取 PAT 发起服务端请求，绝不下发令牌到客户端。
 *
 * 内存缓存：Release 数据变动频率极低，缓存 10 分钟可极大降低对共享 token
 * 额度（认证 5000 次/小时，全站共享）的消耗；GitHub 侧失败时降级用过期缓存兜底。
 *
 * 成功：{ success: true, data: <GitHub Release 完整 JSON> }
 * 失败：{ success: false }
 */

/** 缓存有效期（毫秒） */
const CACHE_TTL_MS = 10 * 60 * 1000

interface ReleaseCache {
  data: unknown
  expiresAt: number
}

/** 挂在 globalThis 上：Cloudflare Worker 同一 isolate 的多次请求间复用 */
const cacheStore = globalThis as typeof globalThis & { __latestReleaseCache?: ReleaseCache }

export function registerReleaseRoutes() {
  on('GET', '/api/latest-release', false, async (ctx) => {
    const cached = cacheStore.__latestReleaseCache
    if (cached && Date.now() < cached.expiresAt) {
      return Response.json({ success: true, data: cached.data })
    }

    const result = await githubFetch<Record<string, unknown>>(ctx.env,
      '/repos/Han050912/zsb-study-tracker/releases/latest')
    if (result.tokenMissing) {
      console.error('[latest-release] GITHUB_TOKEN 环境变量未配置')
      return Response.json({ success: false }, { status: 500 })
    }
    if (!result.ok || !result.data) {
      console.error(`[latest-release] GitHub API status: ${result.status}${result.rateLimited ? '（速率限制）' : ''}`)
      // 请求失败（含限流）时降级用过期缓存兜底，旧数据好过没有
      if (cached) return Response.json({ success: true, data: cached.data })
      return Response.json({ success: false })
    }

    cacheStore.__latestReleaseCache = { data: result.data, expiresAt: Date.now() + CACHE_TTL_MS }
    return Response.json({ success: true, data: result.data })
  })
}
