import { request } from './client'
import type { EnglishExtra } from '../types'

type ReadingItem = EnglishExtra['reading'][number]
type ListeningItem = EnglishExtra['listening'][number]
type TemplateItem = EnglishExtra['templates'][number]

export const readingApi = {
  getAll: () => request<ReadingItem[]>('/api/reading')
}

export const listeningApi = {
  getAll: () => request<ListeningItem[]>('/api/listening')
}

export const templatesApi = {
  getAll: () => request<TemplateItem[]>('/api/templates')
}
