import { on } from '../../router'
import { all, first, batch, HttpError } from '../../db'
import { rateLimit } from '../../middleware/rateLimit'
import {
  mapPost, POST_SELECT, parseCursor, MAX_PAGE, displayName, nowSec,
  assertProfileVisible, notifyStatement
} from './shared'

/**
 * 社区广场用户域路由：用户查找 / 资料卡 / 学习统计 / 关注 / 用户帖 / 点赞帖 / 关注列表。
 * 由 community/index.ts 的 registerCommunityRoutes 聚合注册。
 * 零逻辑改动：on(...) 块从原 community.ts 逐字搬迁，仅调整 import 路径与包一层 registerUsersRoutes()。
 */
export function registerUsersRoutes() {
  // 精确查找用户：仅按对外用户 ID（user_code）定位，返回用户卡片 + 当前关注状态。
  // 用于「输入用户ID → 找到人 → 关注/加搭子」闭环；完整资料由 /profile 承载。
  on('GET', '/api/community/users/lookup', true, async (ctx) => {
    rateLimit(ctx.request, 'community:lookup', 30)
    const key = (new URL(ctx.request.url).searchParams.get('key') || '').trim().toUpperCase()
    if (!key) throw new HttpError(400, '请输入用户ID')
    if (key.length > 8) throw new HttpError(404, '用户不存在')
    const u = await first<any>(ctx.env, `
      SELECT u.id, u.user_code, u.username, u.verified, u.expertise, u.created_at,
        COALESCE(s.user_name, u.username) AS user_name, s.avatar, s.bio, s.profile_visibility
      FROM users u
      LEFT JOIN user_settings s ON s.user_id = u.id
      WHERE u.user_code = ?`, key)
    if (!u) throw new HttpError(404, '用户不存在')
    const [followedByMe, followsMe] = await Promise.all([
      first<{ follower_id: string }>(ctx.env,
        'SELECT follower_id FROM user_follows WHERE follower_id = ? AND followee_id = ?', ctx.userId, u.id),
      first<{ follower_id: string }>(ctx.env,
        'SELECT follower_id FROM user_follows WHERE follower_id = ? AND followee_id = ?', u.id, ctx.userId)
    ])
    const partner = u.id === ctx.userId ? null : await first<{ status: string; to_id: string }>(ctx.env,
      'SELECT status, to_id FROM study_partners WHERE pair_key = ?',
      [ctx.userId, u.id].sort().join(':'))
    const partnerStatus = u.id === ctx.userId ? 'self'
      : !partner ? 'none'
      : partner.status === 'accepted' ? 'accepted'
      : partner.status === 'rejected' ? 'rejected'
      : partner.to_id === ctx.userId ? 'pending_received' : 'pending_sent'
    const card = {
      userId: u.id,
      userCode: u.user_code,
      userName: u.user_name || '升本人',
      avatar: u.avatar ?? undefined,
      verified: !!u.verified,
      expertise: u.expertise || '',
      bio: u.bio || '',
      followedByMe: !!followedByMe,
      followsMe: !!followsMe,
      relation: u.id === ctx.userId ? 'none'
        : (followedByMe && followsMe) ? 'mutual'
        : followedByMe ? 'following'
        : followsMe ? 'follower' : 'none',
      partnerStatus,
    }
    // 私密主页（非本人）：降级返回公开子集（与 profile 同口径）
    if ((u.profile_visibility ?? 'login') === 'private' && u.id !== ctx.userId) {
      return Response.json({ ...card, profilePrivate: true })
    }
    return Response.json(card)
  })

  // 用户资料卡：社区公开荣誉信息（等级/连续打卡/徽章墙/专家认证），不含私有学习数据
  on('GET', '/api/community/users/:id/profile', false, async (ctx) => {
    const u = await first<any>(ctx.env, `
      SELECT u.id, u.user_code, COALESCE(s.user_name, u.username) AS user_name, u.verified, u.expertise,
        COALESCE(g.points, 0) AS points, COALESCE(g.streak, 0) AS streak, s.profile_visibility, s.avatar,
        COALESCE(s.bio, '') AS bio
      FROM users u
      LEFT JOIN user_settings s ON s.user_id = u.id
      LEFT JOIN gamification g ON g.user_id = u.id
      WHERE u.id = ?`, ctx.params.id)
    if (!u) throw new HttpError(404, '用户不存在')
    const visibility = u.profile_visibility ?? 'login'
    // 私密主页（非本人）：不抛错，降级返回公开子集（昵称/头像/蓝V 在公开帖子流本就可见）。
    // 关注关系属社交信息（非隐私学习数据），私密主页仍可关注/取关，需一并返回当前关注状态
    if (visibility === 'private' && ctx.userId !== ctx.params.id) {
      const [followedByMe, followsMe] = await Promise.all([
        first<{ follower_id: string }>(ctx.env,
          'SELECT follower_id FROM user_follows WHERE follower_id = ? AND followee_id = ?', ctx.userId, ctx.params.id),
        first<{ follower_id: string }>(ctx.env,
          'SELECT follower_id FROM user_follows WHERE follower_id = ? AND followee_id = ?', ctx.params.id, ctx.userId)
      ])
      return Response.json({
        profilePrivate: true,
        userId: u.id, userCode: u.user_code, userName: u.user_name || '升本人',
        avatar: u.avatar ?? undefined, verified: !!u.verified, expertise: u.expertise || '',
        bio: u.bio, followedByMe: !!followedByMe, followsMe: !!followsMe
      })
    }
    // login 可见性 + 访客：需登录（登录用户可见完整资料）
    if (visibility === 'login' && !ctx.userId) throw new HttpError(401, '请登录后查看')
    const [stats, badges, followers, followedByMe, followsMe, threads, social] = await Promise.all([
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
        'SELECT follower_id FROM user_follows WHERE follower_id = ? AND followee_id = ?', ctx.userId, ctx.params.id),
      first<{ follower_id: string }>(ctx.env,
        'SELECT follower_id FROM user_follows WHERE follower_id = ? AND followee_id = ?', ctx.params.id, ctx.userId),
      first<{ n: number }>(ctx.env,
        'SELECT COUNT(*) AS n FROM community_posts WHERE user_id = ? AND is_hidden = 0 AND circle_id IS NULL AND topic_ref IS NULL', ctx.params.id),
      first<{ following: number; mutual: number; liked: number }>(ctx.env, `
        SELECT (SELECT COUNT(*) FROM user_follows WHERE follower_id = ?) AS following,
          (SELECT COUNT(*) FROM user_follows f1 JOIN user_follows f2
             ON f2.follower_id = f1.followee_id AND f2.followee_id = f1.follower_id
           WHERE f1.follower_id = ?) AS mutual,
          (SELECT COUNT(*) FROM community_likes l JOIN community_posts p
             ON p.id = l.target_id AND p.is_hidden = 0
           WHERE l.user_id = ? AND l.target_type = 'post') AS liked`,
        ctx.params.id, ctx.params.id, ctx.params.id)
    ])
    return Response.json({
      userId: u.id, userCode: u.user_code, userName: u.user_name || '升本人',
      avatar: u.avatar ?? undefined,
      points: u.points, streak: u.streak,
      verified: !!u.verified, expertise: u.expertise || '',
      postCount: stats?.posts ?? 0, likesReceived: stats?.likes ?? 0,
      badges: badges.map(b => ({ key: b.badge_key, awardedAt: b.awarded_at })),
      followers: followers?.n ?? 0,
      followedByMe: !!followedByMe,
      bio: u.bio,
      followsMe: !!followsMe,
      threadsCount: threads?.n ?? 0,
      followingCount: social?.following ?? 0,
      mutualCount: social?.mutual ?? 0,
      ...(ctx.userId === ctx.params.id ? { likedCount: social?.liked ?? 0 } : {}),
      relation: ctx.userId === ctx.params.id ? 'none'
        : (followedByMe && followsMe) ? 'mutual'
        : followedByMe ? 'following'
        : followsMe ? 'follower' : 'none'
    })
  })

  // 用户学习统计：用于个人主页成长可视化（热力图/总学习时长/做题数/科目分布）
  on('GET', '/api/community/users/:id/stats', true, async (ctx) => {
    const userId = ctx.params.id
    // 确认用户存在
    const u = await first<{ id: string; profile_visibility: string }>(ctx.env,
      `SELECT u.id, s.profile_visibility FROM users u LEFT JOIN user_settings s ON s.user_id = u.id WHERE u.id = ?`, userId)
    if (!u) throw new HttpError(404, '用户不存在')
    await assertProfileVisible(ctx, userId, u.profile_visibility ?? 'login')

    // 365 天热力图：按日期汇总学习分钟数（日期口径与 utc8Today 一致：UTC+8）
    // 364 天前 → 今天共 365 天，避免 off-by-one 多生成一天
    const oneYearAgo = new Date(Date.now() + 8 * 3600_000 - 86400_000 * 364)
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
    const today = new Date(Date.now() + 8 * 3600_000)
    while (cursor <= today) {
      const d = cursor.toISOString().slice(0, 10)
      heatmap.push({ date: d, minutes: heatmapMap.get(d) ?? 0 })
      cursor.setUTCDate(cursor.getUTCDate() + 1)
    }

    // 总学习时长
    const totalStudy = await first<{ minutes: number; days: number }>(ctx.env, `
      SELECT COALESCE(SUM(minutes), 0) AS minutes, COUNT(DISTINCT date) AS days
      FROM study_records WHERE user_id = ?`, userId)

    // 本月学习时长（按 UTC+8 日历月，与记录日期口径一致）
    const monthStart = new Date(Date.now() + 8 * 3600_000)
    monthStart.setUTCDate(1)
    monthStart.setUTCHours(0, 0, 0, 0)
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

  // 用户发布的帖子（公开广场帖口径：排除圈子帖/知识点讨论帖；游标分页，与 feed latest 同模式）
  on('GET', '/api/community/users/:id/posts', false, async (ctx) => {
    // 帖子默认对外可见：仅校验目标用户存在，不按主页可见性过滤（主页可见性只控主页访问，不控帖子）
    const target = await first<{ id: string }>(ctx.env,
      'SELECT u.id FROM users u WHERE u.id = ?', ctx.params.id)
    if (!target) throw new HttpError(404, '用户不存在')
    const url = new URL(ctx.request.url)
    const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '') || 20, 1), MAX_PAGE)
    const c = parseCursor(url.searchParams.get('cursor') || '')
    const where = ['p.user_id = ?', 'p.is_hidden = 0 AND (p.is_flagged = 0 OR p.user_id = ?)',
      'p.circle_id IS NULL', 'p.topic_ref IS NULL']
    const params: unknown[] = [ctx.userId, ctx.userId, ctx.params.id, ctx.userId]
    if (c) { where.push('(p.created_at < ? OR (p.created_at = ? AND p.id < ?))'); params.push(c.ts, c.ts, c.id) }
    const rows = await all(ctx.env,
      `${POST_SELECT} WHERE ${where.join(' AND ')} ORDER BY p.created_at DESC, p.id DESC LIMIT ?`, ...params, limit + 1)
    let nextCursor: string | null = null
    if (rows.length > limit) {
      const last = rows[limit - 1] as any
      nextCursor = `${last.created_at}_${last.id}`
    }
    return Response.json({ posts: rows.slice(0, limit).map(mapPost), nextCursor })
  })

  // 我点赞过的帖子（按点赞时间倒序；游标 `${lk.created_at}_${p.id}`）
  on('GET', '/api/community/me/liked-posts', true, async (ctx) => {
    const url = new URL(ctx.request.url)
    const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '') || 20, 1), MAX_PAGE)
    const c = parseCursor(url.searchParams.get('cursor') || '')
    const where = ["lk.target_type = 'post'", 'lk.user_id = ?', 'p.is_hidden = 0', '(p.is_flagged = 0 OR p.user_id = ?)']
    const params: unknown[] = [ctx.userId, ctx.userId, ctx.userId, ctx.userId]
    if (c) { where.push('(lk.created_at < ? OR (lk.created_at = ? AND p.id < ?))'); params.push(c.ts, c.ts, c.id) }
    const sql = POST_SELECT
      .replace('SELECT p.*,', 'SELECT p.*, lk.created_at AS lk_created_at,')
      .replace('FROM community_posts p', 'FROM community_posts p JOIN community_likes lk ON lk.target_id = p.id') +
      ` WHERE ${where.join(' AND ')} ORDER BY lk.created_at DESC, p.id DESC LIMIT ?`
    const rows = await all<any>(ctx.env, sql, ...params, limit + 1)
    let nextCursor: string | null = null
    if (rows.length > limit) {
      const last = rows[limit - 1]
      nextCursor = `${last.lk_created_at}_${last.id}`
    }
    return Response.json({ posts: rows.slice(0, limit).map(mapPost), nextCursor })
  })

  interface FollowRow {
    user_id: string; user_name: string | null; username: string; avatar: string | null;
    verified: number; bio: string; created_at: number; rel_id: string
  }

  /** 关系列表公共逻辑：游标分页 + 批量补当前用户与列表项的双向关系 */
  async function followListResponse(ctx: any, sql: string, params: unknown[], limit: number) {
    const rows = await all<FollowRow>(ctx.env, sql, ...params, limit + 1)
    const page = rows.slice(0, limit)
    let nextCursor: string | null = null
    if (rows.length > limit) {
      const last = rows[limit - 1]
      nextCursor = `${last.created_at}_${last.rel_id}`
    }
    const ids = page.map(r => r.user_id)
    let myFollowing = new Set<string>(), myFollowers = new Set<string>()
    if (ctx.userId && ids.length) {
      const ph = ids.map(() => '?').join(',')
      const [a, b] = await Promise.all([
        all<{ followee_id: string }>(ctx.env,
          `SELECT followee_id FROM user_follows WHERE follower_id = ? AND followee_id IN (${ph})`, ctx.userId, ...ids),
        all<{ follower_id: string }>(ctx.env,
          `SELECT follower_id FROM user_follows WHERE followee_id = ? AND follower_id IN (${ph})`, ctx.userId, ...ids)
      ])
      myFollowing = new Set(a.map(r => r.followee_id))
      myFollowers = new Set(b.map(r => r.follower_id))
    }
    const items = page.map(r => {
      const followedByMe = myFollowing.has(r.user_id)
      const followsMe = myFollowers.has(r.user_id)
      return {
        userId: r.user_id,
        userName: r.user_name || r.username,
        avatar: r.avatar ?? undefined,
        verified: !!r.verified,
        bio: r.bio || '',
        followedByMe, followsMe,
        relation: r.user_id === ctx.userId ? 'none'
          : followedByMe && followsMe ? 'mutual'
          : followedByMe ? 'following' : followsMe ? 'follower' : 'none'
      }
    })
    return Response.json({ items, nextCursor })
  }

  // 粉丝列表（公开路由；item 含与当前用户的双向关系）
  on('GET', '/api/community/users/:id/followers', false, async (ctx) => {
    const target = await first<{ id: string; profile_visibility: string | null }>(ctx.env,
      'SELECT u.id, s.profile_visibility FROM users u LEFT JOIN user_settings s ON s.user_id = u.id WHERE u.id = ?', ctx.params.id)
    if (!target) throw new HttpError(404, '用户不存在')
    await assertProfileVisible(ctx, ctx.params.id, target.profile_visibility ?? 'login')
    const url = new URL(ctx.request.url)
    const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '') || 20, 1), MAX_PAGE)
    const c = parseCursor(url.searchParams.get('cursor') || '')
    let sql = `
      SELECT u.id AS user_id, s.user_name, u.username, s.avatar, u.verified,
        COALESCE(s.bio, '') AS bio, f.created_at AS created_at, f.follower_id AS rel_id
      FROM user_follows f
      JOIN users u ON u.id = f.follower_id
      LEFT JOIN user_settings s ON s.user_id = u.id
      WHERE f.followee_id = ?`
    const params: unknown[] = [ctx.params.id]
    if (c) { sql += ' AND (f.created_at < ? OR (f.created_at = ? AND f.follower_id < ?))'; params.push(c.ts, c.ts, c.id) }
    sql += ' ORDER BY f.created_at DESC, f.follower_id DESC LIMIT ?'
    return followListResponse(ctx, sql, params, limit)
  })

  // 关注列表（公开路由；结构与粉丝列表相同，方向取 followee）
  on('GET', '/api/community/users/:id/following', false, async (ctx) => {
    const target = await first<{ id: string; profile_visibility: string | null }>(ctx.env,
      'SELECT u.id, s.profile_visibility FROM users u LEFT JOIN user_settings s ON s.user_id = u.id WHERE u.id = ?', ctx.params.id)
    if (!target) throw new HttpError(404, '用户不存在')
    await assertProfileVisible(ctx, ctx.params.id, target.profile_visibility ?? 'login')
    const url = new URL(ctx.request.url)
    const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '') || 20, 1), MAX_PAGE)
    const c = parseCursor(url.searchParams.get('cursor') || '')
    let sql = `
      SELECT u.id AS user_id, s.user_name, u.username, s.avatar, u.verified,
        COALESCE(s.bio, '') AS bio, f.created_at AS created_at, f.followee_id AS rel_id
      FROM user_follows f
      JOIN users u ON u.id = f.followee_id
      LEFT JOIN user_settings s ON s.user_id = u.id
      WHERE f.follower_id = ?`
    const params: unknown[] = [ctx.params.id]
    if (c) { sql += ' AND (f.created_at < ? OR (f.created_at = ? AND f.followee_id < ?))'; params.push(c.ts, c.ts, c.id) }
    sql += ' ORDER BY f.created_at DESC, f.followee_id DESC LIMIT ?'
    return followListResponse(ctx, sql, params, limit)
  })

  // 互关列表（公开路由；f1/f2 双向 JOIN 取互相跟随者）
  on('GET', '/api/community/users/:id/mutual', false, async (ctx) => {
    const target = await first<{ id: string; profile_visibility: string | null }>(ctx.env,
      'SELECT u.id, s.profile_visibility FROM users u LEFT JOIN user_settings s ON s.user_id = u.id WHERE u.id = ?', ctx.params.id)
    if (!target) throw new HttpError(404, '用户不存在')
    await assertProfileVisible(ctx, ctx.params.id, target.profile_visibility ?? 'login')
    const url = new URL(ctx.request.url)
    const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '') || 20, 1), MAX_PAGE)
    const c = parseCursor(url.searchParams.get('cursor') || '')
    let sql = `
      SELECT u.id AS user_id, s.user_name, u.username, s.avatar, u.verified,
        COALESCE(s.bio, '') AS bio, f1.created_at AS created_at, f1.followee_id AS rel_id
      FROM user_follows f1
      JOIN user_follows f2 ON f2.follower_id = f1.followee_id AND f2.followee_id = f1.follower_id
      JOIN users u ON u.id = f1.followee_id
      LEFT JOIN user_settings s ON s.user_id = u.id
      WHERE f1.follower_id = ?`
    const params: unknown[] = [ctx.params.id]
    if (c) { sql += ' AND (f1.created_at < ? OR (f1.created_at = ? AND f1.followee_id < ?))'; params.push(c.ts, c.ts, c.id) }
    sql += ' ORDER BY f1.created_at DESC, f1.followee_id DESC LIMIT ?'
    return followListResponse(ctx, sql, params, limit)
  })
}
