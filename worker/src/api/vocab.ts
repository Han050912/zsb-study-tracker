import { z } from 'zod'
import { on } from '../router'
import { crudHandlers } from '../db'

/** 与 vocabMapping.toRow 消费字段一一对应 */
const vocabBodySchema = z
  .object({
    id: z.string().optional(),
    date: z.string(),
    newWords: z.number(),
    reviewWords: z.number(),
    points: z.number().optional()
  })
  .passthrough()

/** 背单词打卡（vocab_records 表 ↔ 前端 VocabRecord） */
export const vocabMapping = crudHandlers({
  table: 'vocab_records',
  schema: vocabBodySchema,
  toRow: (userId, b, id) => ({
    id,
    user_id: userId,
    date: b.date,
    new_words: b.newWords,
    review_words: b.reviewWords,
    points: b.points ?? 0
  }),
  fromRow: (r) => ({
    id: r.id,
    date: r.date,
    newWords: r.new_words,
    reviewWords: r.review_words,
    points: r.points ?? 0
  })
})

export function registerVocabRoutes() {
  on('GET', '/api/vocab', true, vocabMapping.list)
}
