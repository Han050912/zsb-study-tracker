import { request } from './client'
import type { Habit } from '../types'

export const habitsApi = {
  getAll: () => request<Habit[]>('/api/habits')
}
