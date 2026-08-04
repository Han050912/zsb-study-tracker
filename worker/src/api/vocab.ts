import { on } from '../router'
import { crudHandlers } from '../db'

/** 背单词打卡（vocab_records 表 ↔ 前端 VocabRecord） */
export const vocabMapping = crudHandlers({
  table: 'vocab_records',
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
  on('POST', '/api/vocab', true, vocabMapping.create)
  on('PUT', '/api/vocab/:id', true, vocabMapping.update)
  on('DELETE', '/api/vocab/:id', true, vocabMapping.remove)
}
