import { request } from './client'
import type { VocabRecord } from '../types'

export const vocabApi = {
  getAll: () => request<VocabRecord[]>('/api/vocab'),
  create: (data: Omit<VocabRecord, 'id'>) =>
    request<VocabRecord>('/api/vocab', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: Partial<VocabRecord>) =>
    request<VocabRecord>(`/api/vocab/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: string) =>
    request<void>(`/api/vocab/${id}`, { method: 'DELETE' })
}
