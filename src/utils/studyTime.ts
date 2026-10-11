import type { AppState, StudyRecord } from '../types'

type StudyTimeState = Pick<AppState, 'records' | 'pomodoro'>

/** 已结算专注属于学习时长；日汇总与专注明细是同一批数据，只计日汇总一次。 */
export function focusMinutesOn(state: StudyTimeState, date: string): number {
  return state.pomodoro.daily[date]?.minutes ?? 0
}

/** 专注详情只用于分科归属，不再向 records 写一份时长。旧日汇总缺少详情的部分仍保留为未分科目。 */
export function attributedFocusRecords(state: StudyTimeState, date: string): StudyRecord[] {
  let remaining = focusMinutesOn(state, date)
  const records: StudyRecord[] = []
  for (const focus of state.pomodoro.records ?? []) {
    if (focus.date !== date || !focus.subjectId || remaining <= 0) continue
    const minutes = Math.min(remaining, Math.max(0, focus.minutes))
    if (!minutes) continue
    remaining -= minutes
    records.push({
      id: `focus:${focus.id}`,
      subjectId: focus.subjectId,
      chapterId: focus.chapterId,
      date,
      minutes,
      note: focus.description,
      createdAt: focus.time
    })
  }
  return records
}

/** 仅供展示/汇总的分科视图；调用方不可把这些派生项再存回 records。 */
export function subjectStudyRecordsOn(state: StudyTimeState, date: string): StudyRecord[] {
  return [...state.records.filter((record) => record.date === date), ...attributedFocusRecords(state, date)]
}

export function unassignedFocusMinutesOn(state: StudyTimeState, date: string): number {
  return Math.max(
    0,
    focusMinutesOn(state, date) - attributedFocusRecords(state, date).reduce((sum, r) => sum + r.minutes, 0)
  )
}

export function studyMinutesOn(state: StudyTimeState, date: string): number {
  return (
    state.records.filter((record) => record.date === date).reduce((sum, record) => sum + record.minutes, 0) +
    focusMinutesOn(state, date)
  )
}

export function studyMinutesByDate(state: StudyTimeState): Record<string, number> {
  const minutes: Record<string, number> = {}
  for (const record of state.records) minutes[record.date] = (minutes[record.date] ?? 0) + record.minutes
  for (const [date, focus] of Object.entries(state.pomodoro.daily)) minutes[date] = (minutes[date] ?? 0) + focus.minutes
  return minutes
}

export function totalStudyMinutes(state: StudyTimeState): number {
  return Object.values(studyMinutesByDate(state)).reduce((sum, minutes) => sum + minutes, 0)
}
