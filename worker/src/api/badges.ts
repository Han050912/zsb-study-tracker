import type { Env } from '../index'
import { first, uid } from '../db'
import { notifyStatement } from './community'

/**
 * 徽章系统：服务端事件驱动发放，user_badges 主键 (user_id, badge_key) 去重保证仅发放一次。
 * 徽章一旦获得永久保留（与成就体系同口径：记录的是「曾达成」，后续回落不回收）。
 * 发放时推送 achievement 通知；重大徽章额外在同一事务内自动创建成就广播帖（ref_type='badge'），
 * 因 awardBadge 幂等（重复持有直接返回空数组），广播帖天然只发一次。
 * 前端徽章目录见 src/data/defaults.ts COMMUNITY_BADGES（名称需与此处一致）。
 */

export const BADGE_DEFS = {
  first_post: '首次发帖',
  first_question: '首次提问',
  streak_7: '连续打卡 7 天',
  streak_30: '连续打卡 30 天',
  streak_100: '连续打卡 100 天',
  likes_100: '百赞达人',
  answer_expert: '答疑专家',
  image_50: '图片达人',
  team_champion: '团队冠军'
} as const

export type BadgeKey = keyof typeof BADGE_DEFS

/** 触发成就广播帖的重大徽章（排除首帖/首次提问/连续 7 天等低价值事件，避免刷屏） */
const BROADCAST_BADGES: readonly BadgeKey[] = ['streak_30', 'streak_100', 'likes_100', 'answer_expert', 'image_50', 'team_champion']

const nowSec = () => Math.floor(Date.now() / 1000)

/** 发放徽章（幂等）；首次获得时推送 achievement 通知；重大徽章附带成就广播帖语句；返回批处理语句数组（供外部事务调用） */
export async function awardBadge(env: Env, userId: string, key: BadgeKey): Promise<D1PreparedStatement[]> {
  // 先检查是否已有（幂等）
  const exists = await first(env, 'SELECT 1 AS x FROM user_badges WHERE user_id = ? AND badge_key = ?', userId, key)
  if (exists) return []

  const stmts: D1PreparedStatement[] = [
    env.DB.prepare('INSERT OR IGNORE INTO user_badges (user_id, badge_key, awarded_at) VALUES (?, ?, ?)')
      .bind(userId, key, nowSec()),
    notifyStatement(env, {
      userId, type: 'achievement', content: `🎖️ 你获得了徽章「${BADGE_DEFS[key]}」`
    })
  ]

  // 成就广播帖：服务端模板内容（跳过敏感词校验）、不发放积分（不走发帖路由防刷分）、正常进公共广场
  if (BROADCAST_BADGES.includes(key)) {
    stmts.push(env.DB.prepare(
      "INSERT INTO community_posts (id, user_id, type, content, tags, image_urls, ref_type, ref_id, created_at, updated_at) " +
      "VALUES (?, ?, 'achievement', ?, '[]', '[]', 'badge', ?, ?, ?)"
    ).bind(uid(), userId, `🎖️ 达成成就「${BADGE_DEFS[key]}」！每一份坚持都算数，继续加油！`,
      `${key}:${userId}`, nowSec(), nowSec()))
  }
  return stmts
}

/** 门槛类徽章的快捷判定：已持有则跳过统计查询（省一次 COUNT/SUM） */
export async function hasBadge(env: Env, userId: string, key: BadgeKey): Promise<boolean> {
  return !!(await first(env, 'SELECT 1 AS x FROM user_badges WHERE user_id = ? AND badge_key = ?', userId, key))
}
