import { request } from './client'
import type { PomodoroStat } from '../types'

export const pomodoroApi = {
  get: () => request<PomodoroStat>('/api/pomodoro'),
  update: (data: PomodoroStat) =>
    request<PomodoroStat>('/api/pomodoro', { method: 'PUT', body: JSON.stringify(data) })
}
