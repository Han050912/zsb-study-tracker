/** 学习域：科目/学习记录/刷题/错题/真题/每日总结/学习资料/游戏化 */

export interface Chapter {
  id: string
  name: string
  topics: string[]
}

/** 知识点重要程度分级 */
export type TopicImportance = 'normal' | 'important' | 'must'

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
  /** 知识点 -> 重要程度（普通/重要/必考），未标记视为普通 */
  topicImportance: Record<string, TopicImportance>
  /** 记录级 LWW 时间戳（客户端编辑时刻 ms；同步运行时字段，不进 UI） */
  updatedAt?: number
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
  /** 记录级 LWW 时间戳（客户端编辑时刻 ms；同步运行时字段，不进 UI） */
  updatedAt?: number
}

/** 刷题记录 */
export interface ProblemSession {
  id: string
  subjectId: string
  date: string
  total: number
  correct: number
  /** 题型 -> 数量；键名随科目题型模板而定（数学：choice/blank/calc/proof，英语：choice/cloze/reading/translate/writing），旧数据键名不受影响 */
  types: Record<string, number>
  /** 记录级 LWW 时间戳（同步运行时字段，不进 UI） */
  updatedAt?: number
}

/** 错题 */
export interface ErrorQuestion {
  id: string
  subjectId: string
  date: string
  chapter?: string
  type: string // 题型跟随科目动态变化：数学/英语/自定义科目各自独立题型列表
  content: string
  answer?: string
  /** 题目配图引用：'r2:<sha256>'（字节存 R2，经认证通道加载） */
  image?: string
  reviewCount: number
  mastered: boolean
  createdAt: number
  /** 记录级 LWW 时间戳（同步运行时字段，不进 UI） */
  updatedAt?: number
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
  /** 记录级 LWW 时间戳（同步运行时字段，不进 UI） */
  updatedAt?: number
}

/** 每日总结 */
export interface DailySummary {
  date: string
  mood: string // emoji key
  harvest: string
  improve: string
  plan: string
  /** 记录级 LWW 时间戳（同步运行时字段，不进 UI） */
  updatedAt?: number
}

/** 学习资料 */
export interface Material {
  id: string
  title: string
  type: 'book' | 'video' | 'link' | 'doc'
  subjectId?: string
  priority: '高' | '中' | '低'
  /** 链接 URL 或上传文件的 dataURL */
  url?: string
  /** 上传文件的原始文件名（url 为 dataURL 时存在） */
  fileName?: string
  author?: string
  totalPages?: number
  readPages?: number
  notes?: string
  createdAt: number
  /** 记录级 LWW 时间戳（同步运行时字段，不进 UI） */
  updatedAt?: number
}

/** 游戏化 */
export interface Gamification {
  points: number
  streak: number
  lastCheckin: string
  achievements: string[]
  /** 积分流水；refId 关联产生积分的原始记录 id，删除原始记录时按此回收积分并移除流水 */
  pointsLog: { date: string; points: number; reason: string; refId?: string }[]
}
