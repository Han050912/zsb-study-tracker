import { on } from '../router'
import { crudHandlers } from '../db'

/** 待办事项（todos 表 ↔ 前端 Todo，"order" 为保留字列需引号） */
export const todosMapping = crudHandlers({
  table: 'todos',
  toRow: (userId, b, id) => ({
    id,
    user_id: userId,
    date: b.date,
    text: b.text,
    done: b.done ? 1 : 0,
    order: b.order ?? 0,
    completed_at: b.completedAt ?? null
  }),
  fromRow: (r) => ({
    id: r.id,
    date: r.date,
    text: r.text,
    done: !!r.done,
    order: r.order ?? 0,
    completedAt: r.completed_at ?? undefined
  })
})

export function registerTodoRoutes() {
  on('GET', '/api/todos', true, todosMapping.list)
  on('POST', '/api/todos', true, todosMapping.create)
  on('PUT', '/api/todos/:id', true, todosMapping.update)
  on('DELETE', '/api/todos/:id', true, todosMapping.remove)
}
