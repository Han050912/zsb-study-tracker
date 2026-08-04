import { request } from './client'
import type { StudyRecord } from '../types'

export const recordsApi = {
  getAll: () => request<StudyRecord[]>('/api/records'),
  create: (data: Omit<StudyRecord, 'id'>) =>
    request<StudyRecord>('/api/records', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: Partial<StudyRecord>) =>
    request<StudyRecord>(`/api/records/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: string) =>
    request<void>(`/api/records/${id}`, { method: 'DELETE' })
}
