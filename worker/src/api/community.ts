import type { Env } from '../index'
import { on, body } from '../router'
import { all, first, run, batch, uid, utc8Today, HttpError } from '../db'
import { rateLimit } from '../middleware/rateLimit'
import { deleteUploads, uploadIdsOf, IMAGE_MAX_PER_POST, IMAGE_MAX_PER_COMMENT } from './uploads'
import { assertClean } from './sensitive'
import { awardBadge, hasBadge } from './badges'

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
    userVerified: !!r.user_verified,
    type: r.type,
    content: r.content,
    tags: parseStrArray(r.tags),
    imageUrls: parseStrArray(r.image_urls),
    isResolved: !!r.is_resolved,
    acceptedAnswerId: r.accepted_answer_id ?? undefined,
    isFeatured: !!r.is_featured,
    isDaily: !!r.is_daily,
    circleId: r.circle_id ?? undefined,
    circleName: r.circle_name ?? undefined,
    topicRef: r.topic_ref ?? undefined,
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
    imageUrls: parseStrArray(r.image_urls),
    userVerified: !!r.user_verified,
    likesCount: r.likes_count,
    isAccepted: !!r.is_accepted,
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
    u.verified AS user_verified, ci.name AS circle_name,
    (l.user_id IS NOT NULL) AS liked_by_me
  FROM community_posts p
  JOIN users u ON u.id = p.user_id
  LEFT JOIN user_settings s ON s.user_id = p.user_id
  LEFT JOIN gamification g ON g.user_id = p.user_id
  LEFT JOIN community_circles ci ON ci.id = p.circle_id
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

// ---------- 圈子辅助 ----------

interface CircleRow { id: string; is_public: number }

/** 圈子可读性校验：审核圈仅活跃成员/管理员可读其帖子流 */
async function assertCircleReadable(ctx: { env: Env; userId: string }, circleId: string): Promise<CircleRow> {
  const circle = await first<CircleRow>(ctx.env,
    'SELECT id, is_public FROM community_circles WHERE id = ?', circleId)
  if (!circle) throw new HttpError(404, '圈子不存在')
  if (!circle.is_public) {
    const member = await first<{ user_id: string }>(ctx.env,
      "SELECT user_id FROM circle_members WHERE circle_id = ? AND user_id = ? AND status = 'active'", circleId, ctx.userId)
    if (!member && !(await isAdmin(ctx.env, ctx.userId))) throw new HttpError(403, '审核圈内容仅成员可见')
  }
  return circle
}

function mapCircle(r: any, myStatus?: string | null) {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    creatorId: r.creator_id,
    isPublic: !!r.is_public,
    memberCount: r.member_count,
    createdAt: r.created_at,
    myStatus: myStatus ?? null // 'owner' | 'member' | 'pending' | null
  }
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

/** 删评论级联清理语句：通知/点赞/举报/评论本体及二级回复 + 帖子计数回退 + 采纳状态解除；
 *  同时返回被删 id 列表与待清理的配图上传 id（R2 清理由调用方在 batch 成功后执行） */
export async function commentCascadeStatements(env: Env, commentId: string, postId: string): Promise<{ statements: D1PreparedStatement[]; removedIds: string[]; imageIds: string[] }> {
  const replies = await all<{ id: string }>(env,
    'SELECT id FROM community_comments WHERE parent_id = ?', commentId)
  const removedIds = [commentId, ...replies.map(r => r.id)]
  const ph = removedIds.map(() => '?').join(',')
  const imgRows = await all<{ image_urls: string }>(env,
    `SELECT image_urls FROM community_comments WHERE id IN (${ph})`, ...removedIds)
  const imageIds = imgRows.flatMap(r => uploadIdsOf(r.image_urls))
  return {
    removedIds,
    imageIds,
    statements: [
      // 清理这些评论触发的通知（被评论/被回复/被赞评论），避免通知指向已删除内容
      env.DB.prepare(`DELETE FROM community_notifications WHERE comment_id IN (${ph})`).bind(...removedIds),
      env.DB.prepare(`DELETE FROM community_likes WHERE target_type = 'comment' AND target_id IN (${ph})`).bind(...removedIds),
      env.DB.prepare(`DELETE FROM community_reports WHERE target_type = 'comment' AND target_id IN (${ph})`).bind(...removedIds),
      env.DB.prepare(`DELETE FROM community_comments WHERE id IN (${ph})`).bind(...removedIds),
      env.DB.prepare('UPDATE community_posts SET comments_count = MAX(comments_count - ?, 0) WHERE id = ?')
        .bind(removedIds.length, postId),
      // 被删评论若为最佳答案：解除采纳并回退为待解答（采纳积分回收由调用方按需执行）
      env.DB.prepare('UPDATE community_posts SET accepted_answer_id = NULL, is_resolved = 0 WHERE id = ? AND accepted_answer_id = ?')
        .bind(postId, commentId)
    ]
  }
}

// ---------- 路由 ----------

