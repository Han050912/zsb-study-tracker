import type { Env } from '../index'
import { on, body } from '../router'
import { all, first, run, batch, uid, utc8Today, HttpError } from '../db'
import { rateLimit } from '../middleware/rateLimit'
import { deleteUploads, uploadIdsOf, IMAGE_MAX_PER_POST } from './uploads'

/**
 * 社区广场：帖子 / 评论 / 点赞 / 通知 / 图片 / 举报 / 榜单。
 * 积分与学习积分共用 gamification + points_log 两张表（awardStatements 与前端全量同步同一口径）。
 * 服务端写入的积分流水 ref_id 一律带 'srv:' 前缀，供全量同步区分「服务端来源」并保留（见 gamification.ts）。
 * 列表游标分页：latest 用 `${created_at}_${id}` 游标；hot 用 offset 数字游标（热度随时间变化，游标无意义）。
 */

const POST_TYPES = ['checkin', 'share', 'achievement', 'longform', 'question']
/** 提问帖必选的科目标签（二选一，与前端 COMMUNITY_TAGS 对应） */
const QUESTION_SUBJECT_TAGS = ['#高等数学', '#英语']
const REPORT_REASONS = ['广告', '人身攻击', '不相关内容', '其他']
const MAX_PAGE = 50

const nowSec = () => Math.floor(Date.now() / 1000)

// ---------- 行 → 前端对象 ----------

/** 解析 JSON 字符串数组列（tags / image_urls 共用），非法输入回退空数组 */
function parseStrArray(raw: unknown): string[] {
  try {
    const v = JSON.parse(String(raw || '[]'))
    return Array.isArray(v) ? v.filter(t => typeof t === 'string') : []
  } catch {
    return []
  }
}

function mapPost(r: any) {
  return {
    id: r.id,
    userId: r.user_id,
    userName: r.user_name || '升本人',
    userPoints: r.user_points ?? 0,
    type: r.type,
    content: r.content,
    tags: parseStrArray(r.tags),
    imageUrls: parseStrArray(r.image_urls),
    isResolved: !!r.is_resolved,
    refType: r.ref_type ?? undefined,
    refId: r.ref_id ?? undefined,
    likesCount: r.likes_count,
    commentsCount: r.comments_count,
    isPinned: !!r.is_pinned,
    isHidden: !!r.is_hidden,
    likedByMe: !!r.liked_by_me,
    createdAt: r.created_at
  }
}

function mapComment(r: any) {
  return {
    id: r.id,
    postId: r.post_id,
    userId: r.user_id,
    userName: r.user_name || '升本人',
    parentId: r.parent_id ?? undefined,
    content: r.content,
    likesCount: r.likes_count,
    isHidden: !!r.is_hidden,
    likedByMe: !!r.liked_by_me,
    createdAt: r.created_at
  }
}

function mapNotification(r: any) {
  return {
    id: r.id,
    type: r.type,
    actorId: r.actor_id ?? undefined,
    actorName: r.actor_name ?? undefined,
    postId: r.post_id ?? undefined,
    commentId: r.comment_id ?? undefined,
    content: r.content,
    isRead: !!r.is_read,
    createdAt: r.created_at
  }
}

// ---------- 通用 SQL 片段 ----------

/** 帖子查询：JOIN 作者展示名/积分 + 当前用户点赞态。参数顺序固定为 [viewerId, ...] */
const POST_SELECT = `
  SELECT p.*, COALESCE(s.user_name, u.username) AS user_name, COALESCE(g.points, 0) AS user_points,
    (l.user_id IS NOT NULL) AS liked_by_me
  FROM community_posts p
  JOIN users u ON u.id = p.user_id
  LEFT JOIN user_settings s ON s.user_id = p.user_id
  LEFT JOIN gamification g ON g.user_id = p.user_id
  LEFT JOIN community_likes l ON l.target_type = 'post' AND l.target_id = p.id AND l.user_id = ?`

// ---------- 积分 / 通知 ----------

/** 社区行为积分语句：gamification 行可能不存在（upsert），流水写入 points_log（refId 带 srv: 前缀标记服务端来源） */
function awardStatements(env: Env, userId: string, points: number, reason: string, refId?: string): D1PreparedStatement[] {
  return [
    env.DB.prepare(
      'INSERT INTO gamification (user_id, points) VALUES (?, ?) ' +
      'ON CONFLICT(user_id) DO UPDATE SET points = points + excluded.points'
    ).bind(userId, points),
    env.DB.prepare('INSERT INTO points_log (user_id, date, points, reason, ref_id) VALUES (?, ?, ?, ?, ?)')
      .bind(userId, utc8Today(), points, reason, refId ? `srv:${refId}` : null)
  ]
}

