import type { Settings } from '../types'

/** 'HH:mm' → 分钟数；空串/非法返回 -1 */
function toMin(hhmm: string): number {
  if (!hhmm) return -1
  const parts = hhmm.split(':')
  if (parts.length !== 2) return -1
  const h = Number(parts[0])
  const m = Number(parts[1])
  if (Number.isNaN(h) || Number.isNaN(m)) return -1
  return h * 60 + m
}

/**
 * 勿扰是否生效（客户端本地时间判定）：
 * - 开关关 → 不生效；
 * - 起止任一为空（或相等）→ 全天勿扰；
 * - start < end → [start, end)；
 * - start > end → 跨天 [start, 24:00) ∪ [0:00, end)。
 */
export function isDndActive(s: Settings): boolean {
  if (!s.doNotDisturb) return false
  const start = toMin(s.dndStartTime)
  const end = toMin(s.dndEndTime)
  if (start < 0 || end < 0 || start === end) return true
  const now = new Date()
  const cur = now.getHours() * 60 + now.getMinutes()
  if (start < end) return cur >= start && cur < end
  return cur >= start || cur < end
}
