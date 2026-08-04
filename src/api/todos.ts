import { request } from './client'
import type { Todo } from '../types'

export const todosApi = {
  getAll: () => request<Todo[]>('/api/todos'),
  create: (data: Omit<Todo, 'id'>) =>
    request<Todo>('/api/todos', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: Partial<Todo>) =>
    request<Todo>(`/api/todos/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: string) =>
    request<void>(`/api/todos/${id}`, { method: 'DELETE' })
}
