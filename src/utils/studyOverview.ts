import { daysBetween } from './date'
import type { Subject } from '../types'

/** 空值和非法日期不参与倒计时；过去的日期保留负值，不能显示成考试当天。 */
export function examDistance(today: string, examDate: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(examDate)) return null
  const stamp = Date.parse(`${examDate}T00:00:00Z`)
  if (!Number.isFinite(stamp) || new Date(stamp).toISOString().slice(0, 10) !== examDate) return null
  return daysBetween(today, examDate)
}

export function recentStudyDays(today: string, minutes: Record<string, number>) {
  const stamp = Date.parse(`${today}T00:00:00Z`)
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(stamp - (6 - index) * 86400_000).toISOString().slice(0, 10)
    return { date, minutes: Math.max(0, minutes[date] || 0), isToday: date === today }
  })
}

/** 自评覆盖与自评分开计算；未评不是 0 分，学习天数也不是掌握程度。 */
export function masteryOverview(subject: Subject) {
  const topics = [...new Set(subject.chapters.flatMap((chapter) => chapter.topics))]
  const values = topics.map((topic) => subject.mastery[topic]).filter((value) => value >= 1 && value <= 5)
  return {
    total: topics.length,
    rated: values.length,
    weak: values.filter((value) => value < 3).length,
    average: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null
  }
}
