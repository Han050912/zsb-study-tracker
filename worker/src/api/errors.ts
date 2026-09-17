import { z } from 'zod'
import { on } from '../router'
import { crudHandlers } from '../db'

/** 与 errorsMapping.toRow 消费字段一一对应 */
const errorBodySchema = z
  .object({
    id: z.string().optional(),
    subjectId: z.string(),
    date: z.string(),
    chapter: z.string().optional(),
    type: z.string(),
    content: z.string(),
    answer: z.string().optional(),
    image: z.string().optional(),
    reviewCount: z.number().optional(),
    mastered: z.boolean().optional(),
    createdAt: z.number().optional()
  })
  .passthrough()

/** 错题（error_questions 表 ↔ 前端 ErrorQuestion，image 存 'r2:<sha256>' 引用，字节在 R2） */
export const errorsMapping = crudHandlers({
  table: 'error_questions',
  schema: errorBodySchema,
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
}
