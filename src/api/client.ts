/**
 * 统一 fetch 封装：所有请求经 Cloudflare Worker。
 * - Web 端：会话存 HttpOnly Cookie（SameSite=None），请求带 credentials: 'include'，不接触明文 token
 * - 桌面端（Electron）：会话存 localStorage，请求带 Authorization Bearer + X-Desktop-Token
 * 401 时清除会话并跳转登录页——但登录/注册接口除外：这两类公开端点的 401
 * 表示凭证错误（账号不存在或密码错误），透传服务端消息给调用方展示。
 */
import { TOKEN_KEY, SESSION_FLAG, hasSession, desktopAuthHeaders } from '../utils/session'

export const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8787'

/** 带状态码的 API 错误：统一替代 `Object.assign(new Error(...), { status })` 样板 */
export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

/** 公开凭证端点：其 401 不属于「会话过期」，不做全局登出处理 */
const CREDENTIAL_PATHS = ['/api/auth/login', '/api/auth/register']

const isDesktop = __DESKTOP_BUILD__

/** 401 全局处理：清除会话、通知清空内存数据、跳转登录页（导出供 XHR 上传等非 fetch 通道复用）。 */
export function handleUnauthorized(): never {
  const had = hasSession()
  if (had) {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(SESSION_FLAG)
    // 通知应用清空内存中的用户数据（防止 401 后串号到下一个账号）
    window.dispatchEvent(new CustomEvent('auth:expired'))
    window.location.hash = '#/login'
  }
  // 曾登录（会话过期）与访客（未登录）的 401 语义不同，提示语区分，避免误导
  throw new ApiError(had ? '登录已过期，请重新登录' : '请先登录', 401)
}

export async function request<T>(
  path: string,
  options: RequestInit = {},
  timeoutMs?: number
): Promise<T> {
  const res = await authFetch(path, options, { 'Content-Type': 'application/json' }, timeoutMs)
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: '请求失败' }))
    throw new ApiError(err.message || `HTTP ${res.status}`, res.status)
  }
  return res.json()
}

/**
 * 携带认证凭据的原始 fetch：返回 Response 本身，供二进制上传/下载等非 JSON 场景使用。
 * 调用方自行检查 res.ok 并解析响应体；401 与 request() 走同一全局处理。
 */
export async function authFetch(
  path: string,
  options: RequestInit = {},
  baseHeaders: Record<string, string> = {},
  /** 默认 30s 超时，防止弱网下请求永久挂起；下载大文件等慢请求由调用方传更大的 timeoutMs */
  timeoutMs = 30_000
): Promise<Response> {
  const headers: Record<string, string> = {
    ...baseHeaders,
    ...((options.headers as Record<string, string>) || {})
  }
  // 桌面端附加认证头（X-Desktop-Token 无条件发送；Authorization 仅在 token 存在时）
  Object.assign(headers, desktopAuthHeaders())
  // 调用方未指定 signal 时启用超时中断（下载大文件等慢请求由调用方传更大的 timeoutMs）
  const signal = options.signal ?? AbortSignal.timeout(timeoutMs)
  let res: Response
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
      signal,
      ...(isDesktop ? {} : { credentials: 'include' })
    })
  } catch (e) {
    // 默认超时中断触发时 fetch 以英文 DOMException reject，本地化为 ApiError 供 toast 展示；
    // 调用方自传 signal 的中止由调用方负责，不拦截
    if (!options.signal && e instanceof DOMException && e.name === 'TimeoutError') {
      throw new ApiError('请求超时，请重试', 408)
    }
    throw e
  }
  if (res.status === 401 && !CREDENTIAL_PATHS.includes(path)) handleUnauthorized()
  return res
}

/** Chrome keepalive 请求体上限（Firefox 更大，此处取 Chrome 保守值） */
const KEEPALIVE_MAX_BYTES = 60_000

/**
 * 页面卸载（beforeunload）时的兜底推送：keepalive 让请求在页面关闭后继续完成。
 * 当前用于按域同步的卸载兜底（单域载荷小，不会触发 keepalive 体积上限），不读取响应。
 */
export function requestKeepalive(path: string, body: unknown, method: 'POST' | 'PUT' = 'POST'): void {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  Object.assign(headers, desktopAuthHeaders())
  const payload = JSON.stringify(body)
  if (payload.length > KEEPALIVE_MAX_BYTES) {
    console.warn(
      `keepalive 推送载荷 ${(payload.length / 1024).toFixed(1)}KB 超过安全上限，本次兜底推送将跳过（日常推送不走此路径，不影响数据完整性）`
    )
    return
  }
  fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: payload,
    keepalive: true,
    ...(isDesktop ? {} : { credentials: 'include' })
  }).catch(() => {
    /* 卸载兜底，失败无法重试 */
  })
}