/** 按 refId 精确回收积分流水（含 gamification 扣减），用于取消点赞/删除评论时防止「反复操作刷分」 */
async function revokeStatements(env: Env, refId: string): Promise<D1PreparedStatement[]> {
  const logs = await all<{ user_id: string; points: number }>(env,
    'SELECT user_id, points FROM points_log WHERE ref_id = ?', refId)
  if (!logs.length) return []
  const byUser = new Map<string, number>()
  for (const l of logs) byUser.set(l.user_id, (byUser.get(l.user_id) || 0) + l.points)
  const stmts: D1PreparedStatement[] = []
  for (const [uid, pts] of byUser) {
    stmts.push(env.DB.prepare('UPDATE gamification SET points = MAX(points - ?, 0) WHERE user_id = ?').bind(pts, uid))
  }
  stmts.push(env.DB.prepare('DELETE FROM points_log WHERE ref_id = ?').bind(refId))
  return stmts
}

/** 回收一组点赞目标的全部「获赞」流水（refId = like:{user}:{type}:{target}），删除帖子/评论时调用，防止目标删除后积分残留被刷分 */
async function revokeLikeStatements(env: Env, targetType: 'post' | 'comment', targetIds: string[]): Promise<D1PreparedStatement[]> {
  if (!targetIds.length) return []
  const likes = await all<{ user_id: string; target_id: string }>(env,
    `SELECT user_id, target_id FROM community_likes WHERE target_type = ? AND target_id IN (${targetIds.map(() => '?').join(',')})`,
    targetType, ...targetIds)
  const stmts: D1PreparedStatement[] = []
  for (const l of likes) stmts.push(...await revokeStatements(env, `srv:like:${l.user_id}:${targetType}:${l.target_id}`))
  return stmts
}

export function notifyStatement(env: Env, n: {
  userId: string; type: string; actorId?: string; postId?: string; commentId?: string; content: string
}): D1PreparedStatement {
  return env.DB.prepare(
    'INSERT INTO community_notifications (id, user_id, type, actor_id, post_id, comment_id, content, is_read, created_at) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)'
  ).bind(uid(), n.userId, n.type, n.actorId ?? null, n.postId ?? null, n.commentId ?? null, n.content, nowSec())
}

/** 用户展示名（用户设置昵称优先，回退用户名） */
export async function displayName(env: Env, userId: string): Promise<string> {
  const r = await first<{ name: string }>(env,
    'SELECT COALESCE(s.user_name, u.username) AS name FROM users u LEFT JOIN user_settings s ON s.user_id = u.id WHERE u.id = ?',
    userId)
  return r?.name || '升本人'
}

/** 当前用户是否为管理员 */
async function isAdmin(env: Env, userId: string): Promise<boolean> {
  const u = await first<{ role: string }>(env, 'SELECT role FROM users WHERE id = ?', userId)
  return u?.role === 'admin'
}

/** LIKE 通配符转义（tags JSON 子串匹配用） */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, c => '\\' + c)
}

/** 解析 latest 游标 `${created_at}_${id}`；非法返回 null */
function parseCursor(cursor: string): { ts: number; id: string } | null {
  const i = cursor.indexOf('_')
  if (i <= 0) return null
  const ts = Number(cursor.slice(0, i))
  const id = cursor.slice(i + 1)
  return Number.isFinite(ts) && id ? { ts, id } : null
}

// ---------- 级联删除（作者删除与管理员处理共用；不含积分回收与 R2 清理） ----------

/** 删帖级联清理语句：点赞/通知/举报/评论/帖子本体。举报清理须在评论删除前执行（子查询依赖评论存在） */
export function postCascadeStatements(env: Env, postId: string): D1PreparedStatement[] {
  return [
    env.DB.prepare(
      `DELETE FROM community_likes WHERE (target_type = 'post' AND target_id = ?)
       OR (target_type = 'comment' AND target_id IN (SELECT id FROM community_comments WHERE post_id = ?))`
    ).bind(postId, postId),
    env.DB.prepare('DELETE FROM community_notifications WHERE post_id = ?').bind(postId),
    env.DB.prepare(
      `DELETE FROM community_reports WHERE (target_type = 'post' AND target_id = ?)
       OR (target_type = 'comment' AND target_id IN (SELECT id FROM community_comments WHERE post_id = ?))`
    ).bind(postId, postId),
    env.DB.prepare('DELETE FROM community_comments WHERE post_id = ?').bind(postId),
    env.DB.prepare('DELETE FROM community_posts WHERE id = ?').bind(postId)
  ]
}

