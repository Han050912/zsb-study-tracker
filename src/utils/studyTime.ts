import type { AppState } from '../types'

type StudyTimeState = Pick<AppState, 'records' | 'pomodoro'>

/** 已结算专注属于学习时长；日汇总与专注明细是同一批数据，只计日汇总一次。 */
export function focusMinutesOn(state: StudyTimeState, date: string): number {
  return state.pomodoro.daily[date]?.minutes ?? 0
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
