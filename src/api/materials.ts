import { request } from './client'
import type { Material } from '../types'

export const materialsApi = {
  getAll: () => request<Material[]>('/api/materials')
}
