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
  fromRow: (r) => {
    // parts 为「部分名→得分」的 Record：仅接受纯对象，解析失败或解析出数组/标量时降级为 undefined（等同无该列）
    let parts: Record<string, number> | undefined
    if (r.parts) {
      try {
        const v = JSON.parse(r.parts)
        parts = v && typeof v === 'object' && !Array.isArray(v) ? v : undefined
      } catch {
        // 数据库中 parts 字段损坏时降级为 undefined，不拖垮整个同步接口
        parts = undefined
      }
    }
    return {
      id: r.id,
      subjectId: r.subject_id,
      date: r.date,
      title: r.title,
      score: r.score,
      totalScore: r.total_score,
      minutes: r.minutes,
      parts
    }
  }
})

export function registerExamRoutes() {
  on('GET', '/api/exams', true, examsMapping.list)
}
