/**
 * 会话与桌面端认证头的唯一实现处。
 *
 * 说明：X-Desktop-Token 必须“无条件”发送（即使编译期注入为空串），
 * 这是 Worker 侧跳过 Turnstile 的既有契约（worker/src/api/auth.ts 与 worker/src/cors.ts）。
 */
export const TOKEN_KEY = 'jwt_token'
export const SESSION_FLAG = 'auth_logged_in'

/** 桌面端从 localStorage 取 JWT（Web 端不落地 token） */
export function getToken(): string | null {
  return __DESKTOP_BUILD__ ? localStorage.getItem(TOKEN_KEY) : null
}

/** 是否存在本地会话（桌面端看 token，Web 端看会话标记） */
export function hasSession(): boolean {
  return __DESKTOP_BUILD__ ? !!localStorage.getItem(TOKEN_KEY) : localStorage.getItem(SESSION_FLAG) === '1'
}

/** 桌面端认证头；Web 端返回空对象（Web 走 cookie，见各调用点的 credentials） */
export function desktopAuthHeaders(): Record<string, string> {
  if (!__DESKTOP_BUILD__) return {}
  const headers: Record<string, string> = { 'X-Desktop-Token': __DESKTOP_TOKEN__ }
  const token = getToken()
  if (token) headers['Authorization'] = `Bearer ${token}`
  return headers
}
