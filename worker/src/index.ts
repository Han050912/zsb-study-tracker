import { route } from './router'
import { registerAuthRoutes, cleanupExpiredTokens } from './api/auth'
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
import { registerPartnerCollabRoutes, cleanupStaleSessions } from './api/partnerCollab'
import { registerAdminRoutes } from './api/admin'
import { registerLearningPathRoutes } from './api/learningPath'
import { registerPdfRoutes } from './api/pdfs'
import { registerUploadRoutes, cleanupOrphanUploads } from './api/uploads'
import { registerFeedbackRoutes } from './api/feedback'
import { registerTeamRoutes } from './api/teams'
import { HttpError, isConstraintError } from './db'
import { canCache, canCachePublic, getCached, purgeUserCache, putCache } from './middleware/cache'
import { corsHeaders, isLocalHost } from './cors'

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
  /** 本地开发 CORS 放行开关：仅在 worker/.dev.vars 中设置 '1'（生产环境禁止配置）。
   *  wrangler dev 在声明生产 routes 后会把 request.url 的 host 改写为生产域名，
   *  导致 isLocalHost 判定失效，本地 vite 前端来源被 CORS 拒绝；此开关显式放行本机来源 */
  ALLOW_LOCAL_ORIGINS?: string
  /** cron 任务失败告警 webhook（可选，不配=仅 console.error 日志）：
   *  任一 scheduled 子任务 rejected 时 POST 失败摘要。
   *  消息体为 `{ "text": "..." }`（Slack incoming webhook 兼容格式；
   *  飞书/企业微信需各自的包装格式，配置前请确认你的 webhook 端接受该形状） */
  ALERT_WEBHOOK?: string
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const origin = request.headers.get('Origin')
    const allowLocal = isLocalHost(new URL(request.url).host) || env.ALLOW_LOCAL_ORIGINS === '1'
    const cors = corsHeaders(origin, allowLocal)

    // OPTIONS 预检：统一在此处理，不进入路由
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors })
    }

    try {
      // 高频只读 GET 请求走边缘缓存（私有前缀按用户隔离，公开图片/头像全站共享）
      if (canCache(request) || canCachePublic(request)) {
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
      if ((canCache(request) || canCachePublic(request)) && res.status === 200) {
        putCache(request, res.clone(), ctx)
      }
      // 写操作成功后失效该用户的读缓存，避免写入后 TTL 内读到旧数据
      if (request.method !== 'GET' && res.status < 400) {
        purgeUserCache(request, ctx)
      }

      return res
    } catch (e) {
      // P4-06：SQLite 约束类错误（UNIQUE/FOREIGN KEY/...）源于客户端输入违反数据完整性，
      // 统一映射为 400 提示自查输入，避免被当成服务端故障（500）无限重试。
      // 500（含散落的 HttpError(500)）统一对外文案「服务器内部错误」，不泄露内部语义（如域序号分配）；
      // 原始错误细节仅写入日志供诊断。
      const constraint = isConstraintError(e)
      const status = e instanceof HttpError ? e.status : constraint ? 400 : 500
      const message =
        e instanceof HttpError && e.status !== 500
          ? e.message
          : constraint
            ? '数据与现有记录冲突，请检查输入后重试'
            : '服务器内部错误'
      if (status === 500) console.error(e)
      return Response.json({ message }, { status, headers: cors })
    }
  },

  /** 定时触发：周报推送、孤图清理、黑名单过期清理与僵尸开黑会话回收 */
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    // 各项任务彼此独立：allSettled 保证任一失败不影响其他；rejected 结果在此统一 console.error 留日志，
    // 且配置 ALERT_WEBHOOK 时聚合发送 webhook 告警（不配置 = 仅日志，行为同现状）
    const tasks: [string, Promise<unknown>][] = [
      ['周报推送', pushWeeklyReports(env)],
      ['孤图清理', cleanupOrphanUploads(env)],
      ['黑名单清理', cleanupExpiredTokens(env)],
      ['僵尸会话清理', cleanupStaleSessions(env)]
    ]
    const results = await Promise.allSettled(tasks.map(([, p]) => p))
    const failures: string[] = []
    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        const name = tasks[i][0]
        console.error(`[cron] ${name}失败`, r.reason)
        failures.push(`${name}: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`)
      }
    })
    if (failures.length && env.ALERT_WEBHOOK) {
      const text = `[zsb-study-api] cron 任务失败 ${failures.length}/${tasks.length}\n${failures.join('\n')}`
      ctx.waitUntil(
        fetch(env.ALERT_WEBHOOK, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text })
        })
          .then((r) => {
            if (!r.ok) console.error('[cron] 告警 webhook 返回非 2xx', r.status)
          })
          .catch((e) => console.error('[cron] webhook 告警发送失败', e))
      )
    }
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
registerTeamRoutes()
