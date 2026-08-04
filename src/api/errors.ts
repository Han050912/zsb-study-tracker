import { request } from './client'
import type { ErrorQuestion } from '../types'

export const errorsApi = {
  getAll: () => request<ErrorQuestion[]>('/api/errors'),
  create: (data: Omit<ErrorQuestion, 'id'>) =>
    request<ErrorQuestion>('/api/errors', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: Partial<ErrorQuestion>) =>
    request<ErrorQuestion>(`/api/errors/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: string) =>
    request<void>(`/api/errors/${id}`, { method: 'DELETE' })
}
