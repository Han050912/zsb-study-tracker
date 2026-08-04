import { on } from '../router'
import { crudHandlers } from '../db'

/** 错题（error_questions 表 ↔ 前端 ErrorQuestion，image 存 base64 dataURL） */
export const errorsMapping = crudHandlers({
  table: 'error_questions',
  toRow: (userId, b, id) => ({
    id,
    user_id: userId,
    subject_id: b.subjectId,
    date: b.date,
    chapter: b.chapter ?? null,
    type: b.type,
    content: b.content,
    answer: b.answer ?? null,
    image: b.image ?? null,
    review_count: b.reviewCount ?? 0,
    mastered: b.mastered ? 1 : 0,
    created_at: b.createdAt ?? Date.now()
  }),
  fromRow: (r) => ({
    id: r.id,
    subjectId: r.subject_id,
    date: r.date,
    chapter: r.chapter ?? undefined,
    type: r.type,
    content: r.content,
    answer: r.answer ?? undefined,
    image: r.image ?? undefined,
    reviewCount: r.review_count ?? 0,
    mastered: !!r.mastered,
    createdAt: r.created_at
  })
})

export function registerErrorRoutes() {
  on('GET', '/api/errors', true, errorsMapping.list)
  on('POST', '/api/errors', true, errorsMapping.create)
  on('PUT', '/api/errors/:id', true, errorsMapping.update)
  on('DELETE', '/api/errors/:id', true, errorsMapping.remove)
}
