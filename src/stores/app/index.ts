/**
 * app store 组合入口（原 src/stores/app.ts）：state 初始化与 10 个 getters 留守于此，
 * 71 个 actions 按业务域模块 spread 组合（sync/gamification/records/problems/exams/errors/
 * subjects/notes/summaries/habits/settings/todos/pomodoro/english/importExport）。
 * 对外契约不变：store id 'app'、导出 useAppStore、state 字段名与 action/getter 名全部不变。
 */
import { defineStore } from 'pinia'
import { createDefaultState, LEVELS, levelOf } from '../../data/defaults'
import { today, daysBetween } from '../../utils/date'
import type { AppState, StudyRecord, Subject, Todo } from '../../types'

import { syncActions } from './sync'
import { gamificationActions } from './gamification'
import { recordsActions } from './records'
import { problemsActions } from './problems'
import { examsActions } from './exams'
import { errorsActions } from './errors'
import { subjectsActions } from './subjects'
import { notesActions } from './notes'
import { summariesActions } from './summaries'
import { habitsActions } from './habits'
import { settingsActions } from './settings'
import { todosActions } from './todos'
import { pomodoroActions } from './pomodoro'
import { englishActions } from './english'
import { importExportActions } from './importExport'

export const useAppStore = defineStore('app', {
  // 初始为默认空数据；登录后通过 hydrate() 从云端全量拉取该用户的数据
  state: (): AppState => createDefaultState(),

  getters: {
    subjectMap(): Record<string, Subject> {
      return Object.fromEntries(this.subjects.map((s) => [s.id, s]))
    },
    todayRecords(): StudyRecord[] {
      return this.records.filter((r) => r.date === today())
    },
    todayMinutes(): number {
      return this.todayRecords.reduce((s, r) => s + r.minutes, 0)
    },
    totalMinutes(): number {
      return this.records.reduce((s, r) => s + r.minutes, 0)
    },
    totalProblems(): number {
      return this.problemSessions.reduce((s, p) => s + p.total, 0)
    },
    todayPomodoro(): { count: number; minutes: number; interruptions: number } {
      return this.pomodoro.daily[today()] || { count: 0, minutes: 0, interruptions: 0 }
    },
    todayTodos(): Todo[] {
      return this.todos.filter((t) => t.date === today()).sort((a, b) => a.order - b.order)
    },
    level(): { name: string; min: number; color: string; next?: { name: string; min: number } } {
      const cur = levelOf(this.gamification.points)
      return { ...cur, next: LEVELS[LEVELS.indexOf(cur) + 1] }
    },
    examCountdown(): number | null {
      if (!this.settings.examDate) return null
      const d = daysBetween(today(), this.settings.examDate)
      return d >= 0 ? d : null
    },

    /** 某科目某日期时长 */
    minutesByDate(): Record<string, number> {
      const map: Record<string, number> = {}
      for (const r of this.records) map[r.date] = (map[r.date] || 0) + r.minutes
      return map
    }
  },

  actions: {
    ...syncActions,
    ...gamificationActions,
    ...recordsActions,
    ...problemsActions,
    ...examsActions,
    ...errorsActions,
    ...subjectsActions,
    ...notesActions,
    ...summariesActions,
    ...habitsActions,
    ...settingsActions,
    ...todosActions,
    ...pomodoroActions,
    ...englishActions,
    ...importExportActions
  }
})
