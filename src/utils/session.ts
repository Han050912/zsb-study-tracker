/**
 * 会话与桌面端认证头的唯一实现处。
 *
 * 说明：X-Desktop-Token 必须“无条件”发送（即使编译期注入为空串），
 * 这是 Worker 侧跳过 Turnstile 的既有契约（worker/src/api/auth.ts 与 worker/src/cors.ts）。
 */
export const TOKEN_KEY = 'jwt_token'
export const SESSION_FLAG = 'auth_logged_in'

/**
 * 本标签页内存中的登录态。
 * localStorage 的登录标记跨标签页共享、且会被其它标签页删除，不能代表「本标签页是否仍持有会话」；
 * 而 401 处理（该不该清会话跳登录页）与多标签页登出同步都需要这个信息，故单独记账。
 */
let memorySession = false

/** 桌面端从 localStorage 取 JWT（Web 端不落地 token） */
export function getToken(): string | null {
  return __DESKTOP_BUILD__ ? localStorage.getItem(TOKEN_KEY) : null
}

/** 是否存在持久化会话凭据（桌面端看 token，Web 端看登录标记） */
export function hasSession(): boolean {
  return __DESKTOP_BUILD__ ? !!localStorage.getItem(TOKEN_KEY) : localStorage.getItem(SESSION_FLAG) === '1'
}

/** 本标签页是否仍持有登录态：内存登录态或持久化凭据任一存在 */
export function hasActiveSession(): boolean {
  return memorySession || hasSession()
}

/** 标记本标签页已建立会话（登录 / 注册 / 会话恢复成功时调用） */
export function markSessionActive(): void {
  memorySession = true
}

/** 清空会话：内存登录态 + 持久化凭据（登出、会话过期时调用） */
export function clearSession(): void {
  memorySession = false
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(SESSION_FLAG)
}

/** 桌面端认证头；Web 端返回空对象（Web 走 cookie，见各调用点的 credentials） */
export function desktopAuthHeaders(): Record<string, string> {
  if (!__DESKTOP_BUILD__) return {}
  const headers: Record<string, string> = { 'X-Desktop-Token': __DESKTOP_TOKEN__ }
  const token = getToken()
  if (token) headers['Authorization'] = `Bearer ${token}`
  return headers
}
