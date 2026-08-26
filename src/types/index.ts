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
  type: string // 题型跟随科目动态变化：数学/英语/自定义科目各自独立题型列表
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

/** 社区通知类型 */
export type NotificationType = 'like' | 'comment' | 'follow' | 'achievement' | 'message' | 'system' | 'partner'

/** 通知点击跳转目标类型 */
export type NotificationTargetType = 'post' | 'user' | 'message' | 'team' | 'circle' | 'partner' | 'partner_share' | 'partner_comment' | 'partner_study' | 'partner_plan' | 'partner_review' | 'partner_remind' | 'partner_unbind' | 'partner_weekly'

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
  /** 墨墨背单词开放 API Token（仅写入时传明文；读取永不回传） */
  maimemoToken?: string
  /** 是否已配置墨墨开放 API Token（读取用，不回传明文） */
  maimemoConnected?: boolean
  onboarded: boolean
  /** 参与学习进步榜（社区展示昵称与学习时长/刷题数排名；默认关闭） */
  joinProgressBoard: boolean
  /** 主页可见性：public 所有人 / login 登录(默认) / private 仅自己 */
  profileVisibility: 'public' | 'login' | 'private'
  /** 自定义头像相对 URL（/api/avatar/<file>；空 = 首字母兜底） */
  avatar: string
  /** 个人简介（≤100 字，我的页/访客主页展示） */
  bio: string
  /** 勿扰模式总开关 */
  doNotDisturb: boolean
  /** 勿扰开始时间 'HH:mm'（空 = 全天勿扰） */
  dndStartTime: string
  /** 勿扰结束时间 'HH:mm'（空 = 全天勿扰） */
  dndEndTime: string
  /** 勿扰期间屏蔽的通知类型 */
  dndMutedTypes: NotificationType[]
  /** 勿扰期间是否屏蔽消息 */
  dndMuteMessage: boolean
  /** 允许搭子查看我的学习数据（周报对比/定向分享；默认关闭） */
  partnerShareEnabled: boolean
  /** 允许搭子向我发送学习鼓励提醒（默认开启） */
  partnerRemindEnabled: boolean
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
  /** 作者自定义头像相对 URL（未设置 = undefined，前端回退首字母） */
  userAvatar?: string
  type: PostType
  content: string
  tags: string[]
  /** 配图路径列表（/api/community/images/<id>，最多 9 张），经 imageUrl() 转绝对地址 */
  imageUrls: string[]
  /** 列表缩略图路径（对应 imageUrls 加 ?thumb=1，未生成缩略图时回退原图） */
  imageThumbs: string[]
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
  dislikesCount: number
  commentsCount: number
  isPinned: boolean
  isHidden: boolean
  /** 软违规待审标记（命中软敏感词；仅作者/管理员可见时返回 true） */
  isFlagged: boolean
  likedByMe: boolean
  dislikedByMe: boolean
  createdAt: number // Unix 秒
}

/** 社区评论；parentId 为空为一级评论，否则为二级回复（最多二级） */
export interface CommunityComment {
  id: string
  postId: string
  userId: string
  userName: string
  /** 评论作者自定义头像相对 URL（未设置 = undefined） */
  userAvatar?: string
  parentId?: string
  content: string
  /** 评论配图路径列表（最多 3 张），经 imageUrl() 转绝对地址 */
  imageUrls: string[]
  /** 作者是否为认证专家（蓝 V） */
  userVerified: boolean
  likesCount: number
  dislikesCount: number
  /** 是否被楼主采纳为最佳答案 */
  isAccepted: boolean
  isHidden: boolean
  /** 软违规待审标记（命中软敏感词；仅作者/管理员可见时返回 true） */
  isFlagged: boolean
  likedByMe: boolean
  dislikedByMe: boolean
  createdAt: number // Unix 秒
  /** 前端组装的二级回复 */
  replies?: CommunityComment[]
}

/** 社区通知 */
export interface CommunityNotification {
  id: string
  type: NotificationType
  actorId?: string
  actorName?: string
  /** 触发者自定义头像相对 URL（未设置 = undefined） */
  actorAvatar?: string
  postId?: string
  commentId?: string
  /** 点击跳转目标类型（后端通知接口返回） */
  targetType?: NotificationTargetType
  /** 点击跳转目标 id */
  targetId?: string
  content: string
  isRead: boolean
  createdAt: number // Unix 秒
  /** 触发者与我的关系（无 actor_id 时为 none） */
  relation?: RelationStatus
  /** 帖子缩略图路径（对应 imageUrls 首图加 ?thumb=1，无图帖为 undefined） */
  postThumb?: string
  /** 评论文字（type='comment' 时） */
  commentContent?: string
  /** 当前用户是否已赞该评论 */
  commentLikedByMe?: boolean
  /** 评论点赞数 */
  commentLikesCount?: number
}

