/** 提醒时间接受 24 小时制 HH:mm；空值表示不设置提醒。 */
export function isValidTodoTime(value: string): boolean {
  return value === '' || /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)
}

/** 任务归属日期；拒绝空值和会被 Date 自动进位的日期。 */
export function isValidTodoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const timestamp = Date.parse(`${value}T00:00:00Z`)
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value
}

/** 所选任务日期的 HH:mm → 本地提醒时间戳，与时间控件的展示口径一致。 */
export function todoTimeOnDateTs(value: string, date: string): number | undefined {
  if (!value || !isValidTodoTime(value) || !isValidTodoDate(date)) return undefined
  return new Date(`${date}T${value}:00`).getTime()
}

/** HH:mm → 当日时间戳；保留“现在”所选分钟，已到点的提醒由调度器立即补发。 */
export function todoTimeToTodayTs(value: string): number | undefined {
  if (!value || !isValidTodoTime(value)) return undefined
  const [hour, minute] = value.split(':').map(Number)
  const date = new Date()
  date.setHours(hour, minute, 0, 0)
  return date.getTime()
}
