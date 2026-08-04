import { on } from '../router'
import { crudHandlers } from '../db'

/** 刷题记录（problem_sessions 表 ↔ 前端 ProblemSession，types 为 JSON 字符串） */
export const problemsMapping = crudHandlers({
  table: 'problem_sessions',
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
  on('POST', '/api/problems', true, problemsMapping.create)
  on('PUT', '/api/problems/:id', true, problemsMapping.update)
  on('DELETE', '/api/problems/:id', true, problemsMapping.remove)
}