/** 今日打卡榜条目 */
export interface LeaderboardTodayEntry {
  userId: string
  userName: string
  /** 自定义头像相对 URL（未设置 = undefined） */
  userAvatar?: string
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
  userId: string
  userName: string
  /** 自定义头像相对 URL（未设置 = undefined） */
  userAvatar?: string
  streak: number
  totalPoints: number
  /** 认证专家（蓝 V） */
  verified: boolean
}

export interface CommunityLeaderboard {
  today: LeaderboardTodayEntry[]
  streak: LeaderboardStreakEntry[]
}

/** 进步榜条目（本周时长 / 本月刷题 TOP 50，仅参与用户） */
export interface ProgressBoardEntry {
  userId: string
  userName: string
  /** 自定义头像相对 URL（未设置 = undefined） */
  userAvatar?: string
  verified: boolean
  totalPoints: number
  value: number
  isMe: boolean
}

/** 本人排名信息（未参与时 rank/percentile 为 null） */
export interface ProgressBoardMe {
  value: number
  rank: number | null
  percentile: number | null
}

/** 学习进度对比（进步榜）响应 */
export interface ProgressBoardData {
  joined: boolean
  weekMinutes: { list: ProgressBoardEntry[]; me: ProgressBoardMe }
  monthProblems: { list: ProgressBoardEntry[]; me: ProgressBoardMe }
}

/** 热门话题运营位条目（pinned = 管理员置顶） */
export interface HotTopic {
  text: string
  tag: string
  count: number
  pinned: boolean
}

/** 热门话题干预名单条目（管理员配置） */
export interface HotTopicOverride {
  id: string
  text: string
  tag: string
  action: 'pin' | 'block'
  createdAt: number
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

/** 社交关系状态：互关 / 我已关注 / 对方关注我（待回关） / 无关系 */
export type RelationStatus = 'mutual' | 'following' | 'follower' | 'none'

/** 粉丝/关注/互关列表项 */
export interface FollowListItem {
  userId: string
  userName: string
  avatar?: string
  verified: boolean
  bio: string
  followedByMe: boolean
  followsMe: boolean
  relation: RelationStatus
}

export interface FollowListResult {
  items: FollowListItem[]
  nextCursor: string | null
}

/** 社区用户资料卡（公开荣誉信息，不含私有学习数据） */
export interface CommunityUserProfile {
  userId: string
  /** 对外唯一用户 ID（8 位随机短码） */
  userCode?: string
  userName: string
  /** 自定义头像相对 URL（未设置 = undefined） */
  avatar?: string
  /** 私密主页降级视图：仅含公开子集（昵称/头像/蓝V），积分/徽章/关注等字段缺省 */
  profilePrivate?: boolean
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
  /** 个人简介 */
  bio: string
  /** 该用户是否关注了我 */
  followsMe: boolean
  /** 纯帖子数（公开广场帖口径，区别于 postCount 帖子+评论合计） */
  threadsCount: number
  followingCount: number
  mutualCount: number
  /** 我点赞过的帖子数（仅本人请求时返回） */
  likedCount?: number
  /** 我与该用户的关系 */
  relation: RelationStatus
}

/** 精确查找用户（lookup）返回的用户卡片 */
export interface UserLookupResult {
  userId: string
  userCode: string
  userName: string
  avatar?: string
  verified: boolean
  expertise: string
  bio: string
  followedByMe: boolean
  followsMe: boolean
  relation: RelationStatus
  partnerStatus: PartnerStatus
  profilePrivate?: boolean
}

/** 学习搭子关系状态（lookup 视角：当前用户 vs 目标用户） */
export type PartnerStatus = 'self' | 'none' | 'accepted' | 'pending_sent' | 'pending_received' | 'rejected'

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
  /** 自定义头像相对 URL（未设置 = undefined） */
  userAvatar?: string
}

/** 圈子详情响应 */
export interface CircleDetail {
  circle: CommunityCircle
  members: CircleMember[]
  /** 待审批申请（仅圈主可见） */
  pending: { userId: string; userName: string; createdAt: number; userAvatar?: string }[]
}

/** 私信消息 */
export interface CommunityMessage {
  id: string
  fromId: string
  toId: string
  content: string
  /** 私信配图相对 URL 列表（最多 3 张；未设置 = 纯文字） */
  imageUrls?: string[]
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
  /** 对方自定义头像相对 URL（未设置 = undefined） */
  peerAvatar?: string
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
  /** 自定义头像相对 URL（未设置 = undefined） */
  userAvatar?: string
}

/** 入组申请（待审核） */
export interface TeamJoinRequest {
  userId: string
  userName: string
  userAvatar?: string
  createdAt: number
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
  isCancelled: boolean
  remainingDays?: number
  createdAt: number
}

/** 小组详情 */
export interface TeamDetail {
  team: StudyTeam
  members: TeamMember[]
  challenges: TeamChallenge[]
  inviteCode?: string | null
  inviteCodeExpiresAt?: number | null
  myJoinRequest?: boolean
}

/** 学习搭子推荐条目 */
export interface PartnerSuggestion {
  userId: string
  userName: string
  verified: boolean
  /** 自定义头像相对 URL（未设置 = undefined） */
  userAvatar?: string
  totalPoints: number
  score: number
  reasons: string[]
}

