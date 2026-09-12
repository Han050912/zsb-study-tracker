import { request } from './client'
import type { Todo } from '../types'

export const todosApi = {
  getAll: () => request<Todo[]>('/api/todos')
}
