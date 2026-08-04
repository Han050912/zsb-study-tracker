import { on } from '../router'
import { crudHandlers } from '../db'

/** 学习记录（study_records 表 ↔ 前端 StudyRecord） */
export const recordsMapping = crudHandlers({
  table: 'study_records',
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
  on('POST', '/api/records', true, recordsMapping.create)
  on('PUT', '/api/records/:id', true, recordsMapping.update)
  on('DELETE', '/api/records/:id', true, recordsMapping.remove)
}