/** 删评论级联清理语句：通知/点赞/举报/评论本体及二级回复 + 帖子计数回退；同时返回被删 id 列表 */
export async function commentCascadeStatements(env: Env, commentId: string, postId: string): Promise<{ statements: D1PreparedStatement[]; removedIds: string[] }> {
  const replies = await all<{ id: string }>(env,
    'SELECT id FROM community_comments WHERE parent_id = ?', commentId)
  const removedIds = [commentId, ...replies.map(r => r.id)]
  const ph = removedIds.map(() => '?').join(',')
  return {
    removedIds,
    statements: [
      // 清理这些评论触发的通知（被评论/被回复/被赞评论），避免通知指向已删除内容
      env.DB.prepare(`DELETE FROM community_notifications WHERE comment_id IN (${ph})`).bind(...removedIds),
      env.DB.prepare(`DELETE FROM community_likes WHERE target_type = 'comment' AND target_id IN (${ph})`).bind(...removedIds),
      env.DB.prepare(`DELETE FROM community_reports WHERE target_type = 'comment' AND target_id IN (${ph})`).bind(...removedIds),
      env.DB.prepare(`DELETE FROM community_comments WHERE id IN (${ph})`).bind(...removedIds),
      env.DB.prepare('UPDATE community_posts SET comments_count = MAX(comments_count - ?, 0) WHERE id = ?')
        .bind(removedIds.length, postId)
    ]
  }
}

// ---------- 路由 ----------

