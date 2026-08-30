import type { Env } from '../../index'
import { all, first, uid, utc8Today, HttpError } from '../../db'
import { uploadIdsOf } from '../uploads'

/**
 * 社区广场共享 helper：行 → 前端对象映射、通用 SQL 片段、积分/通知语句、圈子辅助、级联删除。
 * 由社区域各路由文件（posts / likes / messages / circles / users / boards / reports / notifications）复用，
 * 外部模块可从 './community' 直接导入。
 * 零逻辑改动：本文件仅承载原 community.ts 中非路由注册的顶层声明，函数体逐字保留。
 */

export const MAX_PAGE = 50

export const nowSec = () => Math.floor(Date.now() / 1000)

// ---------- 行 → 前端对象 ----------

/** 解析 JSON 字符串数组列（tags / image_urls 共用），非法输入回退空数组 */
export function parseStrArray(raw: unknown): string[] {
  try {
    const v = JSON.parse(String(raw || '[]'))
    return Array.isArray(v) ? v.filter(t => typeof t === 'string') : []
  } catch {
    return []
  }
}

export function mapPost(r: any) {
  return {
    id: r.id,
    userId: r.user_id,
    userName: r.user_name || '升本人',
    userPoints: r.user_points ?? 0,
    userVerified: !!r.user_verified,
    userAvatar: r.user_avatar ?? undefined,
    type: r.type,
    content: r.content,
    tags: parseStrArray(r.tags),
    imageUrls: parseStrArray(r.image_urls),
    imageThumbs: parseStrArray(r.image_urls).map(u => u + '?thumb=1'),
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
    dislikesCount: r.dislikes_count,
    commentsCount: r.comments_count,
    isPinned: !!r.is_pinned,
    isHidden: !!r.is_hidden,
    isFlagged: !!r.is_flagged,
    likedByMe: !!r.liked_by_me,
    dislikedByMe: !!r.disliked_by_me,
    createdAt: r.created_at
  }
}

export function mapComment(r: any) {
  return {
    id: r.id,
    postId: r.post_id,
    userId: r.user_id,
    userName: r.user_name || '升本人',
    userAvatar: r.user_avatar ?? undefined,
    parentId: r.parent_id ?? undefined,
    content: r.content,
    imageUrls: parseStrArray(r.image_urls),
    userVerified: !!r.user_verified,
    likesCount: r.likes_count,
    dislikesCount: r.dislikes_count,
    isAccepted: !!r.is_accepted,
    isHidden: !!r.is_hidden,
    isFlagged: !!r.is_flagged,
    likedByMe: !!r.liked_by_me,
    dislikedByMe: !!r.disliked_by_me,
    createdAt: r.created_at
  }
}

export function mapNotification(r: any) {
  const thumbs = r.image_urls ? parseStrArray(r.image_urls) : []
  return {
    id: r.id,
    type: r.type,
    actorId: r.actor_id ?? undefined,
    actorName: r.actor_name ?? undefined,
    actorAvatar: r.actor_avatar ?? undefined,
    postId: r.post_id ?? undefined,
    commentId: r.comment_id ?? undefined,
    targetType: r.target_type ?? undefined,
    targetId: r.target_id ?? undefined,
    content: r.content,
    isRead: !!r.is_read,
    createdAt: r.created_at,
    relation: r.relation ?? 'none',
    postThumb: thumbs.length ? thumbs[0] + '?thumb=1' : undefined,
    commentContent: r.comment_content ?? undefined,
    commentLikedByMe: !!r.comment_liked_by_me,
    commentLikesCount: r.comment_likes_count ?? 0
  }
}

// ---------- 通用 SQL 片段 ----------

