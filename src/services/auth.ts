import { ref, computed } from 'vue'
import { authApi } from '../api/auth'

/**
 * 认证服务：注册 / 登录 / 退出 / 会话持久化。
 * - 密码由 Worker 端 bcryptjs(cost=10) 哈希存储，前端不接触哈希细节
 * - 登录成功获得 HS256 JWT（7 天过期），存 localStorage 供 client.ts 携带
 */

const TOKEN_KEY = 'jwt_token'

export interface SessionUser {
  id: string
  username: string
  role: string
  createdAt: number
}

const currentUser = ref<SessionUser | null>(null)

export const isLoggedIn = computed(() => currentUser.value !== null)
export const sessionUser = computed(() => currentUser.value)
export const isAdmin = computed(() => currentUser.value?.role === 'admin')

function setSession(user: SessionUser | null, token?: string) {
  currentUser.value = user
  if (user && token) localStorage.setItem(TOKEN_KEY, token)
  if (!user) localStorage.removeItem(TOKEN_KEY)
}

/** 应用启动时恢复登录状态：有 token 则调用 /api/auth/me 验证并取回用户信息。
 *  仅 401（token 失效）清除会话；网络故障保留 token，下次启动重试。 */
export async function restoreSession(): Promise<SessionUser | null> {
  if (!localStorage.getItem(TOKEN_KEY)) return null
  try {
    const { user } = await authApi.me()
    currentUser.value = user
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
  setSession(null)
}
