import { z } from 'zod'
import { on } from '../router'
import { crudHandlers } from '../db'

/** 与 problemsMapping.toRow 消费字段一一对应；types 键名随科目题型模板动态变化，仅校验「键→数值」形状 */
const problemBodySchema = z
  .object({
    id: z.string().optional(),
    subjectId: z.string(),
    date: z.string(),
    total: z.number(),
    correct: z.number(),
    types: z.record(z.string(), z.number()).optional()
  })
  .passthrough()

/** 刷题记录（problem_sessions 表 ↔ 前端 ProblemSession，types 为 JSON 字符串） */
export const problemsMapping = crudHandlers({
  table: 'problem_sessions',
  schema: problemBodySchema,
  toRow: (userId, b, id) => ({
    id,
    user_id: userId,
    subject_id: b.subjectId,
    date: b.date,
    total: b.total,
    correct: b.correct,
    types: JSON.stringify(b.types ?? {})
  }),
  fromRow: (r) => ({
    id: r.id,
    subjectId: r.subject_id,
    date: r.date,
    total: r.total,
    correct: r.correct,
    types: JSON.parse(r.types || '{}')
  })
})

export function registerProblemRoutes() {
  on('GET', '/api/problems', true, problemsMapping.list)
}
