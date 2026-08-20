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
  /** 计划开始时间（时间戳）：到点提醒任务已开始；未设置则不提醒 */
  startAt?: number
  /** 最晚截止时间（时间戳）：到点仍未完成则提醒；未设置则不提醒 */
  dueAt?: number
  /** 开始提醒已发出的时间（去重用，避免重复提醒）；重设开始时间时清除 */
  startNotifiedAt?: number
  /** 截止提醒已发出的时间（去重用）；重设截止时间时清除 */
  dueNotifiedAt?: number
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
  /** 作者是否为认证专家（蓝 V） */
  userVerified: boolean
  type: PostType
  content: string
  tags: string[]
  /** 配图路径列表（/api/community/images/<id>，最多 9 张），经 imageUrl() 转绝对地址 */
  imageUrls: string[]
  /** 提问帖是否已被楼主标记解决（采纳最佳答案时自动置位） */
  isResolved: boolean
  /** 被采纳最佳答案的评论 ID（仅提问帖；取消采纳后为 undefined） */
  acceptedAnswerId?: string
  /** 是否为管理员加精的精华帖 */
  isFeatured: boolean
  /** 是否为每日一题（管理员设置，广场顶部展示最新一题） */
  isDaily: boolean
  /** 所属圈子 ID（undefined = 广场公开帖） */
  circleId?: string
  /** 所属圈子名（服务端 JOIN 填充） */
  circleName?: string
  /** 知识点讨论帖归属（'subjectId|chapterName'；非空 = 章节讨论帖，不进公共广场） */
  topicRef?: string
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
  /** 评论配图路径列表（最多 3 张），经 imageUrl() 转绝对地址 */
  imageUrls: string[]
  /** 作者是否为认证专家（蓝 V） */
  userVerified: boolean
  likesCount: number
  /** 是否被楼主采纳为最佳答案 */
  isAccepted: boolean
  isHidden: boolean
  likedByMe: boolean
  createdAt: number // Unix 秒
  /** 前端组装的二级回复 */
  replies?: CommunityComment[]
}

/** 社区通知 */
export interface CommunityNotification {
  id: string
  type: 'like' | 'comment' | 'follow' | 'achievement' | 'message' | 'system'
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
  /** 认证专家（蓝 V） */
  verified: boolean
  /** 今日打卡科目名列表 */
  subjects: string[]
}

/** 连续打卡王条目 */
export interface LeaderboardStreakEntry {
  userName: string
  streak: number
  totalPoints: number
  /** 认证专家（蓝 V） */
  verified: boolean
}

export interface CommunityLeaderboard {
  today: LeaderboardTodayEntry[]
  streak: LeaderboardStreakEntry[]
}

/** 上周学习周报（惰性计算，无快照） */
export interface WeeklyReport {
  weekStart: string
  weekEnd: string
  minutes: number
  studyDays: number
  problems: number
  correct: number
  points: number
  interactions: number
}

/** 用户徽章记录（key 目录见 defaults.ts COMMUNITY_BADGES） */
export interface UserBadge {
  key: string
  awardedAt: number // Unix 秒
}

/** 社区用户资料卡（公开荣誉信息，不含私有学习数据） */
export interface CommunityUserProfile {
  userId: string
  userName: string
  points: number
  streak: number
  verified: boolean
  expertise: string
  /** 可见帖子 + 评论总数 */
  postCount: number
  /** 帖子 + 评论累计获赞 */
  likesReceived: number
  badges: UserBadge[]
  /** 粉丝数 */
  followers: number
  /** 当前登录用户是否已关注该用户 */
  followedByMe: boolean
}

/** 个人主页学习统计（热力图 + 总览 + 科目分布） */
export interface UserStudyStats {
  heatmap: { date: string; minutes: number }[]
  totalStudy: { minutes: number; days: number }
  monthStudy: { minutes: number }
  problems: { total: number; correct: number; sessions: number; accuracy: number }
  subjects: { id: string; name: string; minutes: number }[]
}

/** 学习路径推荐（P2-4）：考试倒计时 + 按科目权重分配的周学习计划 */
export interface LearningPath {
  examDate: string | null
  /** 距离考试天数（未设置/已过期为 null） */
  daysLeft: number | null
  dailyGoalMinutes: number
  subjects: { id: string; name: string; icon: string; weight: number; dailyMinutes: number }[]
  weeklyTotalMinutes: number
}

/** 话题圈子（myStatus 为当前登录用户的加入状态） */
export interface CommunityCircle {
  id: string
  name: string
  description: string
  creatorId: string
  isPublic: boolean
  memberCount: number
  createdAt: number
  /** 'owner' 圈主 | 'member' 已加入 | 'pending' 待审批 | null 未加入 */
  myStatus: 'owner' | 'member' | 'pending' | null
}

/** 圈子成员 */
export interface CircleMember {
  userId: string
  userName: string
  role: 'owner' | 'member'
  verified: boolean
}

/** 圈子详情响应 */
export interface CircleDetail {
  circle: CommunityCircle
  members: CircleMember[]
  /** 待审批申请（仅圈主可见） */
  pending: { userId: string; userName: string; createdAt: number }[]
}

/** 私信消息 */
export interface CommunityMessage {
  id: string
  fromId: string
  toId: string
  content: string
  isRead: boolean
  createdAt: number // Unix 秒
  /** 是否我发出的 */
  fromMe: boolean
}

/** 私信会话条目 */
export interface MessageConversation {
  peerId: string
  peerName: string
  peerVerified: boolean
  /** 最后一条消息截断预览 */
  lastContent: string
  lastAt: number
  lastFromMe: boolean
  /** 对方发给我的未读数 */
  unread: number
}

/** 管理端举报队列条目（target 为 null 表示内容已被作者删除；message 举报无 postId/isHidden） */
export interface AdminReport {
  id: string
  targetType: 'post' | 'comment' | 'message'
  targetId: string
  reason: string
  detail: string
  createdAt: number
  reporterName: string
  target: {
    authorName: string
    excerpt: string
    isHidden: boolean
    postId?: string
  } | null
}

/** 学习小组 */
export interface StudyTeam {
  id: string
  name: string
  description: string
  creatorId: string
  memberCount: number
  maxMembers: number
  isPublic: boolean
  myRole?: 'leader' | 'member'
  createdAt: number
}

/** 小组成员 */
export interface TeamMember {
  userId: string
  userName: string
  role: 'leader' | 'member'
  joinedAt: number
}

/** 挑战类型 */
export type ChallengeType = 'streak' | 'minutes' | 'problems'

/** 组队挑战 */
export interface TeamChallenge {
  id: string
  teamId: string
  type: ChallengeType
  target: number
  durationDays: number
  startDate: string
  endDate: string
  completedCount: number
  isCompleted: boolean
  myProgress: number
  myCompleted: boolean
  createdAt: number
}

/** 小组详情 */
export interface TeamDetail {
  team: StudyTeam
  members: TeamMember[]
  challenges: TeamChallenge[]
}
