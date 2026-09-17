import type { Ctx } from '../../router'
import { all, first, HttpError } from '../../db'
import { mapComment } from './shared'

/** 调用方先验证帖子/圈子可读性；根评论与回复都使用相同的可见性约束。 */
export async function readCommentPage(ctx: Ctx, admin: boolean, url: URL) {
  const visible = (alias: string) =>
    admin ? '1 = 1' : `${alias}.is_hidden = 0 AND (${alias}.is_flagged = 0 OR ${alias}.user_id = ?)`
  const visibilityParams = admin ? [] : [ctx.userId]
  const select = `SELECT c.*, COALESCE(s.user_name, u.username) AS user_name, u.verified AS user_verified, s.avatar AS user_avatar,
    (l.user_id IS NOT NULL) AS liked_by_me, (d.user_id IS NOT NULL) AS disliked_by_me,
    (SELECT COUNT(*) FROM community_comments reply WHERE reply.parent_id = c.id AND ${visible('reply')}) AS reply_count
    FROM community_comments c JOIN users u ON u.id = c.user_id LEFT JOIN user_settings s ON s.user_id = c.user_id
    LEFT JOIN community_likes l ON l.target_type = 'comment' AND l.target_id = c.id AND l.user_id = ?
    LEFT JOIN community_dislikes d ON d.target_type = 'comment' AND d.target_id = c.id AND d.user_id = ?`
  const params: unknown[] = [...visibilityParams, ctx.userId, ctx.userId, ctx.params.id, ...visibilityParams]
  let where = `c.post_id = ? AND ${visible('c')}`
  const parent = url.searchParams.get('parentId'),
    around = url.searchParams.get('aroundCommentId')
  if (around || parent) {
    const target = await first<{ id: string; parent_id: string | null }>(
      ctx.env,
      `SELECT c.id, c.parent_id FROM community_comments c WHERE c.id = ? AND c.post_id = ? AND ${visible('c')}`,
      around || parent,
      ctx.params.id,
      ...visibilityParams
    )
    if (!target) throw new HttpError(404, '评论不存在或不可见')
    if (target.parent_id) {
      const root = await first(
        ctx.env,
        `SELECT c.id FROM community_comments c WHERE c.id = ? AND c.post_id = ? AND ${visible('c')}`,
        target.parent_id,
        ctx.params.id,
        ...visibilityParams
      )
      if (!root) throw new HttpError(404, '评论不存在或不可见')
    }
    if (around) {
      where += ' AND (c.id = ? OR c.id = ?)'
      params.push(target.id, target.parent_id || target.id)
      const rows = await all(ctx.env, `${select} WHERE ${where} ORDER BY c.created_at, c.id`, ...params)
      return { comments: rows.map(mapComment), nextCursor: null }
    }
    if (target.parent_id) throw new HttpError(400, '请指定一级评论')
  }
  where += parent ? ' AND c.parent_id = ?' : ' AND c.parent_id IS NULL'
  if (parent) params.push(parent)
  const hot = url.searchParams.get('sort') !== 'latest'
  const rank = hot ? 'c.likes_count' : '0'
  const rawCursor = url.searchParams.get('cursor')
  if (rawCursor) {
    let cursor: unknown
    try {
      cursor = JSON.parse(rawCursor)
    } catch {
      throw new HttpError(400, '评论游标无效')
    }
    if (
      !Array.isArray(cursor) ||
      cursor.length !== 4 ||
      !cursor.slice(0, 3).every((n) => typeof n === 'number' && Number.isFinite(n)) ||
      typeof cursor[3] !== 'string'
    )
      throw new HttpError(400, '评论游标无效')
    if (parent) {
      where += ' AND (c.created_at, c.id) > (?, ?)'
      params.push(cursor[2], cursor[3])
    } else {
      where += ` AND (c.is_accepted, ${rank}, c.created_at, c.id) < (?, ?, ?, ?)`
      params.push(...cursor)
    }
  }
  const order = parent
    ? 'c.created_at ASC, c.id ASC'
    : `c.is_accepted DESC, ${hot ? 'c.likes_count DESC, ' : ''}c.created_at DESC, c.id DESC`
  const rows = await all(ctx.env, `${select} WHERE ${where} ORDER BY ${order} LIMIT 21`, ...params)
  const page = rows.slice(0, 20),
    last = page.at(-1)
  return {
    comments: page.map(mapComment),
    nextCursor:
      rows.length > 20 && last
        ? JSON.stringify([last.is_accepted, hot ? last.likes_count : 0, last.created_at, last.id])
        : null
  }
}
