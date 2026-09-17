/** 全局核心数据结构定义 */
// 新增类型名全局唯一（export * 同名冲突静默遮蔽）
import type {
  Subject,
  StudyRecord,
  ProblemSession,
  ErrorQuestion,
  ExamRecord,
  DailySummary,
  Material,
  Gamification
} from './study'
import type { EnglishExtra } from './english'
import type { Note } from './notes'
import type { Habit } from './habits'
import type { PomodoroStat } from './pomodoro'
import type { Todo } from './todos'
import type { Settings } from './settings'

export interface AppState {
  subjects: Subject[]
  records: StudyRecord[]
  problemSessions: ProblemSession[]
  errorQuestions: ErrorQuestion[]
  exams: ExamRecord[]
  notes: Note[]
  english: EnglishExtra
  summaries: Record<string, DailySummary>
  habits: Habit[]
  materials: Material[]
  gamification: Gamification
  pomodoro: PomodoroStat
  todos: Todo[]
  settings: Settings
}

export * from './study'
export * from './english'
export * from './notes'
export * from './habits'
export * from './pomodoro'
export * from './todos'
export * from './settings'
export * from './community'
export * from './team'
export * from './partner'
export * from './admin'
export * from './feedback'
