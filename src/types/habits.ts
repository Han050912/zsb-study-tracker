/** 习惯域 */

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
  /** 记录级 LWW 时间戳（同步运行时字段，不进 UI） */
  updatedAt?: number
}
