/** 学习搭子域 */

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
  minutes: number // 本周学习时长（分钟）
  problems: number // 本周刷题数
  pomodoroMinutes: number // 本周番茄专注时长（分钟）
  streak: number // 连续打卡天数
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
  /** 计时模式（双方一致）：countdown=倒计时（设定专注分钟走完自动完成），countup=正计时（从 0 递增，手动完成） */
  mode: 'countdown' | 'countup'
  myState: 'idle' | 'focus' | 'done'
  myMinutes: number
  partnerState: 'idle' | 'focus' | 'done'
  partnerMinutes: number
  /** 我的累计在线秒数（墙钟，暂停不计入） */
  myOnlineSeconds: number
  /** 对方累计在线秒数 */
  partnerOnlineSeconds: number
  /** 我的当前阶段已消耗秒数（用于刷新/重进恢复剩余） */
  myElapsedSeconds: number
  /** 对方当前阶段已消耗秒数（用于展示对方进度） */
  partnerElapsedSeconds: number
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
  endedAt: number // Unix 秒
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
