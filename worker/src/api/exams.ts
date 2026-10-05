import { z } from 'zod'
import { on } from '../router'
import { crudHandlers } from '../db'

/** 与 examsMapping.toRow 消费字段一一对应；parts 为「部分名→得分」的 Record */
const examBodySchema = z
  .object({
    id: z.string().optional(),
    subjectId: z.string(),
    date: z.string(),
    title: z.string().refine((value) => !!value.trim(), '请填写试卷名称'),
    score: z.number().min(0, '得分不能小于 0'),
    totalScore: z.number().positive('总分需大于 0'),
    minutes: z.number().positive('用时需大于 0').max(1440, '用时不能超过 1440 分钟'),
    // parts 线上实际形状为「部分名→得分」数组（[{name, score}]，与同步测试用例 14 一致），非 Record
    parts: z.array(z.object({ name: z.string(), score: z.number() })).optional()
  })
  .passthrough()
  .refine((value) => value.score <= value.totalScore, { message: '得分不能超过总分', path: ['score'] })

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
    // parts 实际以「部分名→得分」数组（[{name, score}]）落库：仅做容错解析，不二次限定形状，
    // 解析失败才降级为 undefined（等同无该列），不拖垮整个同步接口
    let parts: Record<string, number> | undefined
    if (r.parts) {
      try {
        parts = JSON.parse(r.parts)
      } catch {
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
