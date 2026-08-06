import { request } from './client'

export interface AuthUser {
  id: string
  username: string
  createdAt: number
}

export const authApi = {
  // cfTurnstileToken 桌面端传空串：此时不携带 X-CF-Turnstile-Response 头，
  // Worker 对 app://localhost 来源跳过人机验证
  register: (username: string, password: string, cfTurnstileToken = '') =>
    request<{ token: string; user: AuthUser }>('/api/auth/register', {
      method: 'POST', body: JSON.stringify({ username, password }),
      ...(cfTurnstileToken ? { headers: { 'X-CF-Turnstile-Response': cfTurnstileToken } } : {})
    }),
  login: (username: string, password: string, cfTurnstileToken = '') =>
    request<{ token: string; user: AuthUser }>('/api/auth/login', {
      method: 'POST', body: JSON.stringify({ username, password }),
      ...(cfTurnstileToken ? { headers: { 'X-CF-Turnstile-Response': cfTurnstileToken } } : {})
    }),
  me: () => request<{ user: AuthUser }>('/api/auth/me')
}
