import { request } from './client'
import type { Note } from '../types'

export const notesApi = {
  getAll: () => request<Note[]>('/api/notes'),
  create: (data: Omit<Note, 'id'>) =>
    request<Note>('/api/notes', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: Partial<Note>) =>
    request<Note>(`/api/notes/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: string) =>
    request<void>(`/api/notes/${id}`, { method: 'DELETE' })
}
