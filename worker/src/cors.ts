/** CORS 允许的来源：本地开发、生产站点、Electron 自定义协议 */
export const ALLOWED_ORIGINS = new Set([
  'https://zsb-study-tracker.sryze.cc',
  'https://zsb-study-tracker.pages.dev',
  'https://han050912.github.io',
  'app://localhost'
])

/** 本地开发请求主机判定：wrangler dev / wrangler pages dev / electron dev 的请求 URL host。
 *  注意：wrangler.toml 声明生产 routes 后，wrangler dev 会把 request.url 的 host 改写为生产域名，
 *  此时本判定恒为 false，需配合 env.ALLOW_LOCAL_ORIGINS 显式开关（见 index.ts） */
export function isLocalHost(host: string | undefined): boolean {
  return !!host && /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)
}

export function isAllowedOrigin(origin: string | null, allowLocal: boolean): boolean {
  if (!origin) return false
  if (ALLOWED_ORIGINS.has(origin)) return true
  // 本地开发任意端口（vite dev / preview / wrangler pages dev）：仅当显式允许本机来源时放行，
  // 生产域名不接受本机来源的带凭据跨站请求（allowLocal 在生产恒为 false）
  return allowLocal && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
}

export function corsHeaders(origin: string | null, allowLocal: boolean): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-CF-Turnstile-Response, X-Desktop-Token',
    'Access-Control-Max-Age': '86400',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin'
  }
  if (isAllowedOrigin(origin, allowLocal)) {
    headers['Access-Control-Allow-Origin'] = origin!
    headers['Access-Control-Allow-Credentials'] = 'true'
    headers['Vary'] = 'Origin'
  }
  return headers
}
