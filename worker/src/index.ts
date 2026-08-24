import { route } from './router'
import { registerAuthRoutes } from './api/auth'
import { registerSyncRoutes } from './api/sync'
import { registerSubjectRoutes } from './api/subjects'
import { registerRecordRoutes } from './api/records'
import { registerProblemRoutes } from './api/problems'
import { registerErrorRoutes } from './api/errors'
import { registerExamRoutes } from './api/exams'
import { registerNoteRoutes } from './api/notes'
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
import { registerPartnerRoutes } from './api/partners'
import { registerAdminRoutes } from './api/admin'
import { registerLearningPathRoutes } from './api/learningPath'
import { registerPdfRoutes } from './api/pdfs'
import { registerUploadRoutes } from './api/uploads'
import { registerFeedbackRoutes } from './api/feedback'
import './api/teams'
import { HttpError } from './db'
import { canCache, getCached, putCache } from './middleware/cache'
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
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const origin = request.headers.get('Origin')
    const cors = corsHeaders(origin)

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

      return res
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500
      // 内部错误细节仅记录日志，不外泄给客户端
      const message = e instanceof HttpError ? e.message : '服务器内部错误'
      if (status === 500) console.error(e)
      return Response.json({ message }, { status, headers: cors })
    }
  }
}

registerAuthRoutes()
registerSyncRoutes()
registerSubjectRoutes()
registerRecordRoutes()
registerProblemRoutes()
registerErrorRoutes()
registerExamRoutes()
registerNoteRoutes()
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
registerAdminRoutes()
registerLearningPathRoutes()
registerPdfRoutes()
registerUploadRoutes()
registerFeedbackRoutes()
