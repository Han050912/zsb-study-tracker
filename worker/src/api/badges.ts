import type { Env } from '../index'
import { first } from '../db'

/**
 * 徽章系统：服务端事件驱动发放，user_badges 主键 (user_id, badge_key) 去重保证仅发放一次。
 * 徽章一旦获得永久保留（与成就体系同口径：记录的是「曾达成」，后续回落不回收）。
 * 发放时推送 achievement 通知；重大徽章额外在同一事务内自动创建成就广播帖（ref_type='badge'），
 * 稳定自然键和条件插入保证重复调用不会再发奖，并能补齐旧事务遗漏的通知或广播。
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
const BROADCAST_BADGES: readonly BadgeKey[] = [
  'streak_30',
  'streak_100',
  'likes_100',
  'answer_expert',
  'image_50',
  'team_champion'
]

const nowSec = () => Math.floor(Date.now() / 1000)

/**
 * 构造原子发奖语句。usersSql 必须是内部参数化 SELECT，返回 user_id；所有条件在提交时判断。
 * 徽章、通知和广播均在调用方 batch 内，构造阶段绝不抢先写库；稳定键使重试和并发幂等。
 * 同时兼容修复前已经落库但效果缺失的徽章（按旧通知文案/广播自然键去重）。
 */
export function badgeAwardStatements(
  env: Env,
  key: BadgeKey,
  usersSql: string,
  params: unknown[]
): D1PreparedStatement[] {
  const content = `🎖️ 你获得了徽章「${BADGE_DEFS[key]}」`
  const now = nowSec()
  const stmts: D1PreparedStatement[] = [
    env.DB.prepare(
      `WITH recipients AS (${usersSql})
      INSERT OR IGNORE INTO user_badges (user_id, badge_key, awarded_at)
      SELECT DISTINCT user_id, ?, ? FROM recipients
    `
    ).bind(...params, key, now),
    env.DB.prepare(
      `WITH recipients AS (${usersSql})
      INSERT OR IGNORE INTO community_notifications (id, user_id, type, content, is_read, created_at)
      SELECT 'badge:' || ? || ':' || r.user_id, r.user_id, 'achievement', ?, 0, ? FROM recipients r
      WHERE NOT EXISTS (SELECT 1 FROM community_notifications n
        WHERE n.user_id = r.user_id AND n.type = 'achievement' AND n.content = ?)
    `
    ).bind(...params, key, content, now, content)
  ]

  // 成就广播帖：服务端模板内容（跳过敏感词校验）、不发放积分（不走发帖路由防刷分）、正常进公共广场。
  // 插入以 (ref_type='badge', ref_id='<key>:<userId>') 为自然幂等键，补发路径不会重复建帖
  if (BROADCAST_BADGES.includes(key)) {
    stmts.push(
      env.DB.prepare(
        `WITH recipients AS (${usersSql})
        INSERT OR IGNORE INTO community_posts
          (id, user_id, type, content, tags, image_urls, ref_type, ref_id, created_at, updated_at)
        SELECT 'badge:' || ? || ':' || r.user_id, r.user_id, 'achievement', ?, '[]', '[]',
          'badge', ? || ':' || r.user_id, ?, ? FROM recipients r
        WHERE NOT EXISTS (SELECT 1 FROM community_posts p
          WHERE p.ref_type = 'badge' AND p.ref_id = ? || ':' || r.user_id)
      `
      ).bind(...params, key, `🎖️ 达成成就「${BADGE_DEFS[key]}」！每一份坚持都算数，继续加油！`, key, now, now, key)
    )
  }
  return stmts
}

/** 保留现有调用签名；只构造语句，调用者必须将返回值并入业务 batch。 */
export async function awardBadge(env: Env, userId: string, key: BadgeKey): Promise<D1PreparedStatement[]> {
  return badgeAwardStatements(env, key, 'SELECT ? AS user_id', [userId])
}

/** 门槛类徽章的快捷判定：已持有则跳过统计查询（省一次 COUNT/SUM） */
export async function hasBadge(env: Env, userId: string, key: BadgeKey): Promise<boolean> {
  return !!(await first(env, 'SELECT 1 AS x FROM user_badges WHERE user_id = ? AND badge_key = ?', userId, key))
}
