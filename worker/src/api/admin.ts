import type { Env } from '../index'
import { on } from '../router'
import { first, run, HttpError } from '../db'
import { rateLimit } from '../middleware/rateLimit'

/**
 * 社区管理端点：帖子置顶/隐藏、评论隐藏。
 * 所有路由需管理员角色（users.role = 'admin'）。
 * 管理员设置方式：UPDATE users SET role = 'admin' WHERE username = 'xxx';
 */

/** 校验当前用户为管理员，否则 403 */
async function requireAdmin(ctx: { env: Env; userId: string }) {
  const u = await first<{ role: string }>(ctx.env, 'SELECT role FROM users WHERE id = ?', ctx.userId)
  if (!u || u.role !== 'admin') throw new HttpError(403, '需要管理员权限')
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
    await run(ctx.env, 'UPDATE community_posts SET is_pinned = ? WHERE id = ?', next, ctx.params.id)
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
    await run(ctx.env, 'UPDATE community_posts SET is_hidden = ? WHERE id = ?', next, ctx.params.id)
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
    await run(ctx.env, 'UPDATE community_comments SET is_hidden = ? WHERE id = ?', next, ctx.params.id)
    return Response.json({ isHidden: !!next })
  })
}
