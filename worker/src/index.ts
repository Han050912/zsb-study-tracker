import { route } from './router'
import { registerAuthRoutes } from './api/auth'
import { registerSyncRoutes } from './api/sync'
import { registerSubjectRoutes } from './api/subjects'
import { registerRecordRoutes } from './api/records'
import { registerProblemRoutes } from './api/problems'
import { registerErrorRoutes } from './api/errors'
import { registerErrorImageRoutes } from './api/errorImages'
import { registerExamRoutes } from './api/exams'
import { registerNoteRoutes } from './api/notes'
import { registerNoteBodyRoutes } from './api/noteBodies'
import { registerVocabRoutes } from './api/vocab'
import { registerEnglishRoutes } from './api/english'
import { registerSummaryRoutes } from './api/summaries'
import { registerHabitRoutes } from './api/habits'
import { registerMaterialRoutes } from './api/materials'
import { registerGamificationRoutes } from './api/gamification'
import { registerPomodoroRoutes } from './api/pomodoro'
import { registerTodoRoutes } from './api/todos'
import { registerSettingsRoutes } from './api/settings'
import { registerMaimemoRoutes } from './proxy/maimemo'
import { registerWallpaperRoutes } from './proxy/wallpaper'
import { registerReleaseRoutes } from './api/release'
import { registerCommunityRoutes } from './api/community'
import { registerPartnerRoutes, pushWeeklyReports } from './api/partners'
import { registerPartnerShareRoutes } from './api/partnerShares'
import { registerPartnerCollabRoutes } from './api/partnerCollab'
import { registerAdminRoutes } from './api/admin'
import { registerLearningPathRoutes } from './api/learningPath'
import { registerPdfRoutes } from './api/pdfs'
import { registerUploadRoutes, cleanupOrphanUploads } from './api/uploads'
import { registerFeedbackRoutes } from './api/feedback'
import './api/teams'
import { HttpError } from './db'
import { canCache, getCached, purgeUserCache, putCache } from './middleware/cache'
import { corsHeaders } from './cors'

export interface Env {
  DB: D1Database
  IMAGES: R2Bucket
  JWT_SECRET: string
  TURNSTILE_SECRET: string
  GITHUB_TOKEN?: string
  /** Workers AI 调用令牌（Cloudflare Secrets / .dev.vars，不落地仓库） */
  CF_API_TOKEN?: string
  /** Cloudflare 账户 ID（非敏感，见 wrangler.toml 顶部 account_id） */
  CF_ACCOUNT_ID?: string
  /** 桌面端共享令牌（Cloudflare Secrets / .dev.vars，不落地仓库）：
   *  与桌面端构建时注入的 DESKTOP_TOKEN 一致，用于识别可信桌面客户端跳过 Turnstile */
  DESKTOP_TOKEN?: string
  /** 敏感字段加密密钥（Cloudflare Secrets，不落地仓库）：独立于 JWT_SECRET，轮换 JWT_SECRET 不再作废已存 Token；
   *  未配置时回退 JWT_SECRET 派生（兼容现网）；生产：npx wrangler secret put ENCRYPT_SECRET */
  ENCRYPT_SECRET?: string
  /** Workers 内置速率限制绑定（wrangler.toml [[ratelimits]]，按限值档位划分） */
  RL_3: RateLimit
  RL_5: RateLimit
  RL_10: RateLimit
  RL_20: RateLimit
  RL_30: RateLimit
  RL_60: RateLimit
  RL_100: RateLimit
  RL_120: RateLimit
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const origin = request.headers.get('Origin')
    const cors = corsHeaders(origin, new URL(request.url).host)

    // OPTIONS 预检：统一在此处理，不进入路由
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors })
    }

    try {
      // 高频只读 GET 请求走边缘缓存
      if (canCache(request)) {
        const cached = await getCached(request)
        if (cached) {
          // Cache API 返回的 Response headers 不可变，需先复制一份再写 CORS 头
          const res = new Response(cached.body, cached)
          for (const [k, v] of Object.entries(cors)) res.headers.set(k, v)
          return res
        }
      }

      const res = await route(request, env)
      for (const [k, v] of Object.entries(cors)) res.headers.set(k, v)

      // 缓存成功的 200 响应
      if (canCache(request) && res.status === 200) {
        putCache(request, res.clone(), ctx)
      }
      // 写操作成功后失效该用户的读缓存，避免写入后 TTL 内读到旧数据
      if (request.method !== 'GET' && res.status < 400) {
        purgeUserCache(request, ctx)
      }

      return res
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500
      // 内部错误细节仅记录日志，不外泄给客户端
      const message = e instanceof HttpError ? e.message : '服务器内部错误'
      if (status === 500) console.error(e)
      return Response.json({ message }, { status, headers: cors })
    }
  },

  /** 每周一 08:00（UTC+8）触发：周报推送与孤图清理 */
  async scheduled(controller: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    // 周报推送与孤图清理彼此独立：任一失败不影响另一个（各自 catch 留日志，避免 allSettled 静默吞掉错误）
    await Promise.allSettled([
      pushWeeklyReports(env).catch((e) => console.error('[cron] 周报推送失败', e)),
      cleanupOrphanUploads(env).catch((e) => console.error('[cron] 孤图清理失败', e))
    ])
  }
}

registerAuthRoutes()
registerSyncRoutes()
registerSubjectRoutes()
registerRecordRoutes()
registerProblemRoutes()
registerErrorRoutes()
registerErrorImageRoutes()
registerExamRoutes()
registerNoteRoutes()
registerNoteBodyRoutes()
registerVocabRoutes()
registerEnglishRoutes()
registerSummaryRoutes()
registerHabitRoutes()
registerMaterialRoutes()
registerGamificationRoutes()
registerPomodoroRoutes()
registerTodoRoutes()
registerSettingsRoutes()
registerMaimemoRoutes()
registerWallpaperRoutes()
registerReleaseRoutes()
registerCommunityRoutes()
registerPartnerRoutes()
registerPartnerShareRoutes()
registerPartnerCollabRoutes()
registerAdminRoutes()
registerLearningPathRoutes()
registerPdfRoutes()
registerUploadRoutes()
registerFeedbackRoutes()
