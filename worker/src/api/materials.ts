import { z } from 'zod'
import { on } from '../router'
import { crudHandlers } from '../db'

/** 与 materialsMapping.toRow 消费字段一一对应 */
const materialBodySchema = z
  .object({
    id: z.string().optional(),
    title: z.string().trim().min(1, '请填写资料标题'),
    type: z.string(),
    subjectId: z.string().optional(),
    priority: z.string().optional(),
    url: z.string().optional(),
    fileName: z.string().optional(),
    author: z.string().optional(),
    totalPages: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
    readPages: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
    notes: z.string().optional(),
    favorite: z.boolean().optional(),
    createdAt: z.number().optional()
  })
  .passthrough()
  .refine((m) => m.totalPages === undefined || m.readPages === undefined || m.readPages <= m.totalPages, {
    message: '已读页数不能超过总页数',
    path: ['readPages']
  })

/** 学习资料（materials 表 ↔ 前端 Material） */
export const materialsMapping = crudHandlers({
  table: 'materials',
  schema: materialBodySchema,
  toRow: (userId, b, id) => ({
    id,
    user_id: userId,
    title: b.title,
    type: b.type,
    subject_id: b.subjectId ?? null,
    priority: b.priority ?? '中',
    url: b.url ?? null,
    file_name: b.fileName ?? null,
    author: b.author ?? null,
    total_pages: b.totalPages ?? null,
    read_pages: b.readPages ?? null,
    notes: b.notes ?? null,
    favorite: b.favorite ? 1 : 0,
    created_at: b.createdAt ?? Date.now()
  }),
  fromRow: (r) => ({
    id: r.id,
    title: r.title,
    type: r.type,
    subjectId: r.subject_id ?? undefined,
    priority: r.priority ?? '中',
    url: r.url ?? undefined,
    fileName: r.file_name ?? undefined,
    author: r.author ?? undefined,
    totalPages: r.total_pages ?? undefined,
    readPages: r.read_pages ?? undefined,
    notes: r.notes ?? undefined,
    favorite: !!r.favorite,
    createdAt: r.created_at
  })
})

export function registerMaterialRoutes() {
  on('GET', '/api/materials', true, materialsMapping.list)
}
