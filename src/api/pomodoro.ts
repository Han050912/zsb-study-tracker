import { request } from './client'
import type { PomodoroStat } from '../types'

export const pomodoroApi = {
  get: () => request<PomodoroStat>('/api/pomodoro')
}
