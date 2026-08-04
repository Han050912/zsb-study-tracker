import { on } from '../router'
import { crudHandlers } from '../db'

/** 学习资料（materials 表 ↔ 前端 Material） */
export const materialsMapping = crudHandlers({
  table: 'materials',
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
    createdAt: r.created_at
  })
})

export function registerMaterialRoutes() {
  on('GET', '/api/materials', true, materialsMapping.list)
  on('POST', '/api/materials', true, materialsMapping.create)
  on('PUT', '/api/materials/:id', true, materialsMapping.update)
  on('DELETE', '/api/materials/:id', true, materialsMapping.remove)
}
