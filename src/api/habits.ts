import { request } from './client'
import type { Habit } from '../types'

export const habitsApi = {
  getAll: () => request<Habit[]>('/api/habits'),
  create: (data: Omit<Habit, 'id'>) =>
    request<Habit>('/api/habits', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: Partial<Habit>) =>
    request<Habit>(`/api/habits/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: string) =>
    request<void>(`/api/habits/${id}`, { method: 'DELETE' })
}
