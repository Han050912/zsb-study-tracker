import { on } from '../../router'
import { first, batch, uid, HttpError } from '../../db'
import { parseBody, REPORT_REASONS } from '../../schemas'
import { z } from 'zod'
import { rateLimit } from '../../middleware/rateLimit'
import { notifyStatement, nowSec } from './shared'

/**
 * 社区广场举报域路由：举报帖子/评论/私信。
 * 由 community/index.ts 的 registerCommunityRoutes 聚合注册。
 */
export function registerReportsRoutes() {
  // 举报帖子/评论/私信（举报人匿名，仅管理员可见；同一内容重复举报去重）
  on('POST', '/api/community/reports', true, async (ctx) => {
    await rateLimit(ctx, 'community:report', 10)
    const b = await parseBody(
      ctx.request,
      z.object({
        targetType: z.enum(['post', 'comment', 'message'], { message: '参数错误' }),
        targetId: z.string().min(1, '参数错误'),
        reason: z.enum(REPORT_REASONS, { message: '举报原因无效' }),
        // 复刻原行为：静默截断 200
        detail: z
          .unknown()
          .transform((v) =>
            String(v ?? '')
              .trim()
              .slice(0, 200)
          )
          .default('')
      })
    )
    const { targetType, targetId, reason, detail } = b
    if (reason === '其他' && !detail) throw new HttpError(400, '选择「其他」时请填写补充说明')
    // 私信举报：仅会话参与者可举报（校验目标消息存在且我是收发方之一）
    let targetUserId: string
    if (targetType === 'message') {
      const msg = await first<{ from_id: string; to_id: string }>(
        ctx.env,
        'SELECT from_id, to_id FROM community_messages WHERE id = ?',
        targetId
      )
      if (!msg) throw new HttpError(404, '私信不存在')
      if (msg.from_id !== ctx.userId && msg.to_id !== ctx.userId) throw new HttpError(403, '只能举报与你相关的私信')
      if (msg.from_id === ctx.userId) throw new HttpError(400, '不能举报自己发出的私信')
      targetUserId = msg.from_id
    } else {
      const table = targetType === 'post' ? 'community_posts' : 'community_comments'
      const target = await first<{ user_id: string }>(
        ctx.env,
        `SELECT user_id FROM ${table} WHERE id = ? AND is_hidden = 0`,
        targetId
      )
      if (!target) throw new HttpError(404, '内容不存在')
      if (target.user_id === ctx.userId) throw new HttpError(400, '不能举报自己的内容')
      targetUserId = target.user_id
    }
    const dup = await first(
      ctx.env,
      "SELECT id FROM community_reports WHERE reporter_id = ? AND target_type = ? AND target_id = ? AND status = 'pending'",
      ctx.userId,
      targetType,
      targetId
    )
    if (dup) throw new HttpError(400, '你已举报过该内容，请等待处理')
    // 唯一索引去重，阈值在插入后的事务内按不同举报人计算。
    const reportId = uid()
    const stmts = [
      ctx.env.DB.prepare(
        `INSERT OR IGNORE INTO community_reports
         (id, reporter_id, target_type, target_id, reason, detail, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`
      ).bind(reportId, ctx.userId, targetType, targetId, reason, detail, nowSec())
    ]
    if (targetType !== 'message') {
      const table = targetType === 'post' ? 'community_posts' : 'community_comments'
      stmts.push(
        ctx.env.DB.prepare(
          `UPDATE ${table} SET is_hidden = 1 WHERE id = ? AND is_hidden = 0 AND
           (SELECT COUNT(DISTINCT reporter_id) FROM community_reports
            WHERE target_type = ? AND target_id = ? AND status = 'pending') >= 5`
        ).bind(targetId, targetType, targetId),
        ctx.env.DB.prepare(
          `INSERT INTO community_moderation_log (id, admin_id, action, target_type, target_id, reason, created_at)
           SELECT ?, NULL, 'auto-hide', ?, ?, ?, ? WHERE changes() > 0`
        ).bind(uid(), targetType, targetId, '举报达阈值自动隐藏', nowSec()),
        notifyStatement(
          ctx.env,
          {
            userId: targetUserId,
            type: 'system',
            content: `你的${targetType === 'post' ? '帖子' : '评论'}因多次被举报已被系统自动隐藏，如有异议可联系管理员`
          },
          { ifPreviousChanged: true }
        ),
        ctx.env.DB.prepare(
          `UPDATE community_reports SET status = 'resolved' WHERE target_type = ? AND target_id = ?
           AND status = 'pending' AND EXISTS (SELECT 1 FROM ${table} WHERE id = ? AND is_hidden = 1)`
        ).bind(targetType, targetId, targetId)
      )
    }
    const results = await batch(ctx.env, stmts)
    if (!results?.[0].meta.changes) throw new HttpError(400, '你已举报过该内容，请等待处理')
    return Response.json({ ok: true }, { status: 201 })
  })
}
