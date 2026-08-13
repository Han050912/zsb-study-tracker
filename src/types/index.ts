/** 全局核心数据结构定义 */

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
  /** 题型 -> 数量；键名随科目题型模板而定（数学：choice/blank/calc/proof，英语：choice/cloze/reading/translate/writing），旧数据键名不受影响 */
  types: Record<string, number>
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
  /** 文本笔记为 Markdown 源码；PDF 笔记为 'd1:<id>' 引用（原文二进制分片存 D1，阅读时回源拼装） */
  content: string
  tags: string[]
  updatedAt: number
  /** 缺省为 Markdown 笔记；'pdf' 表示 PDF 原文笔记（以查看器渲染，不可编辑正文） */
  type?: 'pdf'
}

/** 背单词打卡记录（逐条） */
export interface VocabRecord {
  id: string
  date: string
  newWords: number
  reviewWords: number
  /** 本条打卡获得的积分（删除时全额回收） */
  points: number
}

/** 英语专项数据 */
export interface EnglishExtra {
  vocab: VocabRecord[]
  /** id 用于积分流水关联（refId），旧数据迁移时自动补齐 */
  reading: { id?: string; date: string; wpm: number; accuracy: number }[]
  listening: { id?: string; date: string; minutes: number; material: string; mode: '精听' | '泛听' }[]
  /** 作文模板；category 为新增可选字段（议论文/图表文/信件文），旧数据无此字段归入「自定义」 */
  templates: { id: string; title: string; content: string; level: number; category?: string }[]
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
  /** 坏习惯「每日克制打卡」记录：date -> 1 */
  checkins?: Record<string, number>
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

/** 番茄钟统计 */
export interface PomodoroStat {
  daily: Record<string, { count: number; minutes: number; interruptions: number }>
  interruptions: { date: string; reason: string; time: number }[]
  /** 中断/提前结束的部分时长记录（不计入完成次数和总时长） */
  partialSessions: { date: string; minutes: number; time: number }[]
}

/** 待办 */
export interface Todo {
  id: string
  date: string
  text: string
  done: boolean
  order: number
  /** 标记完成的具体时间（时间戳），随待办永久保存；未完成/取消完成时该字段不存在 */
  completedAt?: number
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
  /** 墨墨背单词开放 API Token（可选，App 内 我的→更多设置→实验功能→开放 API 获取） */
  maimemoToken?: string
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

/** ========== 社区广场 ========== */

/** 帖子类型 */
export type PostType = 'checkin' | 'share' | 'achievement' | 'longform' | 'question'

/** 社区帖子（userName/userPoints/likedByMe 为服务端 JOIN 填充） */
export interface CommunityPost {
  id: string
  userId: string
  userName: string
  /** 作者当前总积分，前端据此换算等级称号（LEVELS） */
  userPoints: number
  type: PostType
  content: string
  tags: string[]
  /** 配图路径列表（/api/community/images/<id>，最多 9 张），经 imageUrl() 转绝对地址 */
  imageUrls: string[]
  /** 提问帖是否已被楼主标记解决 */
  isResolved: boolean
  refType?: string
  refId?: string
  likesCount: number
  commentsCount: number
  isPinned: boolean
  isHidden: boolean
  likedByMe: boolean
  createdAt: number // Unix 秒
}

/** 社区评论；parentId 为空为一级评论，否则为二级回复（最多二级） */
export interface CommunityComment {
  id: string
  postId: string
  userId: string
  userName: string
  parentId?: string
  content: string
  likesCount: number
  isHidden: boolean
  likedByMe: boolean
  createdAt: number // Unix 秒
  /** 前端组装的二级回复 */
  replies?: CommunityComment[]
}

/** 社区通知 */
export interface CommunityNotification {
  id: string
  type: 'like' | 'comment' | 'follow' | 'achievement' | 'system'
  actorId?: string
  actorName?: string
  postId?: string
  commentId?: string
  content: string
  isRead: boolean
  createdAt: number // Unix 秒
}

/** 今日打卡榜条目 */
export interface LeaderboardTodayEntry {
  userName: string
  todayPoints: number
  streak: number
  totalPoints: number
  /** 今日打卡科目名列表 */
  subjects: string[]
}

/** 连续打卡王条目 */
export interface LeaderboardStreakEntry {
  userName: string
  streak: number
  totalPoints: number
}

export interface CommunityLeaderboard {
  today: LeaderboardTodayEntry[]
  streak: LeaderboardStreakEntry[]
}

/** 管理端举报队列条目（target 为 null 表示内容已被作者删除） */
export interface AdminReport {
  id: string
  targetType: 'post' | 'comment'
  targetId: string
  reason: string
  detail: string
  createdAt: number
  reporterName: string
  target: {
    authorName: string
    excerpt: string
    isHidden: boolean
    postId: string
  } | null
}
