import { on } from '../../router'
import { all, first, run } from '../../db'
import { parseMutedTypes } from '../settings'
import { mapNotification, nowSec, parseCursor, MAX_PAGE } from './shared'

/**
 * 社区广场通知域路由：通知列表（含未读）/ 全部已读 / 单条已读。
 * 由 community/index.ts 的 registerCommunityRoutes 聚合注册。
 * 零逻辑改动：on(...) 块从原 community.ts 逐字搬迁，仅调整 import 路径与包一层 registerNotificationsRoutes()。
 */
export function registerNotificationsRoutes() {
  // 通知列表（含未读数；可选 type 过滤；unreadExcludingMuted 供勿扰红点判定）
  on('GET', '/api/community/notifications', true, async (ctx) => {
    const url = new URL(ctx.request.url)
    const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '') || 20, 1), MAX_PAGE)
    const cursor = url.searchParams.get('cursor') || ''
    const type = url.searchParams.get('type') || ''

    let sql = `
      SELECT n.*, COALESCE(s.user_name, u.username) AS actor_name, s.avatar AS actor_avatar,
        p.image_urls, c.content AS comment_content, c.likes_count AS comment_likes_count,
        (cl.user_id IS NOT NULL) AS comment_liked_by_me
      FROM community_notifications n
      LEFT JOIN users u ON u.id = n.actor_id
      LEFT JOIN user_settings s ON s.user_id = n.actor_id
      LEFT JOIN community_posts p ON p.id = n.post_id
      LEFT JOIN community_comments c ON c.id = n.comment_id
      LEFT JOIN community_likes cl ON cl.target_type = 'comment' AND cl.target_id = n.comment_id AND cl.user_id = ?
      WHERE n.user_id = ? AND n.type != 'message'`
    const params: unknown[] = [ctx.userId, ctx.userId]
    if (type) {
      sql += ' AND n.type = ?'
      params.push(type)
    }
    const c = cursor ? parseCursor(cursor) : null
    if (c) {
      sql += ' AND (n.created_at < ? OR (n.created_at = ? AND n.id < ?))'
      params.push(c.ts, c.ts, c.id)
    }
    sql += ' ORDER BY n.created_at DESC, n.id DESC LIMIT ?'
    params.push(limit + 1)

    const rows = await all<any>(ctx.env, sql, ...params)

    // 关系计算：按 actor_id 去重批量查询双向关注，复用三元表达式得 relation
    const actorIds = [...new Set(rows.map((r: any) => r.actor_id).filter(Boolean))] as string[]
    let myFollowing = new Set<string>(), myFollowers = new Set<string>()
    if (actorIds.length) {
      const ph = actorIds.map(() => '?').join(',')
      const [a, b] = await Promise.all([
        all<{ followee_id: string }>(ctx.env,
          `SELECT followee_id FROM user_follows WHERE follower_id = ? AND followee_id IN (${ph})`, ctx.userId, ...actorIds),
        all<{ follower_id: string }>(ctx.env,
          `SELECT follower_id FROM user_follows WHERE followee_id = ? AND follower_id IN (${ph})`, ctx.userId, ...actorIds)
      ])
      myFollowing = new Set(a.map(r => r.followee_id))
      myFollowers = new Set(b.map(r => r.follower_id))
    }
    for (const r of rows) {
      if (!r.actor_id) { r.relation = 'none'; continue }
      const followedByMe = myFollowing.has(r.actor_id)
      const followsMe = myFollowers.has(r.actor_id)
      r.relation = followedByMe && followsMe ? 'mutual' : followedByMe ? 'following' : followsMe ? 'follower' : 'none'
    }
    // 未读私信由「消息」模块单独承载（messages/unread-count），此处通知未读排除 message 避免重复计数
    const unread = await first<{ n: number }>(ctx.env,
      "SELECT COUNT(*) AS n FROM community_notifications WHERE user_id = ? AND is_read = 0 AND type != 'message'", ctx.userId)
    // 排除被屏蔽类型的未读数（勿扰红点用；无条件计算，客户端按需取用）
    const settingsRow = await first<{ dnd_muted_types: string | null }>(ctx.env,
      'SELECT dnd_muted_types FROM user_settings WHERE user_id = ?', ctx.userId)
    const muted = parseMutedTypes(settingsRow?.dnd_muted_types)
    let unreadExcludingMuted = unread?.n ?? 0
    if (muted.length) {
      const ph = muted.map(() => '?').join(',')
      const r = await first<{ n: number }>(ctx.env,
        `SELECT COUNT(*) AS n FROM community_notifications WHERE user_id = ? AND is_read = 0 AND type != 'message' AND type NOT IN (${ph})`,
        ctx.userId, ...muted)
      unreadExcludingMuted = r?.n ?? 0
    }
    let nextCursor: string | null = null
    if (rows.length > limit) {
      const last = rows[limit - 1] as any
      nextCursor = `${last.created_at}_${last.id}`
    }
    return Response.json({
      items: rows.slice(0, limit).map(mapNotification),
      unreadCount: unread?.n ?? 0,
      unreadExcludingMuted,
      nextCursor
    })
  })

  // 全部已读
  on('PUT', '/api/community/notifications/read-all', true, async (ctx) => {
    await run(ctx.env, 'UPDATE community_notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0', ctx.userId)
    return Response.json({ ok: true })
  })

  // 单条已读
  on('PUT', '/api/community/notifications/:id/read', true, async (ctx) => {
    await run(ctx.env, 'UPDATE community_notifications SET is_read = 1 WHERE id = ? AND user_id = ?',
      ctx.params.id, ctx.userId)
    return Response.json({ ok: true })
  })
}
