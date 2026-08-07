import { on } from '../router'

/**
 * GET /api/latest-release
 *
 * 中转 GitHub Releases API，规避国内网络访问 api.github.com 的限流与不稳定问题。
 * 从 Worker 环境变量 GITHUB_TOKEN 读取 PAT 发起服务端请求，绝不下发令牌到客户端。
 *
 * 成功：{ success: true, data: <GitHub Release 完整 JSON> }
 * 失败：{ success: false }
 */
export function registerReleaseRoutes() {
  on('GET', '/api/latest-release', false, async (ctx) => {
    const token = ctx.env.GITHUB_TOKEN
    if (!token) {
      console.error('[latest-release] GITHUB_TOKEN 环境变量未配置')
      return Response.json({ success: false }, { status: 500 })
    }

    const url = 'https://api.github.com/repos/Han050912/zsb-study-tracker/releases/latest'

    try {
      const res = await fetch(url, {
        headers: {
          'Accept': 'application/vnd.github+json',
          'Authorization': `Bearer ${token}`,
          'User-Agent': 'zsb-study-api-worker'
        }
      })

      if (!res.ok) {
        console.error(`[latest-release] GitHub API status: ${res.status}`)
        return Response.json({ success: false })
      }

      const release = await res.json()
      return Response.json({ success: true, data: release })
    } catch (err) {
      console.error('[latest-release] fetch error:', err)
      return Response.json({ success: false })
    }
  })
}
