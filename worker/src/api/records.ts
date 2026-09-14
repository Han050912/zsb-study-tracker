import { z } from 'zod'
import { on } from '../router'
import { crudHandlers } from '../db'

/** 与 recordsMapping.toRow 消费字段一一对应；passthrough 放行同步附带的 updatedAt 等运行时字段 */
const recordBodySchema = z
  .object({
    id: z.string().optional(),
    subjectId: z.string(),
    date: z.string(),
    minutes: z.number(),
    chapterId: z.string().optional(),
    topic: z.string().optional(),
    note: z.string().optional(),
    createdAt: z.number().optional()
  })
  .passthrough()

/** 学习记录（study_records 表 ↔ 前端 StudyRecord） */
export const recordsMapping = crudHandlers({
  table: 'study_records',
  schema: recordBodySchema,
  toRow: (userId, b, id) => ({
    id,
    user_id: userId,
    subject_id: b.subjectId,
    date: b.date,
    minutes: b.minutes,
    chapter_id: b.chapterId ?? null,
    topic: b.topic ?? null,
    note: b.note ?? null,
    created_at: b.createdAt ?? Date.now()
  }),
  fromRow: (r) => ({
    id: r.id,
    subjectId: r.subject_id,
    date: r.date,
    minutes: r.minutes,
    chapterId: r.chapter_id ?? undefined,
    topic: r.topic ?? undefined,
    note: r.note ?? undefined,
    createdAt: r.created_at
  })
})

export function registerRecordRoutes() {
  on('GET', '/api/records', true, recordsMapping.list)
}
