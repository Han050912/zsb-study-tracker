import { request } from './client'
import type { Subject } from '../types'

export const subjectsApi = {
  getAll: () => request<Subject[]>('/api/subjects')
}
