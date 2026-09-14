import { z } from 'zod'
import { on } from '../router'
import { crudHandlers } from '../db'

/** 与 todosMapping.toRow 消费字段一一对应 */
const todoBodySchema = z
  .object({
    id: z.string().optional(),
    date: z.string(),
    text: z.string(),
    done: z.boolean().optional(),
    order: z.number().optional(),
    completedAt: z.number().optional(),
    startAt: z.number().optional(),
    dueAt: z.number().optional(),
    startNotifiedAt: z.number().optional(),
    dueNotifiedAt: z.number().optional()
  })
  .passthrough()

/** 待办事项（todos 表 ↔ 前端 Todo，"order" 为保留字列需引号） */
export const todosMapping = crudHandlers({
  table: 'todos',
  schema: todoBodySchema,
  toRow: (userId, b, id) => ({
    id,
    user_id: userId,
    date: b.date,
    text: b.text,
    done: b.done ? 1 : 0,
    order: b.order ?? 0,
    completed_at: b.completedAt ?? null,
    start_at: b.startAt ?? null,
    due_at: b.dueAt ?? null,
    start_notified_at: b.startNotifiedAt ?? null,
    due_notified_at: b.dueNotifiedAt ?? null
  }),
  fromRow: (r) => ({
    id: r.id,
    date: r.date,
    text: r.text,
    done: !!r.done,
    order: r.order ?? 0,
    completedAt: r.completed_at ?? undefined,
    startAt: r.start_at ?? undefined,
    dueAt: r.due_at ?? undefined,
    startNotifiedAt: r.start_notified_at ?? undefined,
    dueNotifiedAt: r.due_notified_at ?? undefined
  })
})

export function registerTodoRoutes() {
  on('GET', '/api/todos', true, todosMapping.list)
}
