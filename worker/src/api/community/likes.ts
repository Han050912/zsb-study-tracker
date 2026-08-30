import type { Env } from '../../index'
import { on, body } from '../../router'
import { all, first, run, batch, HttpError } from '../../db'
import { rateLimit } from '../../middleware/rateLimit'
import { awardBadge, hasBadge } from '../badges'
import {
  nowSec, awardStatements, revokeStatements, notifyStatement, displayName, assertCircleReadable
} from './shared'

/**
 * 社区广场点赞/点踩域路由：赞 / 踩（均 toggle 幂等，赞踩互斥）。
 * 由 community/index.ts 的 registerCommunityRoutes 聚合注册。
 * 零逻辑改动：on(...) 块从原 community.ts 逐字搬迁，仅调整 import 路径与包一层 registerLikesRoutes()。
 */
export function registerLikesRoutes() {
  // 点赞/取消点赞（toggle，幂等）
  on('POST', '/api/community/likes', true, async (ctx) => {
    rateLimit(ctx.request, 'community:like', 30)
    const b = await body(ctx.request)
    const targetType = b?.targetType === 'comment' ? 'comment' : b?.targetType === 'post' ? 'post' : null
    const targetId = typeof b?.targetId === 'string' ? b.targetId : ''
    if (!targetType || !targetId) throw new HttpError(400, '参数错误')
    const table = targetType === 'post' ? 'community_posts' : 'community_comments'

    const existing = await first(ctx.env,
      'SELECT 1 AS x FROM community_likes WHERE user_id = ? AND target_type = ? AND target_id = ?',
      ctx.userId, targetType, targetId)
    if (existing) {
      // 取消点赞：同时回收本次点赞产生的「获赞」积分流水并撤回点赞通知，防止反复点赞/取消刷分
      const unlikeStmts: D1PreparedStatement[] = [
        ctx.env.DB.prepare('DELETE FROM community_likes WHERE user_id = ? AND target_type = ? AND target_id = ?')
          .bind(ctx.userId, targetType, targetId),
        ctx.env.DB.prepare(`UPDATE ${table} SET likes_count = MAX(likes_count - 1, 0) WHERE id = ?`).bind(targetId),
        ctx.env.DB.prepare(
          `DELETE FROM community_notifications WHERE type = 'like' AND actor_id = ? AND ${targetType === 'post' ? 'post_id' : 'comment_id'} = ?`
        ).bind(ctx.userId, targetId),
        ...(await revokeStatements(ctx.env, `srv:like:${ctx.userId}:${targetType}:${targetId}`))
      ]
      await batch(ctx.env, unlikeStmts)
      return Response.json({ liked: false })
    }

    // 评论需额外取 post_id，让「赞了你的评论」通知可跳转到所属帖子；帖子带 circle_id 供圈子可读性校验
    const target = await first<{ user_id: string; post_id?: string; circle_id?: string | null }>(ctx.env,
      targetType === 'post'
        ? 'SELECT user_id, circle_id FROM community_posts WHERE id = ? AND is_hidden = 0'
        : `SELECT c.user_id, c.post_id, p.circle_id FROM community_comments c
           JOIN community_posts p ON p.id = c.post_id
           WHERE c.id = ? AND c.is_hidden = 0`, targetId)
    if (!target) throw new HttpError(404, '内容不存在')
    // 圈子内容：仅可读者可点赞（与详情/评论同一口径）
    if (target.circle_id) await assertCircleReadable(ctx, target.circle_id)

    // 与踩互斥：若已踩则取消踩（删记录 + 计数-1），保证赞/踩二选一，避免同时点亮的状态矛盾
    const disliked = await first(ctx.env,
      'SELECT 1 AS x FROM community_dislikes WHERE user_id = ? AND target_type = ? AND target_id = ?',
      ctx.userId, targetType, targetId)
    if (disliked) {
      await batch(ctx.env, [
        ctx.env.DB.prepare('DELETE FROM community_dislikes WHERE user_id = ? AND target_type = ? AND target_id = ?')
          .bind(ctx.userId, targetType, targetId),
        ctx.env.DB.prepare(`UPDATE ${table} SET dislikes_count = MAX(dislikes_count - 1, 0) WHERE id = ?`).bind(targetId)
      ])
    }

    // 原子 INSERT OR IGNORE 抢占点赞记录，消除并发双击导致的「主键冲突 500」（changes=0 表示已赞，幂等返回）
    const inserted = await run(ctx.env,
      'INSERT OR IGNORE INTO community_likes (user_id, target_type, target_id, created_at) VALUES (?, ?, ?, ?)',
      ctx.userId, targetType, targetId, nowSec())
    if (!inserted.meta.changes) return Response.json({ liked: true })

    const stmts: D1PreparedStatement[] = [
      ctx.env.DB.prepare(`UPDATE ${table} SET likes_count = likes_count + 1 WHERE id = ?`).bind(targetId)
    ]
    // 被赞 +1 积分 + 通知（自己赞自己不加、不通知）；refId 编码点赞者身份，取消点赞时可精确回收
    if (target.user_id !== ctx.userId) {
      const myName = await displayName(ctx.env, ctx.userId)
      stmts.push(...awardStatements(ctx.env, target.user_id, 1, '获赞', `like:${ctx.userId}:${targetType}:${targetId}`))
      stmts.push(notifyStatement(ctx.env, {
        userId: target.user_id, type: 'like', actorId: ctx.userId,
        postId: targetType === 'post' ? targetId : target.post_id,
        commentId: targetType === 'comment' ? targetId : undefined,
        content: `${myName} 赞了你的${targetType === 'post' ? '帖子' : '评论'}`
      }))
    }
    await batch(ctx.env, stmts)
    // 徽章：百赞达人（帖子+评论累计获赞 ≥100；已持有者跳过统计查询）
    if (target.user_id !== ctx.userId && !(await hasBadge(ctx.env, target.user_id, 'likes_100'))) {
      const total = await first<{ n: number }>(ctx.env,
        `SELECT (SELECT COALESCE(SUM(likes_count), 0) FROM community_posts WHERE user_id = ?)
              + (SELECT COALESCE(SUM(likes_count), 0) FROM community_comments WHERE user_id = ?) AS n`,
        target.user_id, target.user_id)
      if ((total?.n ?? 0) >= 100) await batch(ctx.env, await awardBadge(ctx.env, target.user_id, 'likes_100'))
    }
    return Response.json({ liked: true })
  })

  // 踩/取消踩（toggle，幂等；与赞互斥：踩时若已赞则取消赞并回收积分，防刷分）
  on('POST', '/api/community/dislikes', true, async (ctx) => {
    rateLimit(ctx.request, 'community:dislike', 30)
    const b = await body(ctx.request)
    const targetType = b?.targetType === 'comment' ? 'comment' : b?.targetType === 'post' ? 'post' : null
    const targetId = typeof b?.targetId === 'string' ? b.targetId : ''
    if (!targetType || !targetId) throw new HttpError(400, '参数错误')
    const table = targetType === 'post' ? 'community_posts' : 'community_comments'

    const existing = await first(ctx.env,
      'SELECT 1 AS x FROM community_dislikes WHERE user_id = ? AND target_type = ? AND target_id = ?',
      ctx.userId, targetType, targetId)
    if (existing) {
      await batch(ctx.env, [
        ctx.env.DB.prepare('DELETE FROM community_dislikes WHERE user_id = ? AND target_type = ? AND target_id = ?')
          .bind(ctx.userId, targetType, targetId),
        ctx.env.DB.prepare(`UPDATE ${table} SET dislikes_count = MAX(dislikes_count - 1, 0) WHERE id = ?`).bind(targetId)
      ])
      return Response.json({ disliked: false })
    }

    // 校验目标存在 + 圈子可读性
    const target = await first<{ user_id: string; circle_id?: string | null }>(ctx.env,
      targetType === 'post'
        ? 'SELECT user_id, circle_id FROM community_posts WHERE id = ? AND is_hidden = 0'
        : `SELECT c.user_id, p.circle_id FROM community_comments c
           JOIN community_posts p ON p.id = c.post_id
           WHERE c.id = ? AND c.is_hidden = 0`, targetId)
    if (!target) throw new HttpError(404, '内容不存在')
    if (target.circle_id) await assertCircleReadable(ctx, target.circle_id)

    // 与赞互斥：若已赞，完整取消赞（删记录 + 计数-1 + 撤通知 + 回收积分）
    const liked = await first(ctx.env,
      'SELECT 1 AS x FROM community_likes WHERE user_id = ? AND target_type = ? AND target_id = ?',
      ctx.userId, targetType, targetId)
    let likeRevoked = false
    if (liked) {
      likeRevoked = true
      const unlikeStmts: D1PreparedStatement[] = [
        ctx.env.DB.prepare('DELETE FROM community_likes WHERE user_id = ? AND target_type = ? AND target_id = ?')
          .bind(ctx.userId, targetType, targetId),
        ctx.env.DB.prepare(`UPDATE ${table} SET likes_count = MAX(likes_count - 1, 0) WHERE id = ?`).bind(targetId),
        ctx.env.DB.prepare(
          `DELETE FROM community_notifications WHERE type = 'like' AND actor_id = ? AND ${targetType === 'post' ? 'post_id' : 'comment_id'} = ?`
        ).bind(ctx.userId, targetId),
        ...(await revokeStatements(ctx.env, `srv:like:${ctx.userId}:${targetType}:${targetId}`))
      ]
      await batch(ctx.env, unlikeStmts)
    }

    // 原子 INSERT OR IGNORE 抢占踩记录，防并发双击 500（changes=0 表示已踩，幂等返回）
    const inserted = await run(ctx.env,
      'INSERT OR IGNORE INTO community_dislikes (user_id, target_type, target_id, created_at) VALUES (?, ?, ?, ?)',
      ctx.userId, targetType, targetId, nowSec())
    if (!inserted.meta.changes) return Response.json({ disliked: true, likeRevoked })

    await batch(ctx.env, [
      ctx.env.DB.prepare(`UPDATE ${table} SET dislikes_count = dislikes_count + 1 WHERE id = ?`).bind(targetId)
    ])
    return Response.json({ disliked: true, likeRevoked })
  })
}
