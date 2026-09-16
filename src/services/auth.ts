import { ref, computed } from 'vue'
import { authApi } from '../api/auth'
import { expireSession } from '../api/client'
import {
  TOKEN_KEY,
  SESSION_FLAG,
  hasSession,
  hasActiveSession,
  clearSession,
  markSessionActive
} from '../utils/session'

/**
 * 认证服务：注册 / 登录 / 退出 / 会话持久化。
 * - 密码由 Worker 端 bcryptjs(cost=10) 哈希存储，前端不接触哈希细节
 * - Web 端：登录成功由服务端 Set-Cookie 下发 HttpOnly 会话（本地仅存非敏感登录标志）
 * - 桌面端：登录成功获得 HS256 JWT，存 localStorage 供 client.ts 携带
 */

const GUEST_FLAG = 'auth_guest_mode'
const isDesktop = __DESKTOP_BUILD__

export interface SessionUser {
  id: string
  username: string
  role: string
  createdAt: number
}

const currentUser = ref<SessionUser | null>(null)
// 访客浏览模式：仅能通过登录/注册页「先随便看看」入口开启，开启后才可浏览公开页（社区/组队）。
// 用 sessionStorage 存标志：刷新页面保持访客态，关闭浏览器会话即失效（下次需重新走入口）
const guestMode = ref(sessionStorage.getItem(GUEST_FLAG) === '1')

export const isLoggedIn = computed(() => currentUser.value !== null)
export const sessionUser = computed(() => currentUser.value)
export const isAdmin = computed(() => currentUser.value?.role === 'admin')
export const isGuestMode = computed(() => guestMode.value)

/** 进入访客浏览模式（仅登录/注册页「先随便看看」入口调用） */
export function enterGuestMode(): void {
  guestMode.value = true
  sessionStorage.setItem(GUEST_FLAG, '1')
}

/** 退出访客浏览模式（登录成功时调用；退出登录后由路由守卫统一回登录页） */
export function exitGuestMode(): void {
  guestMode.value = false
  sessionStorage.removeItem(GUEST_FLAG)
}

/** 建立/清空会话的唯一入口：同步 currentUser、内存登录态标记与持久化凭据（其余地方不要直接写 currentUser） */
function setSession(user: SessionUser | null, token?: string) {
  currentUser.value = user
  if (user) {
    if (isDesktop && token) localStorage.setItem(TOKEN_KEY, token)
    localStorage.setItem(SESSION_FLAG, '1')
    markSessionActive()
    exitGuestMode() // 建立登录会话即结束访客浏览
  } else {
    clearSession()
  }
}

/** 应用启动时恢复登录状态：有会话凭据则调用 /api/auth/me 验证并取回用户信息。
 *  仅 401（凭据失效）清除会话；网络故障保留凭据，下次启动重试。 */
export async function restoreSession(): Promise<SessionUser | null> {
  if (!hasSession()) return null
  try {
    const { user } = await authApi.me()
    // 复用 setSession：同步内存登录态标记（401 处理要用），并结束访客模式保持两者互斥
    setSession(user)
    return user
  } catch (e) {
    if ((e as { status?: number } | null)?.status === 401) setSession(null)
    return null
  }
}

/**
 * 注册 / 修改密码共用的密码强度校验，口径与服务端 `worker/src/schemas.ts` 的 passwordSchema 一致
 * （8-64 位且同时包含字母和数字）。返回首个错误文案，合法返回 null。
 */
export function passwordPolicyError(password: string): string | null {
  if (password.length < 8) return '密码至少 8 位'
  if (password.length > 64) return '密码最多 64 位'
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return '密码必须同时包含字母和数字'
  return null
}

// ---------- 注册 ----------
export async function register(username: string, password: string, cfTurnstileToken = ''): Promise<SessionUser> {
  username = username.trim()
  // 前置校验与 Worker 端口径一致，保证错误提示即时
  if (username.length < 2) throw new Error('用户名至少 2 个字符')
  if (username.length > 20) throw new Error('用户名最多 20 个字符')
  const policyError = passwordPolicyError(password)
  if (policyError) throw new Error(policyError)
  const { token, user } = await authApi.register(username, password, cfTurnstileToken)
  setSession(user, token)
  return user
}

