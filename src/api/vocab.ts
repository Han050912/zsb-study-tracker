import { request } from './client'
import type { VocabRecord } from '../types'

export const vocabApi = {
  getAll: () => request<VocabRecord[]>('/api/vocab')
}
