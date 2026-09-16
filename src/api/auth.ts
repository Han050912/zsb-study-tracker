import { request } from './client'

export interface AuthUser {
  id: string
  username: string
  role: string
  createdAt: number
}

export const authApi = {
  // cfTurnstileToken 桌面端传空串：此时不携带 X-CF-Turnstile-Response 头。
  // 桌面端由请求层无条件附带的 X-Desktop-Token 完成人机验证替代校验；
  // Worker 侧没有「按来源跳过验证」的逻辑（对 app://localhost 仅有 CORS 白名单）
  register: (username: string, password: string, cfTurnstileToken = '') =>
    request<{ token: string; user: AuthUser }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
      ...(cfTurnstileToken ? { headers: { 'X-CF-Turnstile-Response': cfTurnstileToken } } : {})
    }),
  login: (username: string, password: string, cfTurnstileToken = '') =>
    request<{ token: string; user: AuthUser }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
      ...(cfTurnstileToken ? { headers: { 'X-CF-Turnstile-Response': cfTurnstileToken } } : {})
    }),
  // 修改密码：服务端校验当前密码，成功后吊销该账号其它会话并换发本次会话 token
  changePassword: (oldPassword: string, newPassword: string, cfTurnstileToken = '') =>
    request<{ ok: boolean; token: string }>('/api/auth/password', {
      method: 'POST',
      body: JSON.stringify({ oldPassword, newPassword }),
      ...(cfTurnstileToken ? { headers: { 'X-CF-Turnstile-Response': cfTurnstileToken } } : {})
    }),
  me: () => request<{ user: AuthUser }>('/api/auth/me'),
  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' })
}
