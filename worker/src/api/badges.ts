import type { Env } from '../index'
import { run, first, uid } from '../db'
import { notifyStatement } from './community'

/**
 * 徽章系统：服务端事件驱动发放，user_badges 主键 (user_id, badge_key) 去重保证仅发放一次。
 * 徽章一旦获得永久保留（与成就体系同口径：记录的是「曾达成」，后续回落不回收）。
 * 发放时推送 achievement 通知；前端徽章目录见 src/data/defaults.ts COMMUNITY_BADGES（名称需与此处一致）。
 */

export const BADGE_DEFS = {
  first_post: '首次发帖',
  first_question: '首次提问',
  streak_7: '连续打卡 7 天',
  streak_30: '连续打卡 30 天',
  streak_100: '连续打卡 100 天',
  likes_100: '百赞达人',
  answer_expert: '答疑专家',
  image_50: '图片达人'
} as const

export type BadgeKey = keyof typeof BADGE_DEFS

const nowSec = () => Math.floor(Date.now() / 1000)

/** 发放徽章（幂等）；首次获得时推送 achievement 通知 */
export async function awardBadge(env: Env, userId: string, key: BadgeKey): Promise<void> {
  const res = await run(env,
    'INSERT OR IGNORE INTO user_badges (user_id, badge_key, awarded_at) VALUES (?, ?, ?)',
    userId, key, nowSec())
  if (res.meta.changes) {
    await notifyStatement(env, {
      userId, type: 'achievement', content: `🎖️ 你获得了徽章「${BADGE_DEFS[key]}」`
    }).run()
  }
}

/** 门槛类徽章的快捷判定：已持有则跳过统计查询（省一次 COUNT/SUM） */
export async function hasBadge(env: Env, userId: string, key: BadgeKey): Promise<boolean> {
  return !!(await first(env, 'SELECT 1 AS x FROM user_badges WHERE user_id = ? AND badge_key = ?', userId, key))
}
