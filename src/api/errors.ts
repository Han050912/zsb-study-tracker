import { request } from './client'
import type { ErrorQuestion } from '../types'

export const errorsApi = {
  getAll: () => request<ErrorQuestion[]>('/api/errors')
}