export function registerCommunityRoutes() {
  // 帖子列表（游标分页）
  on('GET', '/api/community/posts', true, async (ctx) => {
    const url = new URL(ctx.request.url)
    const sort = url.searchParams.get('sort') === 'hot' ? 'hot' : 'latest'
    const tag = (url.searchParams.get('tag') || '').trim()
    const type = (url.searchParams.get('type') || '').trim()
    const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '') || 20, 1), MAX_PAGE)
    const cursor = url.searchParams.get('cursor') || ''

    const admin = await isAdmin(ctx.env, ctx.userId)
    const where: string[] = []
    if (!admin) where.push('p.is_hidden = 0')
    const params: unknown[] = [ctx.userId]
    if (type && POST_TYPES.includes(type)) { where.push('p.type = ?'); params.push(type) }
    if (tag) { where.push(`p.tags LIKE ? ESCAPE '\\'`); params.push(`%"${escapeLike(tag)}"%`) }

    let sql = `${POST_SELECT}${where.length ? ` WHERE ${where.join(' AND ')}` : ''}`
    let nextCursor: string | null = null

    if (sort === 'hot') {
      // 热度 = 互动分 / 时间衰减；offset 分页（热度随时间漂移，游标无意义）
      const offset = Math.max(parseInt(cursor || '') || 0, 0)
      sql += ` ORDER BY p.is_pinned DESC, (p.likes_count * 2 + p.comments_count * 3 + 1) * 3600.0 / (? - p.created_at + 7200) DESC, p.created_at DESC LIMIT ? OFFSET ?`
      const rows = await all(ctx.env, sql, ...params, nowSec(), limit + 1, offset)
      if (rows.length > limit) nextCursor = String(offset + limit)
      return Response.json({ posts: rows.slice(0, limit).map(mapPost), nextCursor })
    }

    const c = cursor ? parseCursor(cursor) : null
    if (c) {
      where.push('(p.created_at < ? OR (p.created_at = ? AND p.id < ?))')
      params.push(c.ts, c.ts, c.id)
      sql = `${POST_SELECT} WHERE ${where.join(' AND ')}`
    }
    sql += ' ORDER BY p.is_pinned DESC, p.created_at DESC, p.id DESC LIMIT ?'
    const rows = await all(ctx.env, sql, ...params, limit + 1)
    if (rows.length > limit) {
      const last = rows[limit - 1] as any
      nextCursor = `${last.created_at}_${last.id}`
    }
    return Response.json({ posts: rows.slice(0, limit).map(mapPost), nextCursor })
  })

  // 帖子详情（含评论列表，前端组装二级树；管理员可见隐藏内容）
  on('GET', '/api/community/posts/:id', true, async (ctx) => {
    const admin = await isAdmin(ctx.env, ctx.userId)
    const postWhere = admin ? 'p.id = ?' : 'p.id = ? AND p.is_hidden = 0'
    const post = await first(ctx.env, `${POST_SELECT} WHERE ${postWhere}`, ctx.userId, ctx.params.id)
    if (!post) throw new HttpError(404, '帖子不存在')
    const commentWhere = admin ? 'c.post_id = ?' : 'c.post_id = ? AND c.is_hidden = 0'
    const comments = await all(ctx.env, `
      SELECT c.*, COALESCE(s.user_name, u.username) AS user_name,
        (l.user_id IS NOT NULL) AS liked_by_me
      FROM community_comments c
      JOIN users u ON u.id = c.user_id
      LEFT JOIN user_settings s ON s.user_id = c.user_id
      LEFT JOIN community_likes l ON l.target_type = 'comment' AND l.target_id = c.id AND l.user_id = ?
      WHERE ${commentWhere}
      ORDER BY c.created_at ASC, c.id ASC`, ctx.userId, ctx.params.id)
    return Response.json({ post: mapPost(post), comments: comments.map(mapComment) })
  })

  // 发帖（每日首帖 +5 积分，按日期去重）
  on('POST', '/api/community/posts', true, async (ctx) => {
    rateLimit(ctx.request, 'community:post', 5)
    const b = await body(ctx.request)
    const content = String(b?.content ?? '').trim()
    if (!content || content.length > 5000) throw new HttpError(400, '帖子内容需为 1-5000 字')
    const type = POST_TYPES.includes(b?.type) ? b.type : 'share'
    const tags = (Array.isArray(b?.tags) ? b.tags : [])
      .filter((t: unknown) => typeof t === 'string').slice(0, 5)
      .map((t: string) => t.trim().slice(0, 20)).filter(Boolean)
    if (type === 'question' && !tags.some((t: string) => QUESTION_SUBJECT_TAGS.includes(t))) {
      throw new HttpError(400, '提问帖请选择科目标签（#高等数学 或 #英语）')
    }

    // 配图：仅接受本系统上传路径，且必须属于当前用户（防串用他人图片）；去重防同一图重复嵌入
    const rawImageUrls: unknown[] = Array.isArray(b?.imageUrls) ? b.imageUrls : []
    const imageUrls = [...new Set(rawImageUrls.filter((u): u is string => typeof u === 'string'))]
      .slice(0, IMAGE_MAX_PER_POST)
    if (imageUrls.length) {
      if (imageUrls.some(u => !/^\/api\/community\/images\/[a-f0-9]{16}$/.test(u))) {
        throw new HttpError(400, '图片地址无效')
      }
      const ids = imageUrls.map(u => u.split('/').pop()!)
      const owned = await all<{ id: string }>(ctx.env,
        `SELECT id FROM community_uploads WHERE user_id = ? AND id IN (${ids.map(() => '?').join(',')})`,
        ctx.userId, ...ids)
      if (owned.length !== new Set(ids).size) throw new HttpError(400, '图片不存在或已失效，请重新上传')
    }

    const id = uid()
    const now = nowSec()
    const stmts: D1PreparedStatement[] = [
      ctx.env.DB.prepare(
        'INSERT INTO community_posts (id, user_id, type, content, tags, image_urls, ref_type, ref_id, created_at, updated_at) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(id, ctx.userId, type, content, JSON.stringify(tags), JSON.stringify(imageUrls),
        typeof b?.refType === 'string' ? b.refType.slice(0, 20) : null,
        typeof b?.refId === 'string' ? b.refId.slice(0, 64) : null, now, now)
    ]
    const awarded = await first(ctx.env,
      'SELECT id FROM points_log WHERE user_id = ? AND date = ? AND reason = ?', ctx.userId, utc8Today(), '社区打卡')
    if (!awarded) stmts.push(...awardStatements(ctx.env, ctx.userId, 5, '社区打卡', id))
    await batch(ctx.env, stmts)

    const created = await first(ctx.env, `${POST_SELECT} WHERE p.id = ?`, ctx.userId, id)
    return Response.json(mapPost(created), { status: 201 })
  })

  // 删帖（作者或管理员；级联清理评论/点赞/通知/举报/配图）
  on('DELETE', '/api/community/posts/:id', true, async (ctx) => {
    const id = ctx.params.id
    const post = await first<{ user_id: string; image_urls: string }>(ctx.env,
      'SELECT user_id, image_urls FROM community_posts WHERE id = ?', id)
    if (!post) throw new HttpError(404, '帖子不存在')
    const isOwner = post.user_id === ctx.userId
    if (!isOwner && !(await isAdmin(ctx.env, ctx.userId))) throw new HttpError(403, '只能删除自己的帖子')
    // 回收该帖下全部评论产生的积分流水（评论帖子/收到评论），与单独删评论口径一致
    // 管理员删除时跳过积分回收——管理操作不应惩罚用户
    const commentIds = await all<{ id: string }>(ctx.env,
      'SELECT id FROM community_comments WHERE post_id = ?', id)
    const revoke: D1PreparedStatement[] = []
    if (isOwner) {
      for (const c of commentIds) revoke.push(...await revokeStatements(ctx.env, `srv:${c.id}`))
      // 回收帖子本身及全部评论的「获赞」流水（取消点赞之外的另一条点赞退出路径）
      revoke.push(...await revokeLikeStatements(ctx.env, 'post', [id]))
      revoke.push(...await revokeLikeStatements(ctx.env, 'comment', commentIds.map(c => c.id)))
    }
    await batch(ctx.env, [...revoke, ...postCascadeStatements(ctx.env, id)])
    // DB 删除成功后清理 R2 图片（失败仅留孤儿对象，不影响主流程）
    await deleteUploads(ctx.env, uploadIdsOf(post.image_urls))
    return Response.json({ ok: true })
  })

  // 发表评论（一级或二级回复）
  on('POST', '/api/community/posts/:id/comments', true, async (ctx) => {
    rateLimit(ctx.request, 'community:comment', 10)
    const postId = ctx.params.id
    const post = await first<{ user_id: string }>(ctx.env,
      'SELECT user_id FROM community_posts WHERE id = ? AND is_hidden = 0', postId)
    if (!post) throw new HttpError(404, '帖子不存在')

    const b = await body(ctx.request)
    const content = String(b?.content ?? '').trim()
    if (!content || content.length > 1000) throw new HttpError(400, '评论内容需为 1-1000 字')

    let parent: { user_id: string; parent_id: string | null } | null = null
    if (typeof b?.parentId === 'string' && b.parentId) {
      parent = await first(ctx.env,
        'SELECT user_id, parent_id FROM community_comments WHERE id = ? AND post_id = ? AND is_hidden = 0', b.parentId, postId)
      if (!parent) throw new HttpError(404, '回复的评论不存在')
      if (parent.parent_id) throw new HttpError(400, '最多回复二级评论')
    }

    const id = uid()
    const now = nowSec()
    const myName = await displayName(ctx.env, ctx.userId)
    const stmts: D1PreparedStatement[] = [
      ctx.env.DB.prepare(
        'INSERT INTO community_comments (id, post_id, user_id, parent_id, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).bind(id, postId, ctx.userId, parent ? b.parentId : null, content, now, now),
      ctx.env.DB.prepare('UPDATE community_posts SET comments_count = comments_count + 1 WHERE id = ?').bind(postId),
      ...awardStatements(ctx.env, ctx.userId, 1, '评论帖子', id)
    ]
    // 帖子作者 +2（自己评论自己的帖子不加）
    if (post.user_id !== ctx.userId) {
      stmts.push(...awardStatements(ctx.env, post.user_id, 2, '收到评论', id))
    }
    // 通知：回复 → 被回复的评论作者；一级评论 → 帖子作者（自己触发不通知）
    const notifyTarget = parent ? parent.user_id : post.user_id
    if (notifyTarget !== ctx.userId) {
      stmts.push(notifyStatement(ctx.env, {
        userId: notifyTarget, type: 'comment', actorId: ctx.userId, postId, commentId: id,
        content: `${myName} ${parent ? '回复了你的评论' : '评论了你的帖子'}`
      }))
    }
    await batch(ctx.env, stmts)

    return Response.json({
      id, postId, userId: ctx.userId, userName: myName,
      parentId: parent ? b.parentId : undefined,
      content, likesCount: 0, isHidden: false, likedByMe: false, createdAt: now
    }, { status: 201 })
  })

  // 删除评论（作者或管理员；级联删除其二级回复并回退帖子评论数）
  on('DELETE', '/api/community/comments/:id', true, async (ctx) => {
    const id = ctx.params.id
    const c = await first<{ post_id: string; user_id: string }>(ctx.env,
      'SELECT post_id, user_id FROM community_comments WHERE id = ?', id)
    if (!c) throw new HttpError(404, '评论不存在')
    const isOwner = c.user_id === ctx.userId
    if (!isOwner && !(await isAdmin(ctx.env, ctx.userId))) throw new HttpError(403, '只能删除自己的评论')
    // 回收该评论及其回复产生的积分流水（评论帖子/收到评论 + 获赞），防止反复评论+删除刷分
    // 管理员删除时跳过积分回收——管理操作不应惩罚用户
    const { statements, removedIds } = await commentCascadeStatements(ctx.env, id, c.post_id)
    const revoke: D1PreparedStatement[] = []
    if (isOwner) {
      for (const cid of removedIds) revoke.push(...await revokeStatements(ctx.env, `srv:${cid}`))
      revoke.push(...await revokeLikeStatements(ctx.env, 'comment', removedIds))
    }
    await batch(ctx.env, [...revoke, ...statements])
    return Response.json({ ok: true })
  })

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

    // 评论需额外取 post_id，让「赞了你的评论」通知可跳转到所属帖子
    const target = await first<{ user_id: string; post_id?: string }>(ctx.env,
      targetType === 'post'
        ? 'SELECT user_id FROM community_posts WHERE id = ? AND is_hidden = 0'
        : 'SELECT user_id, post_id FROM community_comments WHERE id = ? AND is_hidden = 0', targetId)
    if (!target) throw new HttpError(404, '内容不存在')

    const stmts: D1PreparedStatement[] = [
      ctx.env.DB.prepare('INSERT INTO community_likes (user_id, target_type, target_id, created_at) VALUES (?, ?, ?, ?)')
        .bind(ctx.userId, targetType, targetId, nowSec()),
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
    return Response.json({ liked: true })
  })

  // 提问帖标记解决/取消解决（仅楼主；采纳最佳答案属 P1，本期仅手动标记）
  on('PUT', '/api/community/posts/:id/resolve', true, async (ctx) => {
    rateLimit(ctx.request, 'community:resolve', 20)
    const post = await first<{ user_id: string; type: string; is_resolved: number }>(ctx.env,
      'SELECT user_id, type, is_resolved FROM community_posts WHERE id = ?', ctx.params.id)
    if (!post) throw new HttpError(404, '帖子不存在')
    if (post.user_id !== ctx.userId) throw new HttpError(403, '只有楼主可以标记解决状态')
    if (post.type !== 'question') throw new HttpError(400, '仅提问帖支持标记解决')
    const next = post.is_resolved ? 0 : 1
    await run(ctx.env, 'UPDATE community_posts SET is_resolved = ?, updated_at = ? WHERE id = ?',
      next, nowSec(), ctx.params.id)
    return Response.json({ isResolved: !!next })
  })

  // 每日打卡榜：今日打卡榜 TOP 10（今日已打卡者按当日积分降序）+ 连续打卡王 TOP 5（streak 降序）
  on('GET', '/api/community/leaderboard', true, async (ctx) => {
    const today = utc8Today()
    const [todayRows, streakRows, subjectRows] = await Promise.all([
      all<{ user_id: string; user_name: string; points: number; streak: number; today_points: number }>(ctx.env, `
        SELECT g.user_id, COALESCE(s.user_name, u.username) AS user_name, g.points, g.streak,
          SUM(pl.points) AS today_points
        FROM points_log pl
        JOIN gamification g ON g.user_id = pl.user_id AND g.last_checkin = ?
        JOIN users u ON u.id = pl.user_id
        LEFT JOIN user_settings s ON s.user_id = pl.user_id
        WHERE pl.date = ?
        GROUP BY pl.user_id
        ORDER BY today_points DESC, g.points DESC
        LIMIT 10`, today, today),
      all<{ user_id: string; user_name: string; points: number; streak: number }>(ctx.env, `
        SELECT g.user_id, COALESCE(s.user_name, u.username) AS user_name, g.points, g.streak
        FROM gamification g
        JOIN users u ON u.id = g.user_id
        LEFT JOIN user_settings s ON s.user_id = g.user_id
        WHERE g.streak > 0
        ORDER BY g.streak DESC, g.points DESC
        LIMIT 5`),
      all<{ user_id: string; name: string }>(ctx.env, `
        SELECT DISTINCT r.user_id, sb.name FROM study_records r
        JOIN subjects sb ON sb.user_id = r.user_id AND sb.id = r.subject_id
        WHERE r.date = ?`, today)
    ])
    const subjMap = new Map<string, string[]>()
    for (const r of subjectRows) {
      const list = subjMap.get(r.user_id) || []
      list.push(r.name)
      subjMap.set(r.user_id, list)
    }
    return Response.json({
      today: todayRows.map(r => ({
        userName: r.user_name || '升本人', todayPoints: r.today_points,
        streak: r.streak, totalPoints: r.points, subjects: subjMap.get(r.user_id) ?? []
      })),
      streak: streakRows.map(r => ({
        userName: r.user_name || '升本人', streak: r.streak, totalPoints: r.points
      }))
    })
  })

  // 举报帖子/评论（举报人匿名，仅管理员可见；同一内容重复举报去重）
  on('POST', '/api/community/reports', true, async (ctx) => {
    rateLimit(ctx.request, 'community:report', 10)
    const b = await body(ctx.request)
    const targetType = b?.targetType === 'comment' ? 'comment' : b?.targetType === 'post' ? 'post' : null
    const targetId = typeof b?.targetId === 'string' ? b.targetId : ''
    const reason = String(b?.reason ?? '')
    const detail = String(b?.detail ?? '').trim().slice(0, 200)
    if (!targetType || !targetId) throw new HttpError(400, '参数错误')
    if (!REPORT_REASONS.includes(reason)) throw new HttpError(400, '举报原因无效')
    if (reason === '其他' && !detail) throw new HttpError(400, '选择「其他」时请填写补充说明')
    const table = targetType === 'post' ? 'community_posts' : 'community_comments'
    const target = await first<{ user_id: string }>(ctx.env,
      `SELECT user_id FROM ${table} WHERE id = ? AND is_hidden = 0`, targetId)
    if (!target) throw new HttpError(404, '内容不存在')
    if (target.user_id === ctx.userId) throw new HttpError(400, '不能举报自己的内容')
    const dup = await first(ctx.env,
      "SELECT id FROM community_reports WHERE reporter_id = ? AND target_type = ? AND target_id = ? AND status = 'pending'",
      ctx.userId, targetType, targetId)
    if (dup) throw new HttpError(400, '你已举报过该内容，请等待处理')
    await run(ctx.env,
      "INSERT INTO community_reports (id, reporter_id, target_type, target_id, reason, detail, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)",
      uid(), ctx.userId, targetType, targetId, reason, detail, nowSec())
    return Response.json({ ok: true }, { status: 201 })
  })

  // 通知列表（含未读数）
  on('GET', '/api/community/notifications', true, async (ctx) => {
    const url = new URL(ctx.request.url)
    const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '') || 20, 1), MAX_PAGE)
    const cursor = url.searchParams.get('cursor') || ''

    let sql = `
      SELECT n.*, COALESCE(s.user_name, u.username) AS actor_name
      FROM community_notifications n
      LEFT JOIN users u ON u.id = n.actor_id
      LEFT JOIN user_settings s ON s.user_id = n.actor_id
      WHERE n.user_id = ?`
    const params: unknown[] = [ctx.userId]
    const c = cursor ? parseCursor(cursor) : null
    if (c) {
      sql += ' AND (n.created_at < ? OR (n.created_at = ? AND n.id < ?))'
      params.push(c.ts, c.ts, c.id)
    }
    sql += ' ORDER BY n.created_at DESC, n.id DESC LIMIT ?'
    params.push(limit + 1)

    const rows = await all(ctx.env, sql, ...params)
    const unread = await first<{ n: number }>(ctx.env,
      'SELECT COUNT(*) AS n FROM community_notifications WHERE user_id = ? AND is_read = 0', ctx.userId)
    let nextCursor: string | null = null
    if (rows.length > limit) {
      const last = rows[limit - 1] as any
      nextCursor = `${last.created_at}_${last.id}`
    }
    return Response.json({ items: rows.slice(0, limit).map(mapNotification), unreadCount: unread?.n ?? 0, nextCursor })
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
