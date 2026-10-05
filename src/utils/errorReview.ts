import { businessDate } from './date'

/** 应用内的间隔复习安排：每次从最近一次复习起计算，已掌握题目至少间隔 7 天。 */
export const REVIEW_INTERVAL_DAYS = [1, 2, 4, 7, 15, 30] as const

export function nextErrorReviewDate(reviewCount: number, mastered: boolean, at = Date.now()): string {
  const index = Math.min(Math.max(Math.floor(reviewCount) - 1, 0), REVIEW_INTERVAL_DAYS.length - 1)
  const days = Math.max(REVIEW_INTERVAL_DAYS[index]!, mastered ? 7 : 1)
  return businessDate(at + days * 86400_000)
}