// ---------- 登录 ----------
export async function login(username: string, password: string, cfTurnstileToken = ''): Promise<SessionUser> {
  username = username.trim()
  if (!username || !password) throw new Error('请输入用户名和密码')
  const { token, user } = await authApi.login(username, password, cfTurnstileToken)
  setSession(user, token)
  return user
}

// ---------- 修改密码 ----------
/**
 * 修改密码：校验当前密码 → 设置新密码（旧密码由服务端校验，错误时回 400）。
 * 服务端同时吊销该账号的全部旧 token（其它设备立即下线）并为本次会话换发新 token，
 * 故桌面端必须用新 token 覆盖本地凭据，否则本设备下一次请求即 401。
 */
export async function changePassword(oldPassword: string, newPassword: string, cfTurnstileToken = ''): Promise<void> {
  if (!oldPassword) throw new Error('请输入当前密码')
  const policyError = passwordPolicyError(newPassword)
  if (policyError) throw new Error(policyError)
  const { token } = await authApi.changePassword(oldPassword, newPassword, cfTurnstileToken)
  // 复用唯一会话入口：同步内存登录态，并按平台落盘/忽略新 token
  setSession(currentUser.value, token)
}

// ---------- 退出 ----------
/** 旧版 Service Worker 的私有 API 运行时缓存名。vite.config.ts 已把 /api/* 改为 NetworkOnly 不再写入；
 *  保留清理是因为已安装的旧版本 PWA 在升级前写入的条目仍可能残留在设备上。 */
const LEGACY_API_CACHE = 'api-cache'

/** 清掉缓存中的私有 API 响应：同一设备换账号后不得复用上一账号的通知 / 私信等数据 */
function clearApiCaches(): void {
  if (typeof caches === 'undefined') return // Electron 等非安全上下文无 CacheStorage
  caches.delete(LEGACY_API_CACHE).catch(() => {})
}

export function logout(): void {
  setSession(null) // 先清本地会话（立即生效）
  exitGuestMode() // 退出登录同时清除访客模式，防止多标签页下 guestMode 残留绕过登录页入口
  clearApiCaches() // 清掉缓存里的私有 API 响应，避免换账号后串数据
  authApi.logout().catch(() => {}) // 异步通知服务端吊销 JWT 并清除 Cookie
}

// ---------- 多标签页登出同步 ----------
// 另一标签页退出登录会移除跨标签页共享的登录标记，而本标签页内存中的 currentUser 仍在
//（isLoggedIn 为 true，路由守卫放行），此后每个请求都因 Cookie 已清而 401，却停留在登录态界面。
// storage 事件只在「其它标签页」改动 localStorage 时触发，正是需要同步的场景。
window.addEventListener('storage', (e) => {
  // 只处理「登录标记被移除」：另一标签页登录（写入标记）不应把本标签页登出
  if (e.newValue !== null) return
  // e.key 为 null 表示整库被清空（localStorage.clear()）
  if (e.key !== null && e.key !== SESSION_FLAG && e.key !== TOKEN_KEY) return
  // 本标签页本就无登录态（未登录的访客）时无需处理
  if (!hasActiveSession()) return
  // 与 401 同一条收尾路径：清会话 + 通知清空内存数据 + 回登录页
  expireSession()
})

/** 跳转登录页并携带回跳地址（当前 hash 路由，登录成功后返回原页面） */
export function goLogin(router: { push: (p: string) => void }) {
  const current = window.location.hash.replace(/^#/, '') || '/'
  router.push(`/login?redirect=${encodeURIComponent(current)}`)
}

/** 访客触发需登录操作时跳转登录页；返回 true 表示「已因未登录而拦截」 */
export function requireLogin(router: { push: (p: string) => void }): boolean {
  if (isLoggedIn.value) return false
  goLogin(router)
  return true
}
