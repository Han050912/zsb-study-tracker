import { request } from './client'
import type { Material } from '../types'

export const materialsApi = {
  getAll: () => request<Material[]>('/api/materials'),
  create: (data: Omit<Material, 'id'>) =>
    request<Material>('/api/materials', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: Partial<Material>) =>
    request<Material>(`/api/materials/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: string) =>
    request<void>(`/api/materials/${id}`, { method: 'DELETE' })
}
