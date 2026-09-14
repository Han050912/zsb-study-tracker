import { z } from 'zod'
import { on } from '../router'
import { crudHandlers } from '../db'

/** 与 examsMapping.toRow 消费字段一一对应；parts 为「部分名→得分」的 Record */
const examBodySchema = z
  .object({
    id: z.string().optional(),
    subjectId: z.string(),
    date: z.string(),
    title: z.string(),
    score: z.number(),
    totalScore: z.number(),
    minutes: z.number(),
    parts: z.record(z.string(), z.number()).optional()
  })
  .passthrough()

/** 真题/套卷（exam_records 表 ↔ 前端 ExamRecord，parts 为 JSON 字符串） */
export const examsMapping = crudHandlers({
  table: 'exam_records',
  schema: examBodySchema,
  toRow: (userId, b, id) => ({
    id,
    user_id: userId,
    subject_id: b.subjectId,
    date: b.date,
    title: b.title,
    score: b.score,
    total_score: b.totalScore,
    minutes: b.minutes,
    parts: b.parts ? JSON.stringify(b.parts) : null
  }),
  fromRow: (r) => ({
    id: r.id,
    subjectId: r.subject_id,
    date: r.date,
    title: r.title,
    score: r.score,
    totalScore: r.total_score,
    minutes: r.minutes,
    parts: r.parts ? JSON.parse(r.parts) : undefined
  })
})

export function registerExamRoutes() {
  on('GET', '/api/exams', true, examsMapping.list)
}
