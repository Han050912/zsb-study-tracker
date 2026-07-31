/** 全局核心数据结构定义 */

export interface Chapter {
  id: string
  name: string
  topics: string[]
}

export interface Subject {
  id: string
  name: string
  icon: string
  color: string
  weight: number
  builtin: boolean
  chapters: Chapter[]
  /** 知识点 -> 掌握度(1-5) */
  mastery: Record<string, number>
}

/** 学习记录（按次） */
export interface StudyRecord {
  id: string
  subjectId: string
  date: string // YYYY-MM-DD
  minutes: number
  chapterId?: string
  topic?: string
  note?: string
  createdAt: number
}

/** 刷题记录 */
export interface ProblemSession {
  id: string
  subjectId: string
  date: string
  total: number
  correct: number
  types: { choice: number; blank: number; calc: number; proof: number }
}

/** 错题 */
export interface ErrorQuestion {
  id: string
  subjectId: string
  date: string
  chapter?: string
  type: '选择' | '填空' | '计算' | '证明' | '其他'
  content: string
  answer?: string
  image?: string // base64
  reviewCount: number
  mastered: boolean
  createdAt: number
}

/** 真题/套卷记录 */
export interface ExamRecord {
  id: string
  subjectId: string
  date: string
  title: string
  score: number
  totalScore: number
  minutes: number
  parts?: Record<string, number>
}

/** 笔记 */
export interface Note {
  id: string
  subjectId: string
  title: string
  content: string
  tags: string[]
  updatedAt: number
}

/** 英语专项数据 */
export interface EnglishExtra {
  vocab: { date: string; newWords: number; reviewWords: number }[]
  reading: { date: string; wpm: number; accuracy: number }[]
  listening: { date: string; minutes: number; material: string; mode: '精听' | '泛听' }[]
  templates: { id: string; title: string; content: string; level: number }[]
}

/** 每日总结 */
export interface DailySummary {
  date: string
  mood: string // emoji key
  harvest: string
  improve: string
  plan: string
}

/** 习惯 */
export type HabitType = 'checkbox' | 'minutes' | 'count' | 'time'
export interface Habit {
  id: string
  name: string
  type: HabitType
  target?: number
  bad?: boolean
  /** date -> 值（checkbox: 1/0, time: "HH:mm"） */
  records: Record<string, number | string>
}

/** 学习资料 */
export interface Material {
  id: string
  title: string
  type: 'book' | 'video' | 'link' | 'doc'
  subjectId?: string
  priority: '高' | '中' | '低'
  url?: string
  author?: string
  totalPages?: number
  readPages?: number
  notes?: string
  createdAt: number
}

/** 游戏化 */
export interface Gamification {
  points: number
  streak: number
  lastCheckin: string
  achievements: string[]
  pointsLog: { date: string; points: number; reason: string }[]
}

/** 番茄钟统计 */
export interface PomodoroStat {
  daily: Record<string, { count: number; minutes: number; interruptions: number }>
  interruptions: { date: string; reason: string; time: number }[]
}

/** 待办 */
export interface Todo {
  id: string
  date: string
  text: string
  done: boolean
  order: number
}

/** 设置 */
export interface Settings {
  userName: string
  dailyGoalMinutes: number
  wordGoal: number
  problemGoal: number
  examDate: string
  theme: 'light' | 'dark' | 'auto'
  reminderEnabled: boolean
  reminderTime: string
  quotes: string[]
  onboarded: boolean
}

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
