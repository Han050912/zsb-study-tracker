import type { Env } from '../index'
import { on, body } from '../router'
import { all, first, batch, uid, HttpError } from '../db'
import { rateLimit } from '../middleware/rateLimit'
import { notifyStatement, postCascadeStatements, commentCascadeStatements } from './community'
import { deleteUploads, uploadIdsOf } from './uploads'

/**
 * 社区管理端点：帖子置顶/隐藏、评论隐藏、举报处理。
 * 所有路由需管理员角色（users.role = 'admin'）。
 * 管理员设置方式：UPDATE users SET role = 'admin' WHERE username = 'xxx';
 * 治理动作全部写入 community_moderation_log 留痕；举报处理结果通过 system 通知告知被处理人与举报人。
 */

const nowSec = () => Math.floor(Date.now() / 1000)

/** 校验当前用户为管理员，否则 403 */
async function requireAdmin(ctx: { env: Env; userId: string }) {
  const u = await first<{ role: string }>(ctx.env, 'SELECT role FROM users WHERE id = ?', ctx.userId)
  if (!u || u.role !== 'admin') throw new HttpError(403, '需要管理员权限')
}

/** 审核动作留痕 */
function modLogStatement(
  env: Env, adminId: string, action: string, targetType: string, targetId: string,
  reportId: string | null, reason: string
): D1PreparedStatement {
  return env.DB.prepare(
    'INSERT INTO community_moderation_log (id, admin_id, action, target_type, target_id, report_id, reason, created_at) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(uid(), adminId, action, targetType, targetId, reportId, reason, nowSec())
}

export function registerAdminRoutes() {
  // 帖子置顶/取消置顶
  on('PUT', '/api/admin/posts/:id/pin', true, async (ctx) => {
    rateLimit(ctx.request, 'admin', 20)
    await requireAdmin(ctx)
    const post = await first<{ is_pinned: number }>(ctx.env,
      'SELECT is_pinned FROM community_posts WHERE id = ?', ctx.params.id)
    if (!post) throw new HttpError(404, '帖子不存在')
    const next = post.is_pinned ? 0 : 1
    await batch(ctx.env, [
      ctx.env.DB.prepare('UPDATE community_posts SET is_pinned = ? WHERE id = ?').bind(next, ctx.params.id),
      modLogStatement(ctx.env, ctx.userId, next ? 'pin' : 'unpin', 'post', ctx.params.id, null, '')
    ])
    return Response.json({ isPinned: !!next })
  })

  // 帖子隐藏/取消隐藏
  on('PUT', '/api/admin/posts/:id/hide', true, async (ctx) => {
    rateLimit(ctx.request, 'admin', 20)
    await requireAdmin(ctx)
    const post = await first<{ is_hidden: number }>(ctx.env,
      'SELECT is_hidden FROM community_posts WHERE id = ?', ctx.params.id)
    if (!post) throw new HttpError(404, '帖子不存在')
    const next = post.is_hidden ? 0 : 1
    await batch(ctx.env, [
      ctx.env.DB.prepare('UPDATE community_posts SET is_hidden = ? WHERE id = ?').bind(next, ctx.params.id),
      modLogStatement(ctx.env, ctx.userId, next ? 'hide' : 'unhide', 'post', ctx.params.id, null, '')
    ])
    return Response.json({ isHidden: !!next })
  })

  // 评论隐藏/取消隐藏
  on('PUT', '/api/admin/comments/:id/hide', true, async (ctx) => {
    rateLimit(ctx.request, 'admin', 20)
    await requireAdmin(ctx)
    const c = await first<{ is_hidden: number }>(ctx.env,
      'SELECT is_hidden FROM community_comments WHERE id = ?', ctx.params.id)
    if (!c) throw new HttpError(404, '评论不存在')
    const next = c.is_hidden ? 0 : 1
    await batch(ctx.env, [
      ctx.env.DB.prepare('UPDATE community_comments SET is_hidden = ? WHERE id = ?').bind(next, ctx.params.id),
      modLogStatement(ctx.env, ctx.userId, next ? 'hide' : 'unhide', 'comment', ctx.params.id, null, '')
    ])
    return Response.json({ isHidden: !!next })
  })

  // 举报队列（仅待处理；附目标内容快照，目标已被删除时 target 为 null）
  on('GET', '/api/admin/reports', true, async (ctx) => {
    rateLimit(ctx.request, 'admin', 20)
    await requireAdmin(ctx)
    const rows = await all<any>(ctx.env, `
      SELECT r.*, COALESCE(rs.user_name, ru.username) AS reporter_name
      FROM community_reports r
      JOIN users ru ON ru.id = r.reporter_id
      LEFT JOIN user_settings rs ON rs.user_id = r.reporter_id
      WHERE r.status = 'pending'
      ORDER BY r.created_at ASC
      LIMIT 100`)
    const postIds = rows.filter(r => r.target_type === 'post').map(r => r.target_id)
    const commentIds = rows.filter(r => r.target_type === 'comment').map(r => r.target_id)
    const posts = postIds.length ? await all<any>(ctx.env, `
      SELECT p.id, p.content, p.is_hidden, COALESCE(s.user_name, u.username) AS author_name
      FROM community_posts p
      JOIN users u ON u.id = p.user_id
      LEFT JOIN user_settings s ON s.user_id = p.user_id
      WHERE p.id IN (${postIds.map(() => '?').join(',')})`, ...postIds) : []
    const comments = commentIds.length ? await all<any>(ctx.env, `
      SELECT c.id, c.post_id, c.content, c.is_hidden, COALESCE(s.user_name, u.username) AS author_name
      FROM community_comments c
      JOIN users u ON u.id = c.user_id
      LEFT JOIN user_settings s ON s.user_id = c.user_id
      WHERE c.id IN (${commentIds.map(() => '?').join(',')})`, ...commentIds) : []
    const postMap = new Map(posts.map(p => [p.id, p]))
    const commentMap = new Map(comments.map(c => [c.id, c]))
    return Response.json({
      reports: rows.map(r => {
        const t = r.target_type === 'post' ? postMap.get(r.target_id) : commentMap.get(r.target_id)
        return {
          id: r.id,
          targetType: r.target_type as 'post' | 'comment',
          targetId: r.target_id,
          reason: r.reason,
          detail: r.detail,
          createdAt: r.created_at,
          reporterName: r.reporter_name || '升本人',
          target: t ? {
            authorName: t.author_name || '升本人',
            excerpt: String(t.content).slice(0, 120),
            isHidden: !!t.is_hidden,
            postId: r.target_type === 'comment' ? t.post_id : t.id
          } : null
        }
      })
    })
  })

  // 处理举报：hide（隐藏）/ delete（删除）/ reject（驳回）；处理结果通知被处理人与举报人
  on('PUT', '/api/admin/reports/:id/resolve', true, async (ctx) => {
    rateLimit(ctx.request, 'admin', 20)
    await requireAdmin(ctx)
    const b = await body(ctx.request)
    const action: 'hide' | 'delete' | 'reject' | null =
      b?.action === 'hide' || b?.action === 'delete' || b?.action === 'reject' ? b.action : null
    if (!action) throw new HttpError(400, '处理动作无效')
    const note = String(b?.reason ?? '').trim().slice(0, 200)

    const report = await first<any>(ctx.env,
      "SELECT * FROM community_reports WHERE id = ? AND status = 'pending'", ctx.params.id)
    if (!report) throw new HttpError(404, '举报不存在或已处理')
    const isPost = report.target_type === 'post'
    const table = isPost ? 'community_posts' : 'community_comments'
    const typeLabel = isPost ? '帖子' : '评论'
    const target = await first<any>(ctx.env,
      `SELECT user_id${isPost ? ', image_urls' : ', post_id'} FROM ${table} WHERE id = ?`, report.target_id)

    const stmts: D1PreparedStatement[] = []
    if (!target) {
      // 目标已被作者自行删除：直接结案并回告举报人
      stmts.push(ctx.env.DB.prepare("UPDATE community_reports SET status = 'resolved' WHERE id = ?").bind(report.id))
      stmts.push(modLogStatement(ctx.env, ctx.userId, 'resolve-gone', report.target_type, report.target_id, report.id, note))
      stmts.push(notifyStatement(ctx.env, {
        userId: report.reporter_id, type: 'system',
        content: `你举报的${typeLabel}已不存在（可能已被作者删除），举报已结案`
      }))
      await batch(ctx.env, stmts)
      return Response.json({ ok: true })
    }

    if (action === 'reject') {
      stmts.push(ctx.env.DB.prepare("UPDATE community_reports SET status = 'rejected' WHERE id = ?").bind(report.id))
      stmts.push(modLogStatement(ctx.env, ctx.userId, 'reject', report.target_type, report.target_id, report.id, note))
      stmts.push(notifyStatement(ctx.env, {
        userId: report.reporter_id, type: 'system',
        content: `你举报的${typeLabel}经审核未违规，已驳回${note ? `：${note}` : ''}。感谢你的监督`
      }))
    } else if (action === 'hide') {
      stmts.push(ctx.env.DB.prepare(`UPDATE ${table} SET is_hidden = 1 WHERE id = ?`).bind(report.target_id))
      stmts.push(ctx.env.DB.prepare("UPDATE community_reports SET status = 'resolved' WHERE id = ?").bind(report.id))
      stmts.push(modLogStatement(ctx.env, ctx.userId, 'hide', report.target_type, report.target_id, report.id, note))
      stmts.push(notifyStatement(ctx.env, {
        userId: target.user_id, type: 'system',
        content: `你的${typeLabel}因「${report.reason}」被管理员隐藏${note ? `：${note}` : ''}。如有异议可联系管理员`
      }))
      stmts.push(notifyStatement(ctx.env, {
        userId: report.reporter_id, type: 'system',
        content: `你举报的${typeLabel}已被隐藏。感谢你的监督`
      }))
    } else {
      // delete：复用社区级联删除（不回收积分——管理操作不惩罚用户）
      if (isPost) {
        stmts.push(...postCascadeStatements(ctx.env, report.target_id))
      } else {
        stmts.push(...(await commentCascadeStatements(ctx.env, report.target_id, target.post_id)).statements)
      }
      stmts.push(ctx.env.DB.prepare("UPDATE community_reports SET status = 'resolved' WHERE id = ?").bind(report.id))
      stmts.push(modLogStatement(ctx.env, ctx.userId, 'delete', report.target_type, report.target_id, report.id, note))
      stmts.push(notifyStatement(ctx.env, {
        userId: target.user_id, type: 'system',
        content: `你的${typeLabel}因「${report.reason}」被管理员删除${note ? `：${note}` : ''}。如有异议可联系管理员`
      }))
      stmts.push(notifyStatement(ctx.env, {
        userId: report.reporter_id, type: 'system',
        content: `你举报的${typeLabel}已被删除。感谢你的监督`
      }))
    }
    await batch(ctx.env, stmts)
    // 删帖成功后清理 R2 图片（失败仅留孤儿对象，不影响主流程）
    if (action === 'delete' && isPost) await deleteUploads(ctx.env, uploadIdsOf(target.image_urls))
    return Response.json({ ok: true })
  })
}
