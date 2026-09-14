/** 社区域：通知/帖子/评论/榜单/圈子/私信/关注/推荐 */

/** 社区通知类型 */
export type NotificationType = 'like' | 'comment' | 'follow' | 'achievement' | 'message' | 'system' | 'partner'

/** 通知点击跳转目标类型 */
export type NotificationTargetType =
  | 'post'
  | 'user'
  | 'message'
  | 'team'
  | 'circle'
  | 'partner'
  | 'partner_share'
  | 'partner_comment'
  | 'partner_study'
  | 'partner_plan'
  | 'partner_review'
  | 'partner_remind'
  | 'partner_unbind'
  | 'partner_weekly'

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
