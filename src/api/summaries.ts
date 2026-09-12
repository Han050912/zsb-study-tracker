import { request } from './client'
import type { DailySummary } from '../types'

export const summariesApi = {
  getAll: () => request<DailySummary[]>('/api/summaries')
}
