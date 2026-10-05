export type GoalKey = 'dailyGoalMinutes' | 'wordGoal' | 'problemGoal'

const GOAL_LABELS = { dailyGoalMinutes: '每日学习时长', wordGoal: '每日单词量', problemGoal: '每日做题量' }

export function settingsGoalError(key: GoalKey, value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1)
    return `${GOAL_LABELS[key]}请输入大于 0 的整数`
  if (key === 'dailyGoalMinutes' && value > 1440) return '每日学习时长不能超过 1440 分钟'
  return null
}

export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const time = Date.parse(`${value}T00:00:00Z`)
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value
}
