import type { AppState } from '../types'
import { daysBetween } from './date'
import { isErrorDue } from './errorReview'
import { studyMinutesOn } from './studyTime'

export function buildLearningPlan(
  state: Pick<AppState, 'subjects' | 'settings' | 'errorQuestions' | 'problemSessions' | 'records' | 'pomodoro'>,
  today: string
) {
  const enabled = state.subjects.filter((s) => s.weight > 0)
  const subjects = enabled.length ? enabled : state.subjects
  const budget = Math.max(1, Math.min(1440, Math.round(state.settings.dailyGoalMinutes) || 240))
  const examDays = state.settings.examDate ? daysBetween(today, state.settings.examDate) : null
  const rows = subjects.map((subject) => {
    const due = state.errorQuestions.filter((q) => q.subjectId === subject.id && isErrorDue(q, today))
    const mastery = Object.values(subject.mastery)
    const weakRatio = mastery.length ? mastery.filter((value) => value < 3).length / mastery.length : 0
    const sessions = state.problemSessions.filter(
      (s) => s.subjectId === subject.id && daysBetween(s.date, today) >= 0 && daysBetween(s.date, today) < 14
    )
    const total = sessions.reduce((n, s) => n + s.total, 0)
    const correct = sessions.reduce((n, s) => n + s.correct, 0)
    const errorRatio = total ? Math.max(0, 1 - correct / total) : 0
    const chapter = [...subject.chapters].sort((a, b) => {
      const score = (ch: typeof a) =>
        due.filter((q) => q.chapter === ch.id || q.chapter === ch.name || ch.topics.includes(q.chapter || '')).length *
          2 +
        ch.topics.filter((t) => (subject.mastery[t] ?? 5) < 3).length
      return score(b) - score(a)
    })[0]
    const reasons = [
      due.length && `${due.length} 道错题待复习`,
      weakRatio > 0 && `${mastery.filter((v) => v < 3).length} 个薄弱知识点`,
      total > 0 && `近两周正确率 ${Math.round((correct / total) * 100)}%`
    ].filter(Boolean)
    if (examDays != null && examDays >= 0 && examDays <= 30) reasons.push('临考阶段，优先重做与巩固')
    return {
      subject,
      chapterId: chapter?.id || '',
      reason: reasons.join('；') || '按考试科目权重分配，可按自己的进度调整',
      score: (subject.weight || 1) * (1 + weakRatio + errorRatio + Math.min(due.length, 10) / 10),
      minutes: 0
    }
  })
  const totalScore = rows.reduce((sum, row) => sum + row.score, 0)
  for (const row of rows) row.minutes = Math.floor((budget * row.score) / totalScore)
  const remainders = [...rows].sort(
    (a, b) => (((budget * b.score) / totalScore) % 1) - (((budget * a.score) / totalScore) % 1)
  )
  for (let i = 0, left = budget - rows.reduce((sum, row) => sum + row.minutes, 0); i < left && remainders.length; i++)
    remainders[i % remainders.length]!.minutes++
  const pastDays = Array.from({ length: 7 }, (_, i) =>
    new Date(Date.parse(`${today}T00:00:00Z`) - (i + 1) * 86400_000).toISOString().slice(0, 10)
  )
  const activeMinutes = pastDays.map((date) => studyMinutesOn(state, date)).filter((n) => n > 0)
  const recentAverage =
    activeMinutes.length >= 3 ? Math.round(activeMinutes.reduce((a, b) => a + b, 0) / activeMinutes.length) : null
  return { rows, budget, recentAverage }
}
