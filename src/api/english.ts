import { request } from './client'
import type { EnglishExtra } from '../types'

type ReadingItem = EnglishExtra['reading'][number]
type ListeningItem = EnglishExtra['listening'][number]
type TemplateItem = EnglishExtra['templates'][number]

export const readingApi = {
  getAll: () => request<ReadingItem[]>('/api/reading'),
  create: (data: Omit<ReadingItem, 'id'>) =>
    request<ReadingItem>('/api/reading', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: Partial<ReadingItem>) =>
    request<ReadingItem>(`/api/reading/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: string) =>
    request<void>(`/api/reading/${id}`, { method: 'DELETE' })
}

export const listeningApi = {
  getAll: () => request<ListeningItem[]>('/api/listening'),
  create: (data: Omit<ListeningItem, 'id'>) =>
    request<ListeningItem>('/api/listening', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: Partial<ListeningItem>) =>
    request<ListeningItem>(`/api/listening/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: string) =>
    request<void>(`/api/listening/${id}`, { method: 'DELETE' })
}

export const templatesApi = {
  getAll: () => request<TemplateItem[]>('/api/templates'),
  create: (data: Omit<TemplateItem, 'id'>) =>
    request<TemplateItem>('/api/templates', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: Partial<TemplateItem>) =>
    request<TemplateItem>(`/api/templates/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: string) =>
    request<void>(`/api/templates/${id}`, { method: 'DELETE' })
}
