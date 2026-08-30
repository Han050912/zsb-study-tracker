import type { Env } from '../../index'
import { z } from 'zod'
import { on, body } from '../../router'
import { all, first, run, batch, uid, utc8Today, HttpError } from '../../db'
import { parseBody, POST_TYPES, QUESTION_SUBJECT_TAGS, trimMax, imageUrlsSchema } from '../../schemas'
import { rateLimit } from '../../middleware/rateLimit'
import { deleteUploads, uploadIdsOf, IMAGE_MAX_PER_POST, IMAGE_MAX_PER_COMMENT } from '../uploads'
import { assertCleanAsync } from '../sensitive'
import { awardBadge, hasBadge } from '../badges'
import {
  nowSec, mapPost, mapComment, POST_SELECT, awardStatements, revokeStatements, revokeLikeStatements,
  notifyStatement, displayName, isAdmin, assertCircleReadable, parseCursor, postCascadeStatements,
  commentCascadeStatements, MAX_PAGE, escapeLike
} from './shared'

/**
 * 社区广场帖子域路由：帖子 feed / 详情 / 发帖 / 删帖 / 评论 / 采纳与解决。
 * 由 community/index.ts 的 registerCommunityRoutes 聚合注册。
 * 零逻辑改动：on(...) 块从原 community.ts 逐字搬迁，仅调整 import 路径与包一层 registerPostsRoutes()。
 */
