/** 番茄钟域 */

/** 单次番茄完成记录（最近完成板块明细） */
export interface PomodoroRecord {
  id: string
  date: string
  /** 完成时刻时间戳 */
  time: number
  minutes: number
  description: string
  /** 'solo' 单人 | 'party' 双人开黑 */
  source: 'solo' | 'party'
  /** 开黑搭子昵称快照（source='party' 时有值） */
  partnerName?: string
  /** 记录级 LWW 时间戳（同步运行时字段，不进 UI） */
  updatedAt?: number
}

/** 番茄钟统计 */
export interface PomodoroStat {
  /** 日统计条目；updatedAt 为 `day:<date>` 键的 LWW 时间戳 */
  daily: Record<string, PomodoroDailyStat>
  /** 打断列表：updatedAt 为运行时字段（T5 约定：`itr:<date>` 键的 LWW 时间戳 = 当日各行最大 updatedAt），类型上不声明 */
  interruptions: { date: string; reason: string; time: number }[]
  records: PomodoroRecord[]
}

/** 番茄日统计（pomodoro.daily 的条目） */
export interface PomodoroDailyStat {
  count: number
  minutes: number
  interruptions: number
  /** 记录级 LWW 时间戳（同步运行时字段，不进 UI） */
  updatedAt?: number
}
