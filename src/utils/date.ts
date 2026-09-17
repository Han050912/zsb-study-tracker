/**
 * 业务日期统一口径：UTC+8（issue #20）。
 *
 * 用户群固定为国内考生，服务端的派生积分 / streak / 徽章判定一律按 UTC+8
 * （worker/src/db.ts 的 utc8Today），前端必须同口径：否则设备时区非 UTC+8 时
 * （出国、系统时区被改、桌面端时区异常），客户端写入的「今天」与服务端认定的「今天」
 * 不是同一天，导致「今日学习满 60 分钟 +3」等奖励始终不发或错位。
 *
 * 单点定义：`businessDate` 是前端唯一的业务日期实现（纯 Date 算术，不依赖系统时区、
 * 不引入 dayjs 插件或新依赖），与 worker/src/db.ts 的 utc8Today() 完全等价；
 * 其他文件禁止再自行拼接 UTC+8 偏移，一律 import 本模块。
 */
const UTC8_OFFSET_MS = 8 * 3600_000

/** 时间戳（毫秒，默认当前时刻）→ UTC+8 业务日期 YYYY-MM-DD */
export function businessDate(ts: number = Date.now()): string {
  // toISOString 恒按 UTC 输出，故结果与系统时区无关
  return new Date(ts + UTC8_OFFSET_MS).toISOString().slice(0, 10)
}

/** 今日（UTC+8） */
export const today = () => businessDate()

/** 昨日（UTC+8） */
export const yesterday = () => businessDate(Date.now() - 86400_000)

export const now = () => Date.now()

export function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

/** 计算两个业务日期间的天数差（按 UTC 零点解析，与系统时区 / 夏令时无关） */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400_000)
}

export function formatMinutes(min: number): string {
  if (min < 60) return `${Math.round(min)}分钟`
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  return m ? `${h}小时${m}分` : `${h}小时`
}

/** 相对时间（入参为 Unix 秒）：刚刚 / n 分钟前 / n 小时前 / n 天前 / YYYY-MM-DD（UTC+8） */
export function fromNow(sec: number): string {
  const diff = Math.floor(Date.now() / 1000) - sec
  if (diff < 60) return '刚刚'
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`
  if (diff < 7 * 86400) return `${Math.floor(diff / 86400)} 天前`
  return businessDate(sec * 1000)
}
