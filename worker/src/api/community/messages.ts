import { z } from 'zod'
import { on } from '../../router'
import { all, first, run, batch, uid, HttpError } from '../../db'
import { parseBody, trimMax, imageUrlsSchema } from '../../schemas'
import { rateLimit } from '../../middleware/rateLimit'
import { IMAGE_MAX_PER_MESSAGE } from '../uploads'
import { assertCleanAsync } from '../sensitive'
import { parseStrArray, nowSec } from './shared'

/**
 * 社区广场私信域路由：会话列表 / 消息记录 / 发送私信 / 未读总数。
 * 由 community/index.ts 的 registerCommunityRoutes 聚合注册。
 * 零逻辑改动：on(...) 块从原 community.ts 逐字搬迁，仅调整 import 路径与包一层 registerMessagesRoutes()。
 */
export function registerMessagesRoutes() {
  // 会话列表：每个对话方的最新一条消息 + 未读数（按最新消息倒序）
  on('GET', '/api/community/messages/conversations', true, async (ctx) => {
    // 用相关方的最大 created_at 分组聚合；未读数仅统计「发给我且未读」
    const rows = await all<any>(ctx.env, `
      SELECT m.*, COALESCE(s.user_name, u.username) AS peer_name, u.verified AS peer_verified,
        s.avatar AS peer_avatar
      FROM community_messages m
      JOIN (
        SELECT CASE WHEN from_id = ? THEN to_id ELSE from_id END AS peer, MAX(created_at) AS latest
        FROM community_messages WHERE from_id = ? OR to_id = ?
        GROUP BY peer
      ) t ON t.latest = m.created_at
        AND (t.peer = CASE WHEN m.from_id = ? THEN m.to_id ELSE m.from_id END)
      JOIN users u ON u.id = t.peer
      LEFT JOIN user_settings s ON s.user_id = t.peer
      ORDER BY m.created_at DESC
      LIMIT 100`, ctx.userId, ctx.userId, ctx.userId, ctx.userId)
    const unreadRows = await all<{ from_id: string; n: number }>(ctx.env,
      'SELECT from_id, COUNT(*) AS n FROM community_messages WHERE to_id = ? AND is_read = 0 GROUP BY from_id', ctx.userId)
    const unreadMap = new Map(unreadRows.map(r => [r.from_id, r.n]))
    // 同一对话方收发消息若落在同一秒，JOIN 可能带出多行；按 peer 去重只保留最新一行
    const seenPeers = new Set<string>()
    return Response.json({
      conversations: rows
        .map(r => {
          const peerId = r.from_id === ctx.userId ? r.to_id : r.from_id
          return {
            peerId,
            peerName: r.peer_name || '升本人',
            peerVerified: !!r.peer_verified,
            peerAvatar: r.peer_avatar ?? undefined,
            lastContent: (r.content || (r.image_urls ? '[图片]' : '')).slice(0, 60),
            lastAt: r.created_at,
            lastFromMe: r.from_id === ctx.userId,
            unread: unreadMap.get(peerId) ?? 0
          }
        })
        .filter(c => (seenPeers.has(c.peerId) ? false : seenPeers.add(c.peerId)))
    })
  })

  // 与某用户的消息记录（倒序游标分页；打开即把对方发来的消息标为已读）
  on('GET', '/api/community/messages/with/:peerId', true, async (ctx) => {
    const peerId = ctx.params.peerId
    const peer = await first<{ id: string }>(ctx.env, 'SELECT id FROM users WHERE id = ?', peerId)
    if (!peer) throw new HttpError(404, '用户不存在')
    const url = new URL(ctx.request.url)
    const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '') || 30, 1), 50)
    const cursor = url.searchParams.get('cursor') || ''
    const params: unknown[] = [ctx.userId, peerId, peerId, ctx.userId]
    let where = '((from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?))'
    if (cursor) { where += ' AND created_at < ?'; params.push(Number(cursor)) }
    const rows = await all<any>(ctx.env,
      `SELECT * FROM community_messages WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ${limit + 1}`, ...params)
    const items = rows.slice(0, limit)
    // 标为已读（对方发来的未读消息），返回本次标记数量供前端即时扣减全局未读计数
    const markRes = await run(ctx.env,
      'UPDATE community_messages SET is_read = 1 WHERE from_id = ? AND to_id = ? AND is_read = 0', peerId, ctx.userId)
    return Response.json({
      messages: items.map(r => ({
        id: r.id, fromId: r.from_id, toId: r.to_id, content: r.content,
        imageUrls: r.image_urls ? parseStrArray(r.image_urls) : undefined,
        // 打开记录即已读：对方发来的消息在本次返回中即视为已读（与上方 UPDATE 同步）
        isRead: r.from_id === peerId ? true : !!r.is_read, createdAt: r.created_at, fromMe: r.from_id === ctx.userId
      })),
      nextCursor: rows.length > limit ? String(items[items.length - 1].created_at) : null,
      markedRead: markRes.meta.changes
    })
  })

  // 发送私信（限流 + 敏感词 + 通知对方；单向模式无需互关）
  on('POST', '/api/community/messages/:peerId', true, async (ctx) => {
    rateLimit(ctx.request, 'community:msg', 30)
    const peerId = ctx.params.peerId
    if (peerId === ctx.userId) throw new HttpError(400, '不能给自己发私信')
    const peer = await first<{ id: string }>(ctx.env, 'SELECT id FROM users WHERE id = ?', peerId)
    if (!peer) throw new HttpError(404, '用户不存在')
    const b = await parseBody(ctx.request, z.object({
      content: trimMax(500, '私信内容最多 500 字').default(''),
      imageUrls: imageUrlsSchema(IMAGE_MAX_PER_MESSAGE).default([])
    }))
    const content = b.content
    if (content) await assertCleanAsync(content, ctx.env) // 私信无待审语义，soft 也拒绝

    // 私信配图（最多 3 张）：与发帖/评论同一口径——仅认本系统上传路径且必须属于当前用户
    const imageUrls = b.imageUrls
    if (imageUrls.length) {
      const ids = imageUrls.map(u => u.split('/').pop()!)
      const owned = await all<{ id: string }>(ctx.env,
        `SELECT id FROM community_uploads WHERE user_id = ? AND id IN (${ids.map(() => '?').join(',')})`,
        ctx.userId, ...ids)
      if (owned.length !== new Set(ids).size) throw new HttpError(400, '图片不存在或已失效，请重新上传')
    }
    // 图文至少一项：支持纯图片 / 纯文字 / 图文混合私信
    if (!content && !imageUrls.length) throw new HttpError(400, '请输入私信内容或添加图片')

    const id = uid()
    const now = nowSec()
    await batch(ctx.env, [
      ctx.env.DB.prepare('INSERT INTO community_messages (id, from_id, to_id, content, image_urls, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(id, ctx.userId, peerId, content, JSON.stringify(imageUrls), now)
    ])
    return Response.json({ id, fromId: ctx.userId, toId: peerId, content, imageUrls, isRead: false, createdAt: now, fromMe: true }, { status: 201 })
  })

  // 私信未读总数（并入顶栏通知角标）
  on('GET', '/api/community/messages/unread-count', true, async (ctx) => {
    const r = await first<{ n: number }>(ctx.env,
      'SELECT COUNT(*) AS n FROM community_messages WHERE to_id = ? AND is_read = 0', ctx.userId)
    return Response.json({ count: r?.n ?? 0 })
  })
}
