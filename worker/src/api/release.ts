import { on } from '../router'
import { githubFetch } from './github'
import { hasReleaseBody, normalizeReleaseTag } from '../releaseCache'
import { rateLimit } from '../middleware/rateLimit'

/**
 * GET /api/latest-release
 *
 * 中转 GitHub Releases API，规避国内网络访问 api.github.com 的限流与不稳定问题。
 * 从 Worker 环境变量 GITHUB_TOKEN 读取 PAT 发起服务端请求，绝不下发令牌到客户端。
 *
 * 内存缓存：Release 数据变动频率极低，缓存 10 分钟可极大降低对共享 token
 * 额度（认证 5000 次/小时，全站共享）的消耗；仅缓存已有正文的 Release，避免草稿发布窗口
 * 的空正文被保留；GitHub 侧失败时降级用过期缓存兜底。
 *
 * 成功：{ success: true, data: <GitHub Release 完整 JSON> }
 * 失败：{ success: false }
 *
 * 信封例外：全站成功信封统一为 { ok: true }，唯独本端点保留 { success } ——
 * 桌面端 electron/main.cjs 的 fetchReleaseNotes 直接读取 json.success，
 * 已安装的旧客户端无法回溯更新，改信封即破坏其更新说明拉取。
 */

/** 缓存有效期（毫秒） */
const CACHE_TTL_MS = 10 * 60 * 1000

interface ReleaseCache {
  data: unknown
  expiresAt: number
}

/** 挂在 globalThis 上：Cloudflare Worker 同一 isolate 的多次请求间复用 */
const cacheStore = globalThis as typeof globalThis & {
  __releaseCaches?: Record<string, ReleaseCache>
}

export function registerReleaseRoutes() {
  on('GET', '/api/latest-release', false, async (ctx) => {
    // This endpoint is public but consumes the shared server-side GitHub token.
    // Limit unauthenticated callers before any cache miss can spend API quota.
    await rateLimit(ctx, 'latest-release', 30)
    const requestedVersion = new URL(ctx.request.url).searchParams.get('version')
    if (requestedVersion && !normalizeReleaseTag(requestedVersion)) {
      return Response.json({ success: false }, { status: 400 })
    }
    const releaseTag = requestedVersion ? normalizeReleaseTag(requestedVersion) : null
    const cacheKey = releaseTag ? `tag:${releaseTag}` : 'latest'
    const cached = cacheStore.__releaseCaches?.[cacheKey]
    // Ignore legacy/partial cache entries created while the GitHub release
    // body was still empty; they must not mask a later populated release.
    if (cached && Date.now() < cached.expiresAt && hasReleaseBody(cached.data)) {
      return Response.json({ success: true, data: cached.data })
    }

    const releasePath = releaseTag
      ? `/repos/Han050912/zsb-study-tracker/releases/tags/${encodeURIComponent(releaseTag)}`
      : '/repos/Han050912/zsb-study-tracker/releases/latest'
    const result = await githubFetch<Record<string, unknown>>(ctx.env, releasePath)
    if (result.tokenMissing) {
      console.error('[latest-release] GITHUB_TOKEN 环境变量未配置')
      return Response.json({ success: false }, { status: 500 })
    }
    if (!result.ok || !result.data) {
      console.error(`[latest-release] GitHub API status: ${result.status}${result.rateLimited ? '（速率限制）' : ''}`)
      // 请求失败（含限流）时降级用过期缓存兜底，旧数据好过没有
      if (cached && hasReleaseBody(cached.data)) return Response.json({ success: true, data: cached.data })
      return Response.json({ success: false })
    }

    // Do not cache an empty body: release assets can become visible before
    // the release description is written, and a later request should retry.
    if (hasReleaseBody(result.data)) {
      const caches = (cacheStore.__releaseCaches ??= {})
      caches[cacheKey] = { data: result.data, expiresAt: Date.now() + CACHE_TTL_MS }
    }
    return Response.json({ success: true, data: result.data })
  })
}