export function registerCommunityRoutes() {
  // 帖子列表（游标分页；默认仅广场公开帖，circle 参数显式指定圈内流）
  on('GET', '/api/community/posts', true, async (ctx) => {
    const url = new URL(ctx.request.url)
    const sort = url.searchParams.get('sort') === 'hot' ? 'hot' : 'latest'
    const tag = (url.searchParams.get('tag') || '').trim()
    const type = (url.searchParams.get('type') || '').trim()
    const featured = url.searchParams.get('featured') === '1'
    const follow = url.searchParams.get('follow') === '1'
    const circleId = (url.searchParams.get('circle') || '').trim()
    // 知识点讨论流：subjectId + chapter（经「去社区讨论」入口；讨论帖不进公共广场）
    const topicSubject = (url.searchParams.get('topicSubject') || '').trim()
    const topicChapter = (url.searchParams.get('topicChapter') || '').trim()
    const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '') || 20, 1), MAX_PAGE)
    const cursor = url.searchParams.get('cursor') || ''

    const admin = await isAdmin(ctx.env, ctx.userId)
    const where: string[] = []
    if (!admin) where.push('p.is_hidden = 0')
    const params: unknown[] = [ctx.userId]
    if (type && POST_TYPES.includes(type)) { where.push('p.type = ?'); params.push(type) }
    if (tag) { where.push(`p.tags LIKE ? ESCAPE '\\'`); params.push(`%"${escapeLike(tag)}"%`) }
    if (featured) where.push('p.is_featured = 1')
    // 关注流：仅展示我关注的作者的帖子（子查询走 user_follows 主键索引）
    if (follow) { where.push('p.user_id IN (SELECT followee_id FROM user_follows WHERE follower_id = ?)'); params.push(ctx.userId) }
    // 知识点讨论流：按 topic_ref 精确匹配（'subjectId|chapterName'）
    if (topicSubject && topicChapter) {
      where.push('p.topic_ref = ?'); params.push(`${topicSubject}|${topicChapter}`)
    } else if (circleId) {
      // 圈子流：审核圈仅活跃成员可见；未指定 circle 时默认排除圈子帖（圈内专属）
      await assertCircleReadable(ctx, circleId)
      where.push('p.circle_id = ?'); params.push(circleId)
    } else {
      // 广场公开流：排除圈子帖与知识点讨论帖
      where.push('p.circle_id IS NULL')
      where.push('p.topic_ref IS NULL')
    }

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
        u.verified AS user_verified,
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
    assertClean(content)
    const type = POST_TYPES.includes(b?.type) ? b.type : 'share'
    const tags = (Array.isArray(b?.tags) ? b.tags : [])
      .filter((t: unknown) => typeof t === 'string').slice(0, 5)
      .map((t: string) => t.trim().slice(0, 20)).filter(Boolean)
    for (const t of tags) assertClean(t) // 标签同样过敏感词，防止绕过内容过滤
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

    // 圈内发帖：必须是该圈活跃成员
    let circleId: string | null = null
    if (typeof b?.circleId === 'string' && b.circleId) {
      circleId = b.circleId
      const member = await first<{ user_id: string }>(ctx.env,
        "SELECT user_id FROM circle_members WHERE circle_id = ? AND user_id = ? AND status = 'active'", circleId, ctx.userId)
      if (!member) throw new HttpError(403, '仅圈子成员可在圈内发帖')
    }

    // 知识点讨论帖：topicRef = 'subjectId|chapterName'（与圈子互斥，不进公共广场）
    let topicRef: string | null = null
    if (typeof b?.topicRef === 'string' && b.topicRef) {
      const sep = b.topicRef.indexOf('|')
      const subjectId = b.topicRef.slice(0, sep)
      const chapterName = b.topicRef.slice(sep + 1)
      if (sep <= 0 || !subjectId || !chapterName || subjectId.length > 40 || chapterName.length > 60) {
        throw new HttpError(400, '讨论区参数无效')
      }
      topicRef = `${subjectId}|${chapterName}`
    }
    if (circleId && topicRef) throw new HttpError(400, '不能同时发到圈子和讨论区')

    const id = uid()
    const now = nowSec()
    const stmts: D1PreparedStatement[] = [
      ctx.env.DB.prepare(
        'INSERT INTO community_posts (id, user_id, type, content, tags, image_urls, circle_id, topic_ref, ref_type, ref_id, created_at, updated_at) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(id, ctx.userId, type, content, JSON.stringify(tags), JSON.stringify(imageUrls), circleId, topicRef,
        typeof b?.refType === 'string' ? b.refType.slice(0, 20) : null,
        typeof b?.refId === 'string' ? b.refId.slice(0, 64) : null, now, now)
    ]
    const awarded = await first(ctx.env,
      'SELECT id FROM points_log WHERE user_id = ? AND date = ? AND reason = ?', ctx.userId, utc8Today(), '社区打卡')
    if (!awarded) stmts.push(...awardStatements(ctx.env, ctx.userId, 5, '社区打卡', id))
    await batch(ctx.env, stmts)

    // 徽章：首次发帖 / 首次提问（主键去重，仅首次发放并通知）
    const myPostCount = await first<{ n: number }>(ctx.env,
      'SELECT COUNT(*) AS n FROM community_posts WHERE user_id = ?', ctx.userId)
    if (myPostCount?.n === 1) await awardBadge(ctx.env, ctx.userId, 'first_post')
    if (type === 'question') {
      const myQCount = await first<{ n: number }>(ctx.env,
        "SELECT COUNT(*) AS n FROM community_posts WHERE user_id = ? AND type = 'question'", ctx.userId)
      if (myQCount?.n === 1) await awardBadge(ctx.env, ctx.userId, 'first_question')
    }

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
    // 回收该帖下全部评论产生的积分流水（评论帖子/收到评论/回答被采纳/提问被解答），与单独删评论口径一致
    // 管理员删除时跳过积分回收——管理操作不应惩罚用户
    const commentRows = await all<{ id: string; image_urls: string }>(ctx.env,
      'SELECT id, image_urls FROM community_comments WHERE post_id = ?', id)
    const commentIds = commentRows.map(c => c.id)
    const revoke: D1PreparedStatement[] = []
    if (isOwner) {
      for (const cid of commentIds) {
        revoke.push(...await revokeStatements(ctx.env, `srv:${cid}`))
        revoke.push(...await revokeStatements(ctx.env, `srv:accept:${cid}`))
      }
      // 回收帖子本身及全部评论的「获赞」流水（取消点赞之外的另一条点赞退出路径）
      revoke.push(...await revokeLikeStatements(ctx.env, 'post', [id]))
      revoke.push(...await revokeLikeStatements(ctx.env, 'comment', commentIds))
    }
    await batch(ctx.env, [...revoke, ...postCascadeStatements(ctx.env, id)])
    // DB 删除成功后清理 R2 图片：帖子配图 + 全部评论配图（失败仅留孤儿对象，不影响主流程）
    await deleteUploads(ctx.env, [
      ...uploadIdsOf(post.image_urls),
      ...commentRows.flatMap(c => uploadIdsOf(c.image_urls))
    ])
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
    assertClean(content)

    // 评论配图（最多 3 张）：与发帖同一口径——仅认本系统上传路径且必须属于当前用户
    const rawImageUrls: unknown[] = Array.isArray(b?.imageUrls) ? b.imageUrls : []
    const imageUrls = [...new Set(rawImageUrls.filter((u): u is string => typeof u === 'string'))]
      .slice(0, IMAGE_MAX_PER_COMMENT)
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
        'INSERT INTO community_comments (id, post_id, user_id, parent_id, content, image_urls, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(id, postId, ctx.userId, parent ? b.parentId : null, content, JSON.stringify(imageUrls), now, now),
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
      content, imageUrls, likesCount: 0, isAccepted: false, isHidden: false, likedByMe: false, createdAt: now
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
    // 回收该评论及其回复产生的积分流水（评论帖子/收到评论/采纳积分 + 获赞），防止反复评论+删除刷分
    // 管理员删除时跳过积分回收——管理操作不应惩罚用户
    const { statements, removedIds, imageIds } = await commentCascadeStatements(ctx.env, id, c.post_id)
    const revoke: D1PreparedStatement[] = []
    if (isOwner) {
      for (const cid of removedIds) {
        revoke.push(...await revokeStatements(ctx.env, `srv:${cid}`))
        revoke.push(...await revokeStatements(ctx.env, `srv:accept:${cid}`))
      }
      revoke.push(...await revokeLikeStatements(ctx.env, 'comment', removedIds))
    }
    await batch(ctx.env, [...revoke, ...statements])
    // DB 删除成功后清理评论配图（失败仅留孤儿对象，不影响主流程）
    await deleteUploads(ctx.env, imageIds)
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
    // 徽章：百赞达人（帖子+评论累计获赞 ≥100；已持有者跳过统计查询）
    if (target.user_id !== ctx.userId && !(await hasBadge(ctx.env, target.user_id, 'likes_100'))) {
      const total = await first<{ n: number }>(ctx.env,
        `SELECT (SELECT COALESCE(SUM(likes_count), 0) FROM community_posts WHERE user_id = ?)
              + (SELECT COALESCE(SUM(likes_count), 0) FROM community_comments WHERE user_id = ?) AS n`,
        target.user_id, target.user_id)
      if ((total?.n ?? 0) >= 100) await awardBadge(ctx.env, target.user_id, 'likes_100')
    }
    return Response.json({ liked: true })
  })

  // 提问帖标记解决/取消解决（仅楼主；已采纳最佳答案时需先取消采纳，避免「已采纳但未解答」矛盾态）
  on('PUT', '/api/community/posts/:id/resolve', true, async (ctx) => {
    rateLimit(ctx.request, 'community:resolve', 20)
    const post = await first<{ user_id: string; type: string; is_resolved: number; accepted_answer_id: string | null }>(ctx.env,
      'SELECT user_id, type, is_resolved, accepted_answer_id FROM community_posts WHERE id = ?', ctx.params.id)
    if (!post) throw new HttpError(404, '帖子不存在')
    if (post.user_id !== ctx.userId) throw new HttpError(403, '只有楼主可以标记解决状态')
    if (post.type !== 'question') throw new HttpError(400, '仅提问帖支持标记解决')
    if (post.accepted_answer_id) throw new HttpError(400, '已采纳最佳答案，请先取消采纳')
    const next = post.is_resolved ? 0 : 1
    await run(ctx.env, 'UPDATE community_posts SET is_resolved = ?, updated_at = ? WHERE id = ?',
      next, nowSec(), ctx.params.id)
    return Response.json({ isResolved: !!next })
  })

  // 采纳/取消采纳最佳答案（仅提问帖楼主；改采纳 = 先回收旧采纳再写入新采纳，同一事务）
  // 积分：被采纳者 +10「回答被采纳」、提问者 +3「提问被解答」，取消/改采纳按 refId 精确回收（防刷分）
  on('PUT', '/api/community/posts/:id/accept', true, async (ctx) => {
    rateLimit(ctx.request, 'community:accept', 20)
    const b = await body(ctx.request)
    const commentId = typeof b?.commentId === 'string' ? b.commentId : ''
    if (!commentId) throw new HttpError(400, '参数错误')
    const post = await first<{ user_id: string; type: string; accepted_answer_id: string | null }>(ctx.env,
      'SELECT user_id, type, accepted_answer_id FROM community_posts WHERE id = ? AND is_hidden = 0', ctx.params.id)
    if (!post) throw new HttpError(404, '帖子不存在')
    if (post.user_id !== ctx.userId) throw new HttpError(403, '只有楼主可以采纳最佳答案')
    if (post.type !== 'question') throw new HttpError(400, '仅提问帖支持采纳最佳答案')
    const comment = await first<{ user_id: string; parent_id: string | null }>(ctx.env,
      'SELECT user_id, parent_id FROM community_comments WHERE id = ? AND post_id = ? AND is_hidden = 0', commentId, ctx.params.id)
    if (!comment) throw new HttpError(404, '评论不存在')
    if (comment.parent_id) throw new HttpError(400, '仅一级评论可被采纳为最佳答案')
    if (comment.user_id === ctx.userId) throw new HttpError(400, '不能采纳自己的评论')

    const now = nowSec()
    const stmts: D1PreparedStatement[] = []
    // 已有采纳：取消（同一评论）或改采纳（不同评论）——先回收旧采纳的积分流水、评论标记与采纳通知
    // （通知撤回与「取消点赞撤回通知」同一口径，避免被采纳者看到通知但积分已回收；
    //   仅删除采纳文案通知，兼容同评论上可能存在的徽章通知——徽章永久保留不随采纳回收）
    if (post.accepted_answer_id) {
      stmts.push(...await revokeStatements(ctx.env, `srv:accept:${post.accepted_answer_id}`))
      stmts.push(ctx.env.DB.prepare('UPDATE community_comments SET is_accepted = 0 WHERE id = ?').bind(post.accepted_answer_id))
      stmts.push(ctx.env.DB.prepare("DELETE FROM community_notifications WHERE type = 'achievement' AND comment_id = ? AND content LIKE '%采纳了你的回答%'").bind(post.accepted_answer_id))
    }
    if (post.accepted_answer_id === commentId) {
      // 取消采纳：回退为待解答
      stmts.push(ctx.env.DB.prepare('UPDATE community_posts SET accepted_answer_id = NULL, is_resolved = 0, updated_at = ? WHERE id = ?')
        .bind(now, ctx.params.id))
      await batch(ctx.env, stmts)
      return Response.json({ acceptedAnswerId: null, isResolved: false })
    }
    const myName = await displayName(ctx.env, ctx.userId)
    stmts.push(
      ctx.env.DB.prepare('UPDATE community_posts SET accepted_answer_id = ?, is_resolved = 1, updated_at = ? WHERE id = ?')
        .bind(commentId, now, ctx.params.id),
      ctx.env.DB.prepare('UPDATE community_comments SET is_accepted = 1 WHERE id = ?').bind(commentId),
      ...awardStatements(ctx.env, comment.user_id, 10, '回答被采纳', `accept:${commentId}`),
      ...awardStatements(ctx.env, ctx.userId, 3, '提问被解答', `accept:${commentId}`),
      notifyStatement(ctx.env, {
        userId: comment.user_id, type: 'achievement', actorId: ctx.userId, postId: ctx.params.id, commentId,
        content: `${myName} 采纳了你的回答，+10 积分`
      })
    )
    await batch(ctx.env, stmts)
    // 徽章：答疑专家（回答被采纳 ≥10 次；已持有者跳过统计查询）
    if (!(await hasBadge(ctx.env, comment.user_id, 'answer_expert'))) {
      const accepted = await first<{ n: number }>(ctx.env,
        'SELECT COUNT(*) AS n FROM community_comments WHERE user_id = ? AND is_accepted = 1', comment.user_id)
      if ((accepted?.n ?? 0) >= 10) await awardBadge(ctx.env, comment.user_id, 'answer_expert')
    }
    return Response.json({ acceptedAnswerId: commentId, isResolved: true })
  })

  // ---------- 私信 ----------

  // 会话列表：每个对话方的最新一条消息 + 未读数（按最新消息倒序）
  on('GET', '/api/community/messages/conversations', true, async (ctx) => {
    // 用相关方的最大 created_at 分组聚合；未读数仅统计「发给我且未读」
    const rows = await all<any>(ctx.env, `
      SELECT m.*, COALESCE(s.user_name, u.username) AS peer_name, u.verified AS peer_verified
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
    return Response.json({
      conversations: rows.map(r => {
        const peerId = r.from_id === ctx.userId ? r.to_id : r.from_id
        return {
          peerId,
          peerName: r.peer_name || '升本人',
          peerVerified: !!r.peer_verified,
          lastContent: r.content.slice(0, 60),
          lastAt: r.created_at,
          lastFromMe: r.from_id === ctx.userId,
          unread: unreadMap.get(peerId) ?? 0
        }
      })
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
    // 标为已读（对方发来的未读消息）
    await run(ctx.env,
      'UPDATE community_messages SET is_read = 1 WHERE from_id = ? AND to_id = ? AND is_read = 0', peerId, ctx.userId)
    return Response.json({
      messages: items.map(r => ({
        id: r.id, fromId: r.from_id, toId: r.to_id, content: r.content,
        isRead: !!r.is_read, createdAt: r.created_at, fromMe: r.from_id === ctx.userId
      })),
      nextCursor: rows.length > limit ? String(items[items.length - 1].created_at) : null
    })
  })

  // 发送私信（限流 + 敏感词 + 通知对方；单向模式无需互关）
  on('POST', '/api/community/messages/:peerId', true, async (ctx) => {
    rateLimit(ctx.request, 'community:msg', 30)
    const peerId = ctx.params.peerId
    if (peerId === ctx.userId) throw new HttpError(400, '不能给自己发私信')
    const peer = await first<{ id: string }>(ctx.env, 'SELECT id FROM users WHERE id = ?', peerId)
    if (!peer) throw new HttpError(404, '用户不存在')
    const b = await body(ctx.request)
    const content = String(b?.content ?? '').trim()
    if (!content || content.length > 500) throw new HttpError(400, '私信内容需为 1-500 字')
    assertClean(content)
    const id = uid()
    const now = nowSec()
    const myName = await displayName(ctx.env, ctx.userId)
    await batch(ctx.env, [
      ctx.env.DB.prepare('INSERT INTO community_messages (id, from_id, to_id, content, created_at) VALUES (?, ?, ?, ?, ?)')
        .bind(id, ctx.userId, peerId, content, now),
      notifyStatement(ctx.env, {
        userId: peerId, type: 'message', actorId: ctx.userId,
        content: `${myName} 给你发来私信：${content.slice(0, 40)}${content.length > 40 ? '…' : ''}`
      })
    ])
    return Response.json({ id, fromId: ctx.userId, toId: peerId, content, isRead: false, createdAt: now, fromMe: true }, { status: 201 })
  })

  // 私信未读总数（并入顶栏通知角标）
  on('GET', '/api/community/messages/unread-count', true, async (ctx) => {
    const r = await first<{ n: number }>(ctx.env,
      'SELECT COUNT(*) AS n FROM community_messages WHERE to_id = ? AND is_read = 0', ctx.userId)
    return Response.json({ count: r?.n ?? 0 })
  })

  // ---------- 话题圈子 ----------

  // 圈子列表（按成员数倒序；附我的加入状态）
  on('GET', '/api/community/circles', true, async (ctx) => {
    const rows = await all<any>(ctx.env, `
      SELECT c.*, m.role AS my_role, m.status AS my_member_status
      FROM community_circles c
      LEFT JOIN circle_members m ON m.circle_id = c.id AND m.user_id = ?
      ORDER BY c.member_count DESC, c.created_at DESC
      LIMIT 100`, ctx.userId)
    return Response.json({
      circles: rows.map(r => mapCircle(r,
        r.my_role === 'owner' ? 'owner' : r.my_member_status === 'active' ? 'member' : r.my_member_status === 'pending' ? 'pending' : null))
    })
  })

  // 建圈（创建者自动成为圈主；名称过敏感词）
  on('POST', '/api/community/circles', true, async (ctx) => {
    rateLimit(ctx.request, 'community:circle', 10)
    const b = await body(ctx.request)
    const name = String(b?.name ?? '').trim()
    const description = String(b?.description ?? '').trim().slice(0, 200)
    if (!name || name.length > 30) throw new HttpError(400, '圈子名称需为 1-30 字')
    assertClean(name)
    if (description) assertClean(description)
    const isPublic = b?.isPublic !== false // 默认公开
    const id = uid()
    const now = nowSec()
    await batch(ctx.env, [
      ctx.env.DB.prepare(
        'INSERT INTO community_circles (id, name, description, creator_id, is_public, member_count, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)'
      ).bind(id, name, description, ctx.userId, isPublic ? 1 : 0, now),
      ctx.env.DB.prepare(
        "INSERT INTO circle_members (circle_id, user_id, role, status, created_at) VALUES (?, ?, 'owner', 'active', ?)"
      ).bind(id, ctx.userId, now)
    ])
    return Response.json(mapCircle(await first(ctx.env, 'SELECT * FROM community_circles WHERE id = ?', id), 'owner'), { status: 201 })
  })

  // 圈子详情：基本信息 + 活跃成员（前 50）；圈主可见待审批列表
  on('GET', '/api/community/circles/:id', true, async (ctx) => {
    const circle = await first<any>(ctx.env, 'SELECT * FROM community_circles WHERE id = ?', ctx.params.id)
    if (!circle) throw new HttpError(404, '圈子不存在')
    const members = await all<any>(ctx.env, `
      SELECT m.user_id, m.role, COALESCE(s.user_name, u.username) AS user_name, u.verified
      FROM circle_members m
      JOIN users u ON u.id = m.user_id
      LEFT JOIN user_settings s ON s.user_id = m.user_id
      WHERE m.circle_id = ? AND m.status = 'active'
      ORDER BY CASE m.role WHEN 'owner' THEN 0 ELSE 1 END, m.created_at ASC
      LIMIT 50`, ctx.params.id)
    const mine = await first<{ role: string; status: string }>(ctx.env,
      'SELECT role, status FROM circle_members WHERE circle_id = ? AND user_id = ?', ctx.params.id, ctx.userId)
    const myStatus = !mine ? null : mine.role === 'owner' ? 'owner' : mine.status === 'active' ? 'member' : 'pending'
    // 待审批列表仅圈主可见
    let pending: any[] = []
    if (mine?.role === 'owner') {
      pending = await all<any>(ctx.env, `
        SELECT m.user_id, COALESCE(s.user_name, u.username) AS user_name, m.created_at
        FROM circle_members m
        JOIN users u ON u.id = m.user_id
        LEFT JOIN user_settings s ON s.user_id = m.user_id
        WHERE m.circle_id = ? AND m.status = 'pending'
        ORDER BY m.created_at ASC`, ctx.params.id)
    }
    return Response.json({
      circle: mapCircle(circle, myStatus),
      members: members.map(m => ({ userId: m.user_id, userName: m.user_name || '升本人', role: m.role, verified: !!m.verified })),
      pending: pending.map(p => ({ userId: p.user_id, userName: p.user_name || '升本人', createdAt: p.created_at }))
    })
  })

  // 加入/退圈 toggle：非成员→加入（公开圈直接 active；审核圈 pending 并通知圈主）；
  // active→退圈；pending→取消申请。圈主不能退出自己创建的圈。
  on('PUT', '/api/community/circles/:id/join', true, async (ctx) => {
    rateLimit(ctx.request, 'community:circle', 30)
    const circle = await first<any>(ctx.env, 'SELECT * FROM community_circles WHERE id = ?', ctx.params.id)
    if (!circle) throw new HttpError(404, '圈子不存在')
    const mine = await first<{ role: string; status: string }>(ctx.env,
      'SELECT role, status FROM circle_members WHERE circle_id = ? AND user_id = ?', ctx.params.id, ctx.userId)

    if (mine?.status === 'active') {
      if (mine.role === 'owner') throw new HttpError(400, '圈主不能退出自己创建的圈子')
      await batch(ctx.env, [
        ctx.env.DB.prepare('DELETE FROM circle_members WHERE circle_id = ? AND user_id = ?').bind(ctx.params.id, ctx.userId),
        ctx.env.DB.prepare('UPDATE community_circles SET member_count = MAX(member_count - 1, 0) WHERE id = ?').bind(ctx.params.id)
      ])
      return Response.json({ status: null })
    }
    if (mine?.status === 'pending') {
      // 取消申请：同时撤回给圈主的申请通知（按内容精确匹配，与采纳通知撤回同口径）
      await batch(ctx.env, [
        ctx.env.DB.prepare('DELETE FROM circle_members WHERE circle_id = ? AND user_id = ?').bind(ctx.params.id, ctx.userId),
        ctx.env.DB.prepare("DELETE FROM community_notifications WHERE type = 'system' AND actor_id = ? AND user_id = ? AND content LIKE '%申请加入圈子%'")
          .bind(ctx.userId, circle.creator_id)
      ])
      return Response.json({ status: null })
    }
    // 新加入
    const status = circle.is_public ? 'active' : 'pending'
    const myName = await displayName(ctx.env, ctx.userId)
    const stmts: D1PreparedStatement[] = [
      ctx.env.DB.prepare('INSERT INTO circle_members (circle_id, user_id, role, status, created_at) VALUES (?, ?, ?, ?, ?)')
        .bind(ctx.params.id, ctx.userId, 'member', status, nowSec())
    ]
    if (status === 'active') {
      stmts.push(ctx.env.DB.prepare('UPDATE community_circles SET member_count = member_count + 1 WHERE id = ?').bind(ctx.params.id))
    } else {
      stmts.push(notifyStatement(ctx.env, {
        userId: circle.creator_id, type: 'system', actorId: ctx.userId,
        content: `${myName} 申请加入圈子「${circle.name}」，请到圈子详情页审批`
      }))
    }
    await batch(ctx.env, stmts)
    return Response.json({ status })
  })

  // 圈主批准申请（pending → active，通知申请人）
  on('PUT', '/api/community/circles/:id/members/:uid/approve', true, async (ctx) => {
    rateLimit(ctx.request, 'community:circle', 30)
    const circle = await first<any>(ctx.env, 'SELECT id, name, creator_id FROM community_circles WHERE id = ?', ctx.params.id)
    if (!circle) throw new HttpError(404, '圈子不存在')
    if (circle.creator_id !== ctx.userId) throw new HttpError(403, '仅圈主可审批')
    const updated = await run(ctx.env,
      "UPDATE circle_members SET status = 'active' WHERE circle_id = ? AND user_id = ? AND status = 'pending'",
      ctx.params.id, ctx.params.uid)
    if (!updated.meta.changes) throw new HttpError(404, '申请不存在或已处理')
    await batch(ctx.env, [
      ctx.env.DB.prepare('UPDATE community_circles SET member_count = member_count + 1 WHERE id = ?').bind(ctx.params.id),
      notifyStatement(ctx.env, {
        userId: ctx.params.uid, type: 'system',
        content: `🎉 你加入圈子「${circle.name}」的申请已通过`
      })
    ])
    return Response.json({ ok: true })
  })

  // 圈主移除成员 / 拒绝申请
  on('DELETE', '/api/community/circles/:id/members/:uid', true, async (ctx) => {
    rateLimit(ctx.request, 'community:circle', 30)
    const circle = await first<any>(ctx.env, 'SELECT id, creator_id FROM community_circles WHERE id = ?', ctx.params.id)
    if (!circle) throw new HttpError(404, '圈子不存在')
    if (circle.creator_id !== ctx.userId) throw new HttpError(403, '仅圈主可移除成员')
    if (ctx.params.uid === circle.creator_id) throw new HttpError(400, '不能移除圈主')
    const target = await first<{ status: string }>(ctx.env,
      'SELECT status FROM circle_members WHERE circle_id = ? AND user_id = ?', ctx.params.id, ctx.params.uid)
    if (!target) throw new HttpError(404, '成员不存在')
    await batch(ctx.env, [
      ctx.env.DB.prepare('DELETE FROM circle_members WHERE circle_id = ? AND user_id = ?').bind(ctx.params.id, ctx.params.uid),
      ...(target.status === 'active'
        ? [ctx.env.DB.prepare('UPDATE community_circles SET member_count = MAX(member_count - 1, 0) WHERE id = ?').bind(ctx.params.id)]
        : [])
    ])
    return Response.json({ ok: true })
  })

  // 用户资料卡：社区公开荣誉信息（等级/连续打卡/徽章墙/专家认证），不含私有学习数据
  on('GET', '/api/community/users/:id/profile', true, async (ctx) => {
    const u = await first<any>(ctx.env, `
      SELECT u.id, COALESCE(s.user_name, u.username) AS user_name, u.verified, u.expertise,
        COALESCE(g.points, 0) AS points, COALESCE(g.streak, 0) AS streak
      FROM users u
      LEFT JOIN user_settings s ON s.user_id = u.id
      LEFT JOIN gamification g ON g.user_id = u.id
      WHERE u.id = ?`, ctx.params.id)
    if (!u) throw new HttpError(404, '用户不存在')
    const [stats, badges, followers, followedByMe] = await Promise.all([
      first<{ posts: number; likes: number }>(ctx.env, `
        SELECT (SELECT COUNT(*) FROM community_posts WHERE user_id = ? AND is_hidden = 0)
             + (SELECT COUNT(*) FROM community_comments WHERE user_id = ? AND is_hidden = 0) AS posts,
          (SELECT COALESCE(SUM(likes_count), 0) FROM community_posts WHERE user_id = ?)
             + (SELECT COALESCE(SUM(likes_count), 0) FROM community_comments WHERE user_id = ?) AS likes`,
        ctx.params.id, ctx.params.id, ctx.params.id, ctx.params.id),
      all<{ badge_key: string; awarded_at: number }>(ctx.env,
        'SELECT badge_key, awarded_at FROM user_badges WHERE user_id = ? ORDER BY awarded_at ASC', ctx.params.id),
      first<{ n: number }>(ctx.env, 'SELECT COUNT(*) AS n FROM user_follows WHERE followee_id = ?', ctx.params.id),
      first<{ follower_id: string }>(ctx.env,
        'SELECT follower_id FROM user_follows WHERE follower_id = ? AND followee_id = ?', ctx.userId, ctx.params.id)
    ])
    return Response.json({
      userId: u.id, userName: u.user_name || '升本人',
      points: u.points, streak: u.streak,
      verified: !!u.verified, expertise: u.expertise || '',
      postCount: stats?.posts ?? 0, likesReceived: stats?.likes ?? 0,
      badges: badges.map(b => ({ key: b.badge_key, awardedAt: b.awarded_at })),
      followers: followers?.n ?? 0,
      followedByMe: !!followedByMe
    })
  })

  // 用户学习统计：用于个人主页成长可视化（热力图/总学习时长/做题数/科目分布）
  on('GET', '/api/community/users/:id/stats', true, async (ctx) => {
    const userId = ctx.params.id
    // 确认用户存在
    const u = await first<{ id: string }>(ctx.env, 'SELECT id FROM users WHERE id = ?', userId)
    if (!u) throw new HttpError(404, '用户不存在')

    // 365 天热力图：按日期汇总学习分钟数
    const oneYearAgo = new Date(Date.now() - 86400000 * 365)
    const startDate = oneYearAgo.toISOString().slice(0, 10)
    const heatmapRows = await all<{ date: string; minutes: number }>(ctx.env, `
      SELECT date, SUM(minutes) AS minutes FROM study_records
      WHERE user_id = ? AND date >= ?
      GROUP BY date ORDER BY date ASC`, userId, startDate)
    const heatmapMap = new Map<string, number>()
    for (const r of heatmapRows) heatmapMap.set(r.date, r.minutes)
    // 填充无记录的日期为 0
    const heatmap: { date: string; minutes: number }[] = []
    const cursor = new Date(oneYearAgo.getTime())
    const today = new Date()
    while (cursor <= today) {
      const d = cursor.toISOString().slice(0, 10)
      heatmap.push({ date: d, minutes: heatmapMap.get(d) ?? 0 })
      cursor.setDate(cursor.getDate() + 1)
    }

    // 总学习时长
    const totalStudy = await first<{ minutes: number; days: number }>(ctx.env, `
      SELECT COALESCE(SUM(minutes), 0) AS minutes, COUNT(DISTINCT date) AS days
      FROM study_records WHERE user_id = ?`, userId)

    // 本月学习时长
    const monthStart = new Date()
    monthStart.setDate(1)
    monthStart.setHours(0, 0, 0, 0)
    const monthStudy = await first<{ minutes: number }>(ctx.env, `
      SELECT COALESCE(SUM(minutes), 0) AS minutes FROM study_records
      WHERE user_id = ? AND date >= ?`, userId, monthStart.toISOString().slice(0, 10))

    // 做题统计
    const problemStats = await first<{ total: number; correct: number; sessions: number }>(ctx.env, `
      SELECT COALESCE(SUM(total), 0) AS total, COALESCE(SUM(correct), 0) AS correct, COUNT(*) AS sessions
      FROM problem_sessions WHERE user_id = ?`, userId)

    // 科目分布（学习时长 Top 5 科目）
    const subjectRows = await all<{ subject_id: string; name: string; minutes: number }>(ctx.env, `
      SELECT r.subject_id, COALESCE(s.name, r.subject_id) AS name, SUM(r.minutes) AS minutes
      FROM study_records r
      LEFT JOIN subjects s ON s.user_id = r.user_id AND s.id = r.subject_id
      WHERE r.user_id = ?
      GROUP BY r.subject_id ORDER BY minutes DESC LIMIT 5`, userId)

    return Response.json({
      heatmap,
      totalStudy: { minutes: totalStudy?.minutes ?? 0, days: totalStudy?.days ?? 0 },
      monthStudy: { minutes: monthStudy?.minutes ?? 0 },
      problems: { total: problemStats?.total ?? 0, correct: problemStats?.correct ?? 0,
                  sessions: problemStats?.sessions ?? 0,
                  accuracy: (problemStats?.total ?? 0) > 0
                    ? Math.round((problemStats?.correct ?? 0) / (problemStats?.total ?? 0) * 100) : 0 },
      subjects: subjectRows.map(r => ({ id: r.subject_id, name: r.name, minutes: r.minutes }))
    })
  })

  // 关注/取关（toggle；关注时向对方推 follow 通知，取关撤回——与点赞同口径）
  on('PUT', '/api/community/users/:id/follow', true, async (ctx) => {
    rateLimit(ctx.request, 'community:follow', 30)
    const targetId = ctx.params.id
    if (targetId === ctx.userId) throw new HttpError(400, '不能关注自己')
    const target = await first<{ id: string }>(ctx.env, 'SELECT id FROM users WHERE id = ?', targetId)
    if (!target) throw new HttpError(404, '用户不存在')
    const existing = await first<{ follower_id: string }>(ctx.env,
      'SELECT follower_id FROM user_follows WHERE follower_id = ? AND followee_id = ?', ctx.userId, targetId)
    if (existing) {
      await batch(ctx.env, [
        ctx.env.DB.prepare('DELETE FROM user_follows WHERE follower_id = ? AND followee_id = ?').bind(ctx.userId, targetId),
        ctx.env.DB.prepare("DELETE FROM community_notifications WHERE type = 'follow' AND actor_id = ? AND user_id = ?").bind(ctx.userId, targetId)
      ])
      return Response.json({ following: false })
    }
    const myName = await displayName(ctx.env, ctx.userId)
    await batch(ctx.env, [
      ctx.env.DB.prepare('INSERT INTO user_follows (follower_id, followee_id, created_at) VALUES (?, ?, ?)').bind(ctx.userId, targetId, nowSec()),
      notifyStatement(ctx.env, { userId: targetId, type: 'follow', actorId: ctx.userId, content: `${myName} 关注了你` })
    ])
    return Response.json({ following: true })
  })

  // 每日一题：最新一条被标记且未隐藏的帖子（广场顶部展示）
  on('GET', '/api/community/daily', true, async (ctx) => {
    const row = await first<any>(ctx.env,
      `${POST_SELECT} WHERE p.is_daily = 1 AND p.is_hidden = 0 ORDER BY p.created_at DESC LIMIT 1`, ctx.userId)
    return Response.json({ post: row ? mapPost(row) : null })
  })

  // 每日打卡榜：今日打卡榜 TOP 10（今日已打卡者按当日积分降序）+ 连续打卡王 TOP 5（streak 降序）
  on('GET', '/api/community/leaderboard', true, async (ctx) => {
    const today = utc8Today()
    const [todayRows, streakRows, subjectRows] = await Promise.all([
      all<{ user_id: string; user_name: string; points: number; streak: number; today_points: number; verified: number }>(ctx.env, `
        SELECT g.user_id, COALESCE(s.user_name, u.username) AS user_name, g.points, g.streak, u.verified,
          SUM(pl.points) AS today_points
        FROM points_log pl
        JOIN gamification g ON g.user_id = pl.user_id AND g.last_checkin = ?
        JOIN users u ON u.id = pl.user_id
        LEFT JOIN user_settings s ON s.user_id = pl.user_id
        WHERE pl.date = ?
        GROUP BY pl.user_id
        ORDER BY today_points DESC, g.points DESC
        LIMIT 10`, today, today),
      all<{ user_id: string; user_name: string; points: number; streak: number; verified: number }>(ctx.env, `
        SELECT g.user_id, COALESCE(s.user_name, u.username) AS user_name, g.points, g.streak, u.verified
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
        streak: r.streak, totalPoints: r.points, verified: !!r.verified, subjects: subjMap.get(r.user_id) ?? []
      })),
      streak: streakRows.map(r => ({
        userName: r.user_name || '升本人', streak: r.streak, totalPoints: r.points, verified: !!r.verified
      }))
    })
  })

  // 举报帖子/评论/私信（举报人匿名，仅管理员可见；同一内容重复举报去重）
  on('POST', '/api/community/reports', true, async (ctx) => {
    rateLimit(ctx.request, 'community:report', 10)
    const b = await body(ctx.request)
    const targetType = ['post', 'comment', 'message'].includes(b?.targetType) ? b.targetType : null
    const targetId = typeof b?.targetId === 'string' ? b.targetId : ''
    const reason = String(b?.reason ?? '')
    const detail = String(b?.detail ?? '').trim().slice(0, 200)
    if (!targetType || !targetId) throw new HttpError(400, '参数错误')
    if (!REPORT_REASONS.includes(reason)) throw new HttpError(400, '举报原因无效')
    if (reason === '其他' && !detail) throw new HttpError(400, '选择「其他」时请填写补充说明')
    // 私信举报：仅会话参与者可举报（校验目标消息存在且我是收发方之一）
    let targetUserId: string
    if (targetType === 'message') {
      const msg = await first<{ from_id: string; to_id: string }>(ctx.env,
        'SELECT from_id, to_id FROM community_messages WHERE id = ?', targetId)
      if (!msg) throw new HttpError(404, '私信不存在')
      if (msg.from_id !== ctx.userId && msg.to_id !== ctx.userId) throw new HttpError(403, '只能举报与你相关的私信')
      if (msg.from_id === ctx.userId) throw new HttpError(400, '不能举报自己发出的私信')
      targetUserId = msg.from_id
    } else {
      const table = targetType === 'post' ? 'community_posts' : 'community_comments'
      const target = await first<{ user_id: string }>(ctx.env,
        `SELECT user_id FROM ${table} WHERE id = ? AND is_hidden = 0`, targetId)
      if (!target) throw new HttpError(404, '内容不存在')
      if (target.user_id === ctx.userId) throw new HttpError(400, '不能举报自己的内容')
      targetUserId = target.user_id
    }
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
