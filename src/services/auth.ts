import { ref, computed } from 'vue'
import { authApi } from '../api/auth'

/**
 * 认证服务：注册 / 登录 / 退出 / 会话持久化。
 * - 密码由 Worker 端 bcryptjs(cost=10) 哈希存储，前端不接触哈希细节
 * - Web 端：登录成功由服务端 Set-Cookie 下发 HttpOnly 会话（本地仅存非敏感登录标志）
 * - 桌面端：登录成功获得 HS256 JWT，存 localStorage 供 client.ts 携带
 */

const TOKEN_KEY = 'jwt_token'
const SESSION_FLAG = 'auth_logged_in'
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

function setSession(user: SessionUser | null, token?: string) {
  currentUser.value = user
  if (user) {
    if (isDesktop && token) localStorage.setItem(TOKEN_KEY, token)
    localStorage.setItem(SESSION_FLAG, '1')
    exitGuestMode() // 建立登录会话即结束访客浏览
  } else {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(SESSION_FLAG)
  }
}

/** 本地是否存在会话凭据（桌面端看 JWT，Web 端看非敏感登录标志） */
function hasLocalSession(): boolean {
  return isDesktop ? !!localStorage.getItem(TOKEN_KEY) : localStorage.getItem(SESSION_FLAG) === '1'
}

/** 应用启动时恢复登录状态：有会话凭据则调用 /api/auth/me 验证并取回用户信息。
 *  仅 401（凭据失效）清除会话；网络故障保留凭据，下次启动重试。 */
export async function restoreSession(): Promise<SessionUser | null> {
  if (!hasLocalSession()) return null
  try {
    const { user } = await authApi.me()
    currentUser.value = user
    exitGuestMode() // 恢复登录态即结束访客模式，保持登录态与访客模式互斥
    return user
  } catch (e: any) {
    if (e?.status === 401) setSession(null)
    return null
  }
}

// ---------- 注册 ----------
export async function register(username: string, password: string, cfTurnstileToken = ''): Promise<SessionUser> {
  username = username.trim()
  // 前置校验与 Worker 端口径一致，保证错误提示即时
  if (username.length < 2) throw new Error('用户名至少 2 个字符')
  if (username.length > 20) throw new Error('用户名最多 20 个字符')
  if (password.length < 6) throw new Error('密码至少 6 位')
  if (password.length > 128) throw new Error('密码最多 128 位')
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

// ---------- 退出 ----------
export function logout(): void {
  setSession(null) // 先清本地会话（立即生效）
  exitGuestMode() // 退出登录同时清除访客模式，防止多标签页下 guestMode 残留绕过登录页入口
  authApi.logout().catch(() => {}) // 异步通知服务端吊销 JWT 并清除 Cookie
}

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
