import { request } from './client'
import type { Subject } from '../types'

export const subjectsApi = {
  getAll: () => request<Subject[]>('/api/subjects'),
  create: (data: Omit<Subject, 'id'>) =>
    request<Subject>('/api/subjects', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: Partial<Subject>) =>
    request<Subject>(`/api/subjects/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: string) =>
    request<void>(`/api/subjects/${id}`, { method: 'DELETE' })
}
