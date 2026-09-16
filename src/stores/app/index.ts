/**
 * app store 组合入口（原 src/stores/app.ts）：state 初始化与 10 个 getters 留守于此，
 * 71 个 actions 按业务域模块 spread 组合（sync/gamification/records/problems/exams/errors/
 * subjects/notes/summaries/habits/settings/todos/pomodoro/english/importExport）。
 * 对外契约不变：store id 'app'、导出 useAppStore、state 字段名与 action/getter 名全部不变。
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
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

/**
 * 响应式业务日（UTC+8，P2-05）：30s 心跳检测跨天，跨 0 点后所有依赖它的「今日」getter
 * （今日学习时长 / 今日番茄钟 / 今日待办 / 倒计时）自动重新求值，页面停留过零点无需刷新。
 * 模块级单例 ref —— store 全局唯一，心跳定时器亦随之唯一，不新增平行定时器体系。
 */
const todayTick = ref(today())
setInterval(() => {
  todayTick.value = today()
}, 30_000)

export const useAppStore = defineStore('app', {
  // 初始为默认空数据；登录后通过 hydrate() 从云端全量拉取该用户的数据
  state: (): AppState => createDefaultState(),

  getters: {
    subjectMap(): Record<string, Subject> {
      return Object.fromEntries(this.subjects.map((s) => [s.id, s]))
    },
    /** 响应式今日业务键（UTC+8）：跨零点自动更新，「今日」系列 getter 均依赖它 */
    todayKey(): string {
      return todayTick.value
    },
    todayRecords(): StudyRecord[] {
      return this.records.filter((r) => r.date === this.todayKey)
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
      return this.pomodoro.daily[this.todayKey] || { count: 0, minutes: 0, interruptions: 0 }
    },
    todayTodos(): Todo[] {
      return this.todos.filter((t) => t.date === this.todayKey).sort((a, b) => a.order - b.order)
    },
    level(): { name: string; min: number; color: string; next?: { name: string; min: number } } {
      const cur = levelOf(this.gamification.points)
      return { ...cur, next: LEVELS[LEVELS.indexOf(cur) + 1] }
    },
    examCountdown(): number | null {
      if (!this.settings.examDate) return null
      const d = daysBetween(this.todayKey, this.settings.examDate)
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
