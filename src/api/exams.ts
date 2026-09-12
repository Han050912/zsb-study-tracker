import { request } from './client'
import type { ExamRecord } from '../types'

export const examsApi = {
  getAll: () => request<ExamRecord[]>('/api/exams')
}
