import { on } from '../router'
import { crudHandlers } from '../db'

/** Markdown 笔记（notes 表 ↔ 前端 Note，tags 为 JSON 数组字符串） */
export const notesMapping = crudHandlers({
  table: 'notes',
  toRow: (userId, b, id) => ({
    id,
    user_id: userId,
    subject_id: b.subjectId,
    title: b.title,
    content: b.content,
    tags: JSON.stringify(b.tags ?? []),
    updated_at: b.updatedAt ?? Date.now()
  }),
  fromRow: (r) => {
    let tags: string[] = []
    try {
      tags = JSON.parse(r.tags || '[]')
      if (!Array.isArray(tags)) tags = []
    } catch {
      // 数据库中 tags 字段损坏时降级为空数组，不拖垮整个同步接口
      tags = []
    }
    return {
      id: r.id,
      subjectId: r.subject_id,
      title: r.title,
      content: r.content,
      tags,
      updatedAt: r.updated_at
    }
  }
})

export function registerNoteRoutes() {
  on('GET', '/api/notes', true, notesMapping.list)
  on('POST', '/api/notes', true, notesMapping.create)
  on('PUT', '/api/notes/:id', true, notesMapping.update)
  on('DELETE', '/api/notes/:id', true, notesMapping.remove)
}