export function registerPostsRoutes() {
  // 帖子列表（游标分页；默认仅广场公开帖，circle 参数显式指定圈内流）
  on('GET', '/api/community/posts', false, async (ctx) => {
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
    const params: unknown[] = [ctx.userId, ctx.userId]
    if (!admin) {
      where.push('p.is_hidden = 0 AND (p.is_flagged = 0 OR p.user_id = ?)')
      params.push(ctx.userId)
    }
    if (type && (POST_TYPES as readonly string[]).includes(type)) { where.push('p.type = ?'); params.push(type) }
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
  on('GET', '/api/community/posts/:id', false, async (ctx) => {
    const admin = await isAdmin(ctx.env, ctx.userId)
    const postWhere = admin ? 'p.id = ?' : 'p.id = ? AND p.is_hidden = 0 AND (p.is_flagged = 0 OR p.user_id = ?)'
    const postParams: unknown[] = [ctx.userId, ctx.userId, ctx.params.id]
    if (!admin) postParams.push(ctx.userId)
    const post = await first(ctx.env, `${POST_SELECT} WHERE ${postWhere}`, ...postParams)
    if (!post) throw new HttpError(404, '帖子不存在')
    // 圈子帖：与列表接口同一口径校验可读性（审核圈仅活跃成员/管理员可见）
    if (post.circle_id) await assertCircleReadable(ctx, post.circle_id)
    const commentWhere = admin
      ? 'c.post_id = ?'
      : 'c.post_id = ? AND c.is_hidden = 0 AND (c.is_flagged = 0 OR c.user_id = ?)'
    const commentParams: unknown[] = [ctx.userId, ctx.userId, ctx.params.id]
    if (!admin) commentParams.push(ctx.userId)
    const comments = await all(ctx.env, `
      SELECT c.*, COALESCE(s.user_name, u.username) AS user_name,
        u.verified AS user_verified, s.avatar AS user_avatar,
        (l.user_id IS NOT NULL) AS liked_by_me,
        (d.user_id IS NOT NULL) AS disliked_by_me
      FROM community_comments c
      JOIN users u ON u.id = c.user_id
      LEFT JOIN user_settings s ON s.user_id = c.user_id
      LEFT JOIN community_likes l ON l.target_type = 'comment' AND l.target_id = c.id AND l.user_id = ?
      LEFT JOIN community_dislikes d ON d.target_type = 'comment' AND d.target_id = c.id AND d.user_id = ?
      WHERE ${commentWhere}
      ORDER BY c.created_at ASC, c.id ASC`, ...commentParams)
    return Response.json({ post: mapPost(post), comments: comments.map(mapComment) })
  })

  // 发帖（每日首帖 +5 积分，按日期去重）
  on('POST', '/api/community/posts', true, async (ctx) => {
    rateLimit(ctx.request, 'community:post', 5)
    const b = await parseBody(ctx.request, z.object({
      content: trimMax(5000, '帖子内容最多 5000 字').optional().default(''),
      // 复刻原行为：非法 type 静默回退 'share'
      type: z.enum(POST_TYPES).catch('share'),
      // 复刻原行为：过滤非字符串 → 截取 5 个 → 各 trim 截 20 → 去空
      tags: z.array(z.unknown()).transform(arr =>
        arr.filter((t): t is string => typeof t === 'string')
          .slice(0, 5).map(t => t.trim().slice(0, 20)).filter(Boolean)
      ).default([]),
      imageUrls: imageUrlsSchema(IMAGE_MAX_PER_POST).default([]),
      circleId: z.string().optional(),
      topicRef: z.string().optional(),
      refType: z.string().max(20).nullish(),
      refId: z.string().max(64).nullish()
    }))
    // 分级发帖冷却：青铜(0-499)10min / 白银(500-1499)5min / 黄金(1500+)不限
    const myPoints = await first<{ points: number }>(ctx.env,
      'SELECT COALESCE(points, 0) AS points FROM gamification WHERE user_id = ?', ctx.userId)
    const pts = myPoints?.points ?? 0
    const cooldown = pts < 500 ? 600 : pts < 1500 ? 300 : 0
    if (cooldown > 0) {
      const last = await first<{ created_at: number }>(ctx.env,
        'SELECT created_at FROM community_posts WHERE user_id = ? ORDER BY created_at DESC LIMIT 1', ctx.userId)
      if (last && nowSec() - last.created_at < cooldown) {
        const wait = Math.ceil((cooldown - (nowSec() - last.created_at)) / 60)
        throw new HttpError(429, `发帖过于频繁，请 ${wait} 分钟后再试`)
      }
    }
    const content = b.content
    // 软违规（本地或 AI）：先发布但标记待审（仅作者/管理员可见），由管理员复核
    const flagged = content ? ((await assertCleanAsync(content, ctx.env, { allowSoft: true })).flagged ? 1 : 0) : 0
    const type = b.type
    const tags = b.tags
    for (const t of tags) await assertCleanAsync(t, ctx.env, { allowSoft: true }) // 标签同样过敏感词，防止绕过内容过滤
    if (type === 'question' && !tags.some(t => (QUESTION_SUBJECT_TAGS as readonly string[]).includes(t))) {
      throw new HttpError(400, '提问帖请选择科目标签（#高等数学 或 #英语）')
    }

    // 配图：仅接受本系统上传路径，且必须属于当前用户（防串用他人图片）；去重防同一图重复嵌入
    const imageUrls = b.imageUrls
    if (imageUrls.length) {
      const ids = imageUrls.map(u => u.split('/').pop()!)
      const owned = await all<{ id: string }>(ctx.env,
        `SELECT id FROM community_uploads WHERE user_id = ? AND id IN (${ids.map(() => '?').join(',')})`,
        ctx.userId, ...ids)
      if (owned.length !== new Set(ids).size) throw new HttpError(400, '图片不存在或已失效，请重新上传')
    }
    // 图文至少一项：支持纯图片 / 纯文字 / 图文混合发帖
    if (!content && !imageUrls.length) throw new HttpError(400, '请输入帖子内容或添加图片')

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
        'INSERT INTO community_posts (id, user_id, type, content, tags, image_urls, circle_id, topic_ref, ref_type, ref_id, is_flagged, created_at, updated_at) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(id, ctx.userId, type, content, JSON.stringify(tags), JSON.stringify(imageUrls), circleId, topicRef,
        b.refType ?? null,
        b.refId ?? null, flagged, now, now)
    ]
    const awarded = await first(ctx.env,
      'SELECT id FROM points_log WHERE user_id = ? AND date = ? AND reason = ?', ctx.userId, utc8Today(), '社区打卡')
    if (!awarded) stmts.push(...awardStatements(ctx.env, ctx.userId, 5, '社区打卡', id))
    await batch(ctx.env, stmts)

    // 徽章：首次发帖 / 首次提问（主键去重，仅首次发放并通知）
    const myPostCount = await first<{ n: number }>(ctx.env,
      'SELECT COUNT(*) AS n FROM community_posts WHERE user_id = ?', ctx.userId)
    if (myPostCount?.n === 1) await batch(ctx.env, await awardBadge(ctx.env, ctx.userId, 'first_post'))
    if (type === 'question') {
      const myQCount = await first<{ n: number }>(ctx.env,
        "SELECT COUNT(*) AS n FROM community_posts WHERE user_id = ? AND type = 'question'", ctx.userId)
      if (myQCount?.n === 1) await batch(ctx.env, await awardBadge(ctx.env, ctx.userId, 'first_question'))
    }

    // 刚写入的帖子被并发删除/隐藏时读不回，明确报错而非 500 崩溃
    const created = await first(ctx.env, `${POST_SELECT} WHERE p.id = ?`, ctx.userId, ctx.userId, id)
    if (!created) throw new HttpError(500, '发布成功但读取详情失败，请刷新查看')
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
    const post = await first<{ user_id: string; circle_id: string | null }>(ctx.env,
      'SELECT user_id, circle_id FROM community_posts WHERE id = ? AND is_hidden = 0', postId)
    if (!post) throw new HttpError(404, '帖子不存在')
    // 圈子帖：仅可读者可评论（审核圈非成员既看不了也不应能写）
    if (post.circle_id) await assertCircleReadable(ctx, post.circle_id)

    const b = await parseBody(ctx.request, z.object({
      content: trimMax(1000, '评论内容最多 1000 字').default(''),
      imageUrls: imageUrlsSchema(IMAGE_MAX_PER_COMMENT).default([]),
      parentId: z.string().optional()
    }))
    const content = b.content
    // 软违规（本地或 AI）：先发布但标记待审（仅作者/管理员可见），由管理员复核
    const flagged = content ? ((await assertCleanAsync(content, ctx.env, { allowSoft: true })).flagged ? 1 : 0) : 0

    // 评论配图（最多 3 张）：与发帖同一口径——仅认本系统上传路径且必须属于当前用户
    const imageUrls = b.imageUrls
    if (imageUrls.length) {
      const ids = imageUrls.map(u => u.split('/').pop()!)
      const owned = await all<{ id: string }>(ctx.env,
        `SELECT id FROM community_uploads WHERE user_id = ? AND id IN (${ids.map(() => '?').join(',')})`,
        ctx.userId, ...ids)
      if (owned.length !== new Set(ids).size) throw new HttpError(400, '图片不存在或已失效，请重新上传')
    }
    // 图文至少一项：支持纯图片 / 纯文字 / 图文混合评论
    if (!content && !imageUrls.length) throw new HttpError(400, '请输入评论内容或添加图片')

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
    // 蓝 V 标记随评论一并返回（前端直接插入评论树，避免刷新前缺失认证标识）
    const me = await first<{ verified: number }>(ctx.env, 'SELECT verified FROM users WHERE id = ?', ctx.userId)
    const stmts: D1PreparedStatement[] = [
      ctx.env.DB.prepare(
        'INSERT INTO community_comments (id, post_id, user_id, parent_id, content, image_urls, is_flagged, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(id, postId, ctx.userId, parent ? b.parentId : null, content, JSON.stringify(imageUrls), flagged, now, now),
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
      content, imageUrls, userVerified: !!me?.verified,
      likesCount: 0, isAccepted: false, isHidden: false, isFlagged: !!flagged, likedByMe: false, createdAt: now
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
      if ((accepted?.n ?? 0) >= 10) await batch(ctx.env, await awardBadge(ctx.env, comment.user_id, 'answer_expert'))
    }
    return Response.json({ acceptedAnswerId: commentId, isResolved: true })
  })
}
