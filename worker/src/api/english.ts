import { z } from 'zod'
import { on } from '../router'
import { crudHandlers } from '../db'

/** 各 schema 与对应 toRow 消费字段一一对应 */
const readingBodySchema = z
  .object({ id: z.string().optional(), date: z.string(), wpm: z.number(), accuracy: z.number() })
  .passthrough()

const listeningBodySchema = z
  .object({
    id: z.string().optional(),
    date: z.string(),
    minutes: z.number(),
    material: z.string(),
    mode: z.string()
  })
  .passthrough()

const templateBodySchema = z
  .object({
    id: z.string().optional(),
    title: z.string(),
    content: z.string(),
    level: z.number().optional(),
    category: z.string().optional()
  })
  .passthrough()

/** 英语专项：阅读训练 */
export const readingMapping = crudHandlers({
  table: 'reading_records',
  schema: readingBodySchema,
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
  schema: listeningBodySchema,
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
  schema: templateBodySchema,
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
