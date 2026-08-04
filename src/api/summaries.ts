import { request } from './client'
import type { DailySummary } from '../types'

export const summariesApi = {
  getAll: () => request<DailySummary[]>('/api/summaries'),
  upsert: (date: string, data: Omit<DailySummary, 'date'>) =>
    request<DailySummary>(`/api/summaries/${date}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (date: string) =>
    request<void>(`/api/summaries/${date}`, { method: 'DELETE' })
}
