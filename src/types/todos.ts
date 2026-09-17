/** 待办域 */

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
  /** 记录级 LWW 时间戳（同步运行时字段，不进 UI） */
  updatedAt?: number
}
