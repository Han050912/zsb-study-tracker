import { request } from './client'
import type { StudyRecord } from '../types'

export const recordsApi = {
  getAll: () => request<StudyRecord[]>('/api/records')
}
