/**
 * 统一 fetch 封装：所有请求经 Cloudflare Worker，携带 Bearer JWT。
 * 401 时清除 token 并跳转登录页——但登录/注册接口除外：这两类公开端点的 401
 * 表示凭证错误（账号不存在或密码错误），透传服务端消息给调用方展示。
 */
export const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8787'

/** 公开凭证端点：其 401 不属于「会话过期」，不做全局登出处理 */
const CREDENTIAL_PATHS = ['/api/auth/login', '/api/auth/register']

function getToken(): string | null {
  return localStorage.getItem('jwt_token')
}

/** 401 全局处理：清除 token、通知清空内存数据、跳转登录页（导出供 XHR 上传等非 fetch 通道复用）。
 *  「会话过期」仅适用于曾登录的用户（持有 token）；访客（无 token）的 401 是「未登录」的预期响应，
 *  不做全局登出/跳转，仅抛错交由调用方组件自行引导登录。 */
export function handleUnauthorized(): never {
  const hadToken = getToken()
  if (hadToken) {
    localStorage.removeItem('jwt_token')
    // 通知应用清空内存中的用户数据（防止 401 后串号到下一个账号）
    window.dispatchEvent(new CustomEvent('auth:expired'))
    window.location.hash = '#/login'
  }
  // 曾持有 token（会话过期）与访客（未登录）的 401 语义不同，提示语区分，避免误导
  throw Object.assign(new Error(hadToken ? '登录已过期，请重新登录' : '请先登录'), { status: 401 })
}

export async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const res = await authFetch(path, options, { 'Content-Type': 'application/json' })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: '请求失败' }))
    throw Object.assign(new Error(err.message || `HTTP ${res.status}`), { status: res.status })
  }
  return res.json()
}

/**
 * 携带认证头的原始 fetch：返回 Response 本身，供二进制上传/下载等非 JSON 场景使用。
 * 调用方自行检查 res.ok 并解析响应体；401 与 request() 走同一全局处理。
 */
export async function authFetch(
  path: string,
  options: RequestInit = {},
  baseHeaders: Record<string, string> = {}
): Promise<Response> {
  const token = getToken()
  const headers: Record<string, string> = {
    ...baseHeaders,
    ...(options.headers as Record<string, string> || {})
  }
  if (token) headers['Authorization'] = `Bearer ${token}`
  // 桌面端附加认证令牌，Worker 校验以跳过 Turnstile（Web 构建此分支整体 tree-shake）
  if (__DESKTOP_BUILD__) headers['X-Desktop-Token'] = __DESKTOP_TOKEN__

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers })
  if (res.status === 401 && !CREDENTIAL_PATHS.includes(path)) handleUnauthorized()
  return res
}

/** Chrome keepalive 请求体上限（Firefox 更大，此处取 Chrome 保守值） */
const KEEPALIVE_MAX_BYTES = 60_000

/**
 * 页面卸载（beforeunload）时的兜底推送：keepalive 让请求在页面关闭后继续完成。
 * 仅用于全量同步保存，不读取响应。
 * 超过 ~60KB 的载荷在 Chrome 中 keepalive 会静默失败，打印警告以便排查。
 */
export function requestKeepalive(path: string, body: unknown): void {
  const token = getToken()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  const payload = JSON.stringify(body)
  if (payload.length > KEEPALIVE_MAX_BYTES) {
    console.warn(`keepalive 推送载荷 ${(payload.length / 1024).toFixed(1)}KB 超过安全上限，本次兜底推送将跳过（日常推送不走此路径，不影响数据完整性）`)
    return
  }
  fetch(`${API_BASE}${path}`, {
    method: 'POST', headers, body: payload, keepalive: true
  }).catch(() => { /* 卸载兜底，失败无法重试 */ })
}
