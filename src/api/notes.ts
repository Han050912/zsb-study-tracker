import { request } from './client'
import type { Note } from '../types'

export const notesApi = {
  getAll: () => request<Note[]>('/api/notes')
}
