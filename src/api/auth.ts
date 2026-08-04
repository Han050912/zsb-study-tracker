import { request } from './client'

export interface AuthUser {
  id: string
  username: string
  createdAt: number
}

export const authApi = {
  register: (username: string, password: string) =>
    request<{ token: string; user: AuthUser }>('/api/auth/register', {
      method: 'POST', body: JSON.stringify({ username, password })
    }),
  login: (username: string, password: string) =>
    request<{ token: string; user: AuthUser }>('/api/auth/login', {
      method: 'POST', body: JSON.stringify({ username, password })
    }),
  me: () => request<{ user: AuthUser }>('/api/auth/me')
}
