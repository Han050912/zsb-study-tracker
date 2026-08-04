import { request } from './client'
import type { ExamRecord } from '../types'

export const examsApi = {
  getAll: () => request<ExamRecord[]>('/api/exams'),
  create: (data: Omit<ExamRecord, 'id'>) =>
    request<ExamRecord>('/api/exams', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: Partial<ExamRecord>) =>
    request<ExamRecord>(`/api/exams/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: string) =>
    request<void>(`/api/exams/${id}`, { method: 'DELETE' })
}
