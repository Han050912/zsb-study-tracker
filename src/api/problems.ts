import { request } from './client'
import type { ProblemSession } from '../types'

export const problemsApi = {
  getAll: () => request<ProblemSession[]>('/api/problems')
}
