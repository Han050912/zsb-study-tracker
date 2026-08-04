import { request } from './client'
import type { ProblemSession } from '../types'

export const problemsApi = {
  getAll: () => request<ProblemSession[]>('/api/problems'),
  create: (data: Omit<ProblemSession, 'id'>) =>
    request<ProblemSession>('/api/problems', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: Partial<ProblemSession>) =>
    request<ProblemSession>(`/api/problems/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: string) =>
    request<void>(`/api/problems/${id}`, { method: 'DELETE' })
}