/** 学习搭子 / 收到的请求条目 */
export interface PartnerItem {
  reqId: string
  userId: string
  userName: string
  verified: boolean
  /** 自定义头像相对 URL（未设置 = undefined） */
  userAvatar?: string
  totalPoints: number
}

// ========== 学习搭子协作 ==========

/** 搭子周报对比数据 */
export interface PartnerWeeklyStats {
  minutes: number          // 本周学习时长（分钟）
  problems: number         // 本周刷题数
  pomodoroMinutes: number  // 本周番茄专注时长（分钟）
  streak: number           // 连续打卡天数
}
export interface PartnerWeeklyReport {
  shared: boolean
  weekStart?: string
  weekEnd?: string
  partnerName?: string
  mine?: PartnerWeeklyStats
  theirs?: PartnerWeeklyStats
}

/** 错题/笔记分享列表项 */
export interface PartnerShareItem {
  id: string
  ownerId: string
  ownerName: string
  partnerId: string
  partnerName: string
  itemType: 'error' | 'note'
  itemId: string
  commentCount: number
  createdAt: number
}

/** 分享批注 */
export interface PartnerShareComment {
  id: string
  userId: string
  userName: string
  content: string
  createdAt: number
}

/** 分享详情 */
export interface PartnerShareDetail {
  id: string
  ownerId: string
  ownerName: string
  partnerId: string
  partnerName: string
  itemType: 'error' | 'note'
  itemId: string
  item: unknown
  createdAt: number
  comments: PartnerShareComment[]
}

/** 分享详情中的笔记条目 */
export interface PartnerShareNoteItem {
  id: string
  title: string
  content: string
  subjectId: string
  tags: string[]
  type?: 'pdf'
}

/** 分享详情中的错题条目（后端 SQL 别名直出，snake_case；error_questions 无 note 列） */
export interface PartnerShareErrorItem {
  id: string
  question: string
  answer?: string | null
  image?: string | null
  wrong_count?: number
}

/** 双人番茄自习室会话 */
export interface PartnerStudySession {
  id: string
  status: 'active' | 'done'
  partnerId: string
  partnerName: string
  /** 对方自定义头像相对 URL（未设置 = undefined，前端回退首字母） */
  partnerAvatar?: string
  /** 专注时长（分钟，双方一致） */
  focusMinutes: number
  /** 休息时长（分钟，双方一致） */
  breakMinutes: number
  myState: 'idle' | 'focus' | 'break' | 'done'
  myMinutes: number
  partnerState: 'idle' | 'focus' | 'break' | 'done'
  partnerMinutes: number
  /** 我的累计在线秒数（墙钟，暂停不计入） */
  myOnlineSeconds: number
  /** 对方累计在线秒数 */
  partnerOnlineSeconds: number
  /** 我的当前阶段已消耗秒数（用于刷新/重进恢复剩余） */
  myElapsedSeconds: number
  /** 对方是否正在计时（true=计时中，false=暂停/未开始） */
  partnerRunning: boolean
}

/** 历史开黑记录 */
export interface PartnerStudyRecord {
  id: string
  partnerId: string
  partnerName: string
  partnerAvatar?: string
  startedAt: number // Unix 秒
  endedAt: number   // Unix 秒
  myOnlineSeconds: number
  partnerOnlineSeconds: number
}

/** 协作备考计划列表项 */
export interface PartnerPlan {
  id: string
  title: string
  partnerId: string
  partnerName: string
  taskTotal: number
  myDone: number
  createdAt: number
}

/** 计划任务 */
export interface PartnerPlanTask {
  id: string
  title: string
  phase: string
  myDone: boolean
  partnerDone: boolean
  createdAt: number
}

/** 计划详情 */
export interface PartnerPlanDetail {
  id: string
  title: string
  partnerId: string
  partnerName: string
  tasks: PartnerPlanTask[]
}

/** 复盘邀约 */
export interface PartnerReview {
  id: string
  partnerId: string
  partnerName: string
  scheduledAt: number
  status: 'pending' | 'accepted' | 'done'
  note: string
  isFrom: boolean
  createdAt: number
}

/** 推荐关注用户条目 */
export interface RecommendUser {
  userId: string
  userName: string
  verified: boolean
  /** 自定义头像相对 URL（未设置 = undefined） */
  userAvatar?: string
  totalPoints: number
  reason: string
}

/** 个性化推荐响应 */
export interface RecommendFeedData {
  posts: CommunityPost[]
  circles: CommunityCircle[]
  users: RecommendUser[]
}

/** 反馈问题类型 */
export type FeedbackType = 'feature' | 'bug' | 'experience' | 'other'
export type FeedbackStatus = 'pending' | 'resolved'
export interface Feedback {
  id: string
  type: FeedbackType
  content: string
  contact: string
  imageUrls: string[]
  githubIssueUrl: string | null
  status: FeedbackStatus
  createdAt: number
  userName?: string
}
