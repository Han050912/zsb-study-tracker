import { on } from '../router'
import { crudHandlers } from '../db'

/** 真题/套卷（exam_records 表 ↔ 前端 ExamRecord，parts 为 JSON 字符串） */
export const examsMapping = crudHandlers({
  table: 'exam_records',
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
  on('POST', '/api/exams', true, examsMapping.create)
  on('PUT', '/api/exams/:id', true, examsMapping.update)
  on('DELETE', '/api/exams/:id', true, examsMapping.remove)
}
