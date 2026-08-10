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

/** 相对时间（入参为 Unix 秒）：刚刚 / n 分钟前 / n 小时前 / n 天前 / YYYY-MM-DD */
export function fromNow(sec: number): string {
  const diff = Math.floor(Date.now() / 1000) - sec
  if (diff < 60) return '刚刚'
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`
  if (diff < 7 * 86400) return `${Math.floor(diff / 86400)} 天前`
  return dayjs(sec * 1000).format('YYYY-MM-DD')
}
