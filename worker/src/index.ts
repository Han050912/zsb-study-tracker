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
import { HttpError } from './db'

export interface Env {
  DB: D1Database
  JWT_SECRET: string
}

/** CORS 允许的来源：本地开发、生产站点、Electron 自定义协议 */
const ALLOWED_ORIGINS = new Set([
  'https://zsb-study-tracker.sryze.cc',
  'app://localhost'
])

function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false
  if (ALLOWED_ORIGINS.has(origin)) return true
  // 本地开发任意端口（vite dev / preview / wrangler pages dev）
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
}

function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin'
  }
  if (isAllowedOrigin(origin)) headers['Access-Control-Allow-Origin'] = origin!
  return headers
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const origin = request.headers.get('Origin')
    const cors = corsHeaders(origin)

    // OPTIONS 预检：统一在此处理，不进入路由
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors })
    }

    try {
      const res = await route(request, env)
      for (const [k, v] of Object.entries(cors)) res.headers.set(k, v)
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
