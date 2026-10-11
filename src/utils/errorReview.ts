import { businessDate } from './date'
import type { ErrorQuestion, ErrorReviewResult } from '../types'

/** 应用内的间隔复习安排：每次从最近一次复习起计算，已掌握题目至少间隔 7 天。 */
export const REVIEW_INTERVAL_DAYS = [1, 2, 4, 7, 15, 30] as const

export function nextErrorReviewDate(reviewCount: number, mastered: boolean, at = Date.now()): string {
  const index = Math.min(Math.max(Math.floor(reviewCount) - 1, 0), REVIEW_INTERVAL_DAYS.length - 1)
  const days = Math.max(REVIEW_INTERVAL_DAYS[index]!, mastered ? 7 : 1)
  return businessDate(at + days * 86400_000)
}

export const REVIEW_RESULT_LABELS: Record<ErrorReviewResult, string> = {
  again: '不会',
  hard: '勉强做对',
  good: '独立做对'
}

export function isErrorDue(question: Pick<ErrorQuestion, 'nextReviewDate' | 'mastered'>, today: string): boolean {
  return question.nextReviewDate ? question.nextReviewDate <= today : !question.mastered
}

export function reviewSchedule(question: ErrorQuestion, result: ErrorReviewResult, at = Date.now()) {
  const reviewStreak = result === 'good' ? (question.reviewStreak ?? 0) + 1 : 0
  const mastered = result === 'good' && question.mastered
  const nextReviewDate =
    result === 'good'
      ? nextErrorReviewDate(reviewStreak, mastered, at)
      : businessDate(at + (result === 'hard' ? 2 : 1) * 86400_000)
  return { reviewStreak, mastered, nextReviewDate, lastReviewResult: result, lastReviewedAt: at }
}
