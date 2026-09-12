import { on } from '../router'
import { crudHandlers } from '../db'

/** 英语专项：阅读训练 */
export const readingMapping = crudHandlers({
  table: 'reading_records',
  toRow: (userId, b, id) => ({
    id,
    user_id: userId,
    date: b.date,
    wpm: b.wpm,
    accuracy: b.accuracy
  }),
  fromRow: (r) => ({ id: r.id, date: r.date, wpm: r.wpm, accuracy: r.accuracy })
})

/** 英语专项：听力练习 */
export const listeningMapping = crudHandlers({
  table: 'listening_records',
  toRow: (userId, b, id) => ({
    id,
    user_id: userId,
    date: b.date,
    minutes: b.minutes,
    material: b.material,
    mode: b.mode
  }),
  fromRow: (r) => ({ id: r.id, date: r.date, minutes: r.minutes, material: r.material, mode: r.mode })
})

/** 英语专项：作文模板 */
export const templatesMapping = crudHandlers({
  table: 'essay_templates',
  toRow: (userId, b, id) => ({
    id,
    user_id: userId,
    title: b.title,
    content: b.content,
    level: b.level ?? 1,
    category: b.category ?? null
  }),
  fromRow: (r) => ({
    id: r.id,
    title: r.title,
    content: r.content,
    level: r.level ?? 1,
    category: r.category ?? undefined
  })
})

export function registerEnglishRoutes() {
  on('GET', '/api/reading', true, readingMapping.list)

  on('GET', '/api/listening', true, listeningMapping.list)

  on('GET', '/api/templates', true, templatesMapping.list)
}
