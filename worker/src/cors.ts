/** CORS 允许的来源：本地开发、生产站点、Electron 自定义协议 */
export const ALLOWED_ORIGINS = new Set([
  'https://zsb-study-tracker.sryze.cc',
  'https://zsb-study-tracker.pages.dev',
  'https://han050912.github.io',
  'app://localhost'
])

export function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false
  if (ALLOWED_ORIGINS.has(origin)) return true
  // 本地开发任意端口（vite dev / preview / wrangler pages dev）
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
}

export function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-CF-Turnstile-Response, X-Desktop-Token',
    'Access-Control-Max-Age': '86400',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin'
  }
  if (isAllowedOrigin(origin)) {
    headers['Access-Control-Allow-Origin'] = origin!
    headers['Access-Control-Allow-Credentials'] = 'true'
    headers['Vary'] = 'Origin'
  }
  return headers
}
