import { request } from './client'
import type { Gamification } from '../types'

export const gamificationApi = {
  get: () => request<Gamification>('/api/gamification'),
  update: (data: Gamification) =>
    request<Gamification>('/api/gamification', { method: 'PUT', body: JSON.stringify(data) })
}
