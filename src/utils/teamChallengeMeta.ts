import { Flame, Timer, BookOpen } from '@lucide/vue'
import type { ChallengeType, TeamChallenge } from '../types'

export const TYPE_LABEL: Record<ChallengeType, string> = { streak: '连续打卡', minutes: '学习时长', problems: '刷题数' }
export const TYPE_UNIT: Record<ChallengeType, string> = { streak: '天', minutes: '分钟', problems: '题' }
/** 各挑战类型的图标 / 说明 / 快捷预设 / 占位提示，让目标值与单位一一对应，避免三种类型混用同一输入框 */
export const TYPE_META: Record<ChallengeType, { icon: any; desc: string; presets: number[]; placeholder: string }> = {
  streak: { icon: Flame, desc: '坚持每日打卡', presets: [7, 14, 21, 30], placeholder: '如 7' },
  minutes: { icon: Timer, desc: '累计专注时长', presets: [60, 120, 300, 600], placeholder: '如 120' },
  problems: { icon: BookOpen, desc: '累计刷题数量', presets: [50, 100, 200, 500], placeholder: '如 100' }
}
export const STATUS_LABEL = {
  upcoming: '未开始',
  active: '进行中',
  cancelled: '已取消',
  completed: '全员达标',
  ended: '已结束'
} as const
export type ChallengeStatus = keyof typeof STATUS_LABEL

export function todayUtc8(): string {
  return new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10)
}

export function challengeStatus(c: TeamChallenge): ChallengeStatus {
  if (c.isCancelled) return 'cancelled'
  if (c.isCompleted) return 'completed'
  const t = todayUtc8()
  if (t < c.startDate) return 'upcoming'
  if (t > c.endDate) return 'ended'
  return 'active'
}