/** 帖子查询：JOIN 作者展示名/积分 + 当前用户点赞/踩态。参数顺序固定为 [viewerId, viewerId, ...] */
export const POST_SELECT = `
  SELECT p.*, COALESCE(s.user_name, u.username) AS user_name, COALESCE(g.points, 0) AS user_points,
    u.verified AS user_verified, s.avatar AS user_avatar, ci.name AS circle_name,
    (l.user_id IS NOT NULL) AS liked_by_me,
    (d.user_id IS NOT NULL) AS disliked_by_me
  FROM community_posts p
  JOIN users u ON u.id = p.user_id
  LEFT JOIN user_settings s ON s.user_id = p.user_id
  LEFT JOIN gamification g ON g.user_id = p.user_id
  LEFT JOIN community_circles ci ON ci.id = p.circle_id
  LEFT JOIN community_likes l ON l.target_type = 'post' AND l.target_id = p.id AND l.user_id = ?
  LEFT JOIN community_dislikes d ON d.target_type = 'post' AND d.target_id = p.id AND d.user_id = ?`

// ---------- 积分 / 通知 ----------

/** 社区行为积分语句：gamification 行可能不存在（upsert），流水写入 points_log（refId 带 srv: 前缀标记服务端来源） */
export function awardStatements(env: Env, userId: string, points: number, reason: string, refId?: string): D1PreparedStatement[] {
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
export async function revokeStatements(env: Env, refId: string): Promise<D1PreparedStatement[]> {
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
export async function revokeLikeStatements(env: Env, targetType: 'post' | 'comment', targetIds: string[]): Promise<D1PreparedStatement[]> {
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
  targetType?: string; targetId?: string
}): D1PreparedStatement {
  // 未显式指定跳转目标时按类型自动推导：帖子类(评论/点赞/采纳) → 帖子；关注 → 用户主页；私信 → 会话
  let tt = n.targetType ?? null
  let tid = n.targetId ?? null
  if (!tt) {
    if (n.postId) { tt = 'post'; tid = n.postId }
    else if (n.type === 'follow' && n.actorId) { tt = 'user'; tid = n.actorId }
    else if (n.type === 'message' && n.actorId) { tt = 'message'; tid = n.actorId }
  }
  return env.DB.prepare(
    'INSERT INTO community_notifications (id, user_id, type, actor_id, post_id, comment_id, target_type, target_id, content, is_read, created_at) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)'
  ).bind(uid(), n.userId, n.type, n.actorId ?? null, n.postId ?? null, n.commentId ?? null, tt, tid, n.content, nowSec())
}

/** 用户展示名（用户设置昵称优先，回退用户名） */
export async function displayName(env: Env, userId: string): Promise<string> {
  const r = await first<{ name: string }>(env,
    'SELECT COALESCE(s.user_name, u.username) AS name FROM users u LEFT JOIN user_settings s ON s.user_id = u.id WHERE u.id = ?',
    userId)
  return r?.name || '升本人'
}

/** 当前用户是否为管理员 */
export async function isAdmin(env: Env, userId: string): Promise<boolean> {
  const u = await first<{ role: string }>(env, 'SELECT role FROM users WHERE id = ?', userId)
  return u?.role === 'admin'
}

/** 主页可见性校验：private 仅本人、login 需登录、public 放行 */
export async function assertProfileVisible(ctx: { env: Env; userId: string }, targetUserId: string, visibility: string): Promise<void> {
  if (visibility === 'private' && ctx.userId !== targetUserId) throw new HttpError(403, '对方设置了主页仅自己可见')
  if (visibility === 'login' && !ctx.userId) throw new HttpError(401, '请登录后查看')
}

/** LIKE 通配符转义（tags JSON 子串匹配用） */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, c => '\\' + c)
}

// ---------- 圈子辅助 ----------

export interface CircleRow { id: string; is_public: number }

/** 圈子可读性校验：审核圈仅活跃成员/管理员可读其帖子流 */
export async function assertCircleReadable(ctx: { env: Env; userId: string }, circleId: string): Promise<CircleRow> {
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

export function mapCircle(r: any, myStatus?: string | null) {
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
export function parseCursor(cursor: string): { ts: number; id: string } | null {
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
    env.DB.prepare(
      `DELETE FROM community_dislikes WHERE (target_type = 'post' AND target_id = ?)
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
      env.DB.prepare(`DELETE FROM community_dislikes WHERE target_type = 'comment' AND target_id IN (${ph})`).bind(...removedIds),
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
