import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdir, writeFile, unlink, readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const result = await build({
  stdin: {
    contents: `export * from './src/utils/learningPlan'; export * from './src/utils/errorReview'; export * from './src/data/defaults'; export { errorsMapping } from './worker/src/api/errors';`,
    resolveDir: process.cwd()
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false
})
await mkdir('.cache/study-flow', { recursive: true })
const file = resolve('.cache/study-flow/learning-plan-' + crypto.randomUUID() + '.mjs')
await writeFile(file, result.outputFiles[0].text)
const { buildLearningPlan, reviewSchedule, createDefaultState, errorsMapping } = await import(pathToFileURL(file).href)
await unlink(file)

test('plan preserves the daily time budget, prioritizes weak/due chapters and ignores future practice', () => {
  const state = createDefaultState()
  state.settings.dailyGoalMinutes = 61
  state.subjects.forEach((s) => {
    s.weight = 50
  })
  const math = state.subjects.find((s) => s.id === 'math')
  math.mastery[math.chapters[1].topics[0]] = 1
  state.errorQuestions.push({
    id: 'due',
    subjectId: 'math',
    chapter: math.chapters[1].id,
    nextReviewDate: '2026-10-09',
    mastered: true
  })
  const first = buildLearningPlan(state, '2026-10-10')
  assert.equal(
    first.rows.reduce((n, row) => n + row.minutes, 0),
    61
  )
  assert.ok(
    first.rows.find((r) => r.subject.id === 'math').minutes > first.rows.find((r) => r.subject.id === 'english').minutes
  )
  assert.equal(first.rows.find((r) => r.subject.id === 'math').chapterId, math.chapters[1].id)
  state.problemSessions.push({ subjectId: 'english', date: '2026-10-11', total: 100, correct: 0 })
  assert.deepEqual(
    buildLearningPlan(state, '2026-10-10').rows.map((r) => r.minutes),
    first.rows.map((r) => r.minutes)
  )
  state.settings.dailyGoalMinutes = 1
  assert.equal(
    buildLearningPlan(state, '2026-10-10').rows.reduce((n, r) => n + r.minutes, 0),
    1
  )
  state.subjects = []
  assert.deepEqual(buildLearningPlan(state, '2026-10-10').rows, [])
})

test('recent pace uses recorded past days and does not silently change the chosen goal', () => {
  const state = createDefaultState()
  state.settings.dailyGoalMinutes = 240
  state.records = ['2026-10-07', '2026-10-08', '2026-10-09'].map((date) => ({ date, minutes: 30 }))
  state.pomodoro.daily['2026-10-09'] = { minutes: 30 }
  const plan = buildLearningPlan(state, '2026-10-10')
  assert.equal(plan.recentAverage, 40)
  assert.equal(plan.budget, 240)
})

test('wrong answers reset a long streak and legacy reviews never imply past correct answers', () => {
  const at = Date.parse('2026-10-10T16:30:00Z')
  const wrong = reviewSchedule({ mastered: true, reviewStreak: 12 }, 'again', at)
  assert.equal(wrong.nextReviewDate, '2026-10-12')
  assert.equal(wrong.mastered, false)
  assert.equal(wrong.reviewStreak, 0)
  assert.equal(reviewSchedule({ mastered: false, reviewCount: 99 }, 'good', at).reviewStreak, 1)
  assert.equal(reviewSchedule({ mastered: true }, 'hard', at).nextReviewDate, '2026-10-13')
})

test('0013 preserves historical questions and review feedback round-trips through the server mapping', async () => {
  const db = new DatabaseSync(':memory:')
  try {
    const schema = (await readFile('worker/schema.sql', 'utf8'))
      .replace(/ {2}last_review_result TEXT,\r?\n/, '')
      .replace(/ {2}review_streak INTEGER NOT NULL DEFAULT 0,\r?\n/, '')
    db.exec(schema)
    db.exec(
      "INSERT INTO users(id,username,password_hash,created_at) VALUES ('u','reviewer','unused',1); INSERT INTO error_questions(user_id,id,subject_id,date,type,content,review_count,mastered,created_at) VALUES ('u','q','math','2026-10-10','选择','legacy',12,1,1);"
    )
    db.exec(await readFile('worker/migrations/0013_error_review_feedback.sql', 'utf8'))
    assert.equal(db.prepare('SELECT review_count FROM error_questions').get().review_count, 12)
    assert.equal(db.prepare('SELECT review_streak FROM error_questions').get().review_streak, 0)
    const row = errorsMapping.mapping.toRow(
      'u',
      {
        subjectId: 'math',
        date: '2026-10-10',
        type: '选择',
        content: '题',
        reviewCount: 13,
        lastReviewResult: 'again',
        reviewStreak: 0,
        nextReviewDate: '2026-10-11'
      },
      'q'
    )
    db.prepare('UPDATE error_questions SET last_review_result=?,review_streak=?,next_review_date=? WHERE id=?').run(
      row.last_review_result,
      row.review_streak,
      row.next_review_date,
      'q'
    )
    const restored = errorsMapping.mapping.fromRow(db.prepare('SELECT * FROM error_questions').get())
    assert.equal(restored.lastReviewResult, 'again')
    assert.equal(restored.reviewStreak, 0)
    assert.equal(restored.nextReviewDate, '2026-10-11')
  } finally {
    db.close()
  }
})
