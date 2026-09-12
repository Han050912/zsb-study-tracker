import { on } from '../router'
import { crudHandlers } from '../db'

/** 笔记元数据（正文走 /api/note-bodies；PDF 原文以 note.id 为 pdf_id 走 /api/pdfs）。 */
export const notesMapping = crudHandlers({
  table: 'notes',
  toRow: (userId, b, id) => ({
    id,
    user_id: userId,
    subject_id: b.subjectId,
    title: b.title,
    content: '',
    tags: JSON.stringify(b.tags ?? []),
    type: b.type ?? null,
    // updated_at 是 LWW 比较键，必须由 push 协议显式给出（客户端编辑时刻）。
    // 不能兜底成 Date.now()：那会把「服务器写入时刻」当成「编辑时刻」，掩盖并污染 LWW 判定。
    updated_at: b.updatedAt,
    body_updated_at: b.type === 'pdf' ? 0 : (b.bodyUpdatedAt ?? 0)
  }),
  fromRow: (r) => {
    let tags: string[]
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
      tags,
      updatedAt: r.updated_at,
      bodyUpdatedAt: r.type === 'pdf' ? 0 : Number(r.body_updated_at ?? 0),
      type: r.type === 'pdf' ? 'pdf' : undefined
    }
  }
})

export function registerNoteRoutes() {
  on('GET', '/api/notes', true, notesMapping.list)
}
