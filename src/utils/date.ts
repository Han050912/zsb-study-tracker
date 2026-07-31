import dayjs from 'dayjs'

export const today = () => dayjs().format('YYYY-MM-DD')
export const fmtDate = (d: string | Date) => dayjs(d).format('YYYY-MM-DD')
export const now = () => Date.now()

export function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

/** 计算两个日期间的天数差 */
export function daysBetween(from: string, to: string): number {
  return dayjs(to).startOf('day').diff(dayjs(from).startOf('day'), 'day')
}

/** 昨日日期 */
export const yesterday = () => dayjs().subtract(1, 'day').format('YYYY-MM-DD')

export function formatMinutes(min: number): string {
  if (min < 60) return `${Math.round(min)}分钟`
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  return m ? `${h}小时${m}分` : `${h}小时`
}
