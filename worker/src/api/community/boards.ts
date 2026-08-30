import { on } from '../../router'
import { all, first, utc8Today } from '../../db'
import { mapPost, POST_SELECT, nowSec } from './shared'

/**
 * 社区广场榜单域路由：每日一题 / 每日打卡榜 / 学习周报 / 学习进度榜 / 个性化推荐 / 热门话题。
 * 由 community/index.ts 的 registerCommunityRoutes 聚合注册。
 * 零逻辑改动：on(...) 块从原 community.ts 逐字搬迁，仅调整 import 路径与包一层 registerBoardsRoutes()。
 */
export function registerBoardsRoutes() {
  // 每日一题：最新一条被标记且未隐藏的帖子（广场顶部展示）
  on('GET', '/api/community/daily', false, async (ctx) => {
    const row = await first<any>(ctx.env,
      `${POST_SELECT} WHERE p.is_daily = 1 AND p.is_hidden = 0 ORDER BY p.created_at DESC LIMIT 1`, ctx.userId, ctx.userId)
    return Response.json({ post: row ? mapPost(row) : null })
  })

  // 每日打卡榜：今日打卡榜 TOP 10（今日已打卡者按当日积分降序）+ 连续打卡王 TOP 5（streak 降序）
  on('GET', '/api/community/leaderboard', true, async (ctx) => {
    const today = utc8Today()
    const [todayRows, streakRows, subjectRows] = await Promise.all([
      all<{ user_id: string; user_name: string; points: number; streak: number; today_points: number; verified: number; user_avatar?: string }>(ctx.env, `
        SELECT g.user_id, COALESCE(s.user_name, u.username) AS user_name, g.points, g.streak, u.verified,
          s.avatar AS user_avatar, SUM(pl.points) AS today_points
        FROM points_log pl
        JOIN gamification g ON g.user_id = pl.user_id AND g.last_checkin = ?
        JOIN users u ON u.id = pl.user_id
        LEFT JOIN user_settings s ON s.user_id = pl.user_id
        WHERE pl.date = ?
        GROUP BY pl.user_id
        ORDER BY today_points DESC, g.points DESC
        LIMIT 10`, today, today),
      all<{ user_id: string; user_name: string; points: number; streak: number; verified: number; user_avatar?: string }>(ctx.env, `
        SELECT g.user_id, COALESCE(s.user_name, u.username) AS user_name, g.points, g.streak, u.verified,
          s.avatar AS user_avatar
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
        userId: r.user_id, userName: r.user_name || '升本人', userAvatar: r.user_avatar ?? undefined, todayPoints: r.today_points,
        streak: r.streak, totalPoints: r.points, verified: !!r.verified, subjects: subjMap.get(r.user_id) ?? []
      })),
      streak: streakRows.map(r => ({
        userId: r.user_id, userName: r.user_name || '升本人', userAvatar: r.user_avatar ?? undefined, streak: r.streak, totalPoints: r.points, verified: !!r.verified
      }))
    })
  })

  // 每周学习周报：上周一至周日（UTC+8）惰性聚合，纯读无缓存，周界变更自动刷新
  on('GET', '/api/community/weekly-report', true, async (ctx) => {
    // 上周区间：以 UTC+8 当前时刻推算，周一为一周起点
    const t = new Date(Date.now() + 8 * 3600_000)
    const daysSinceMonday = (t.getUTCDay() + 6) % 7
    const monday = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate() - daysSinceMonday - 7))
    const fmt = (d: Date) => d.toISOString().slice(0, 10)
    const weekStart = fmt(monday)
    const weekEnd = fmt(new Date(monday.getTime() + 6 * 86400_000))
    // created_at（unix 秒）区间：周一起点 至 下周一 00:00（开区间）
    const startTs = Math.floor(monday.getTime() / 1000) - 8 * 3600
    const endTs = startTs + 7 * 86400
    const [study, problems, points, posts, comments] = await Promise.all([
      first<{ minutes: number; days: number }>(ctx.env,
        'SELECT COALESCE(SUM(minutes), 0) AS minutes, COUNT(DISTINCT date) AS days FROM study_records WHERE user_id = ? AND date >= ? AND date <= ?',
        ctx.userId, weekStart, weekEnd),
      first<{ total: number; correct: number }>(ctx.env,
        'SELECT COALESCE(SUM(total), 0) AS total, COALESCE(SUM(correct), 0) AS correct FROM problem_sessions WHERE user_id = ? AND date >= ? AND date <= ?',
        ctx.userId, weekStart, weekEnd),
      first<{ points: number }>(ctx.env,
        'SELECT COALESCE(SUM(points), 0) AS points FROM points_log WHERE user_id = ? AND date >= ? AND date <= ?',
        ctx.userId, weekStart, weekEnd),
      first<{ n: number }>(ctx.env,
        'SELECT COUNT(*) AS n FROM community_posts WHERE user_id = ? AND created_at >= ? AND created_at < ?',
        ctx.userId, startTs, endTs),
      first<{ n: number }>(ctx.env,
        'SELECT COUNT(*) AS n FROM community_comments WHERE user_id = ? AND created_at >= ? AND created_at < ?',
        ctx.userId, startTs, endTs)
    ])
    return Response.json({
      weekStart, weekEnd,
      minutes: study?.minutes ?? 0,
      studyDays: study?.days ?? 0,
      problems: problems?.total ?? 0,
      correct: problems?.correct ?? 0,
      points: points?.points ?? 0,
      interactions: (posts?.n ?? 0) + (comments?.n ?? 0)
    })
  })

  // 学习进度对比：本周学习时长榜 / 本月刷题数榜（仅 join_progress_board=1 用户上榜，TOP 50；不展示末位排名）
  on('GET', '/api/community/progress-board', true, async (ctx) => {
    const t = new Date(Date.now() + 8 * 3600_000)
    const fmt = (d: Date) => d.toISOString().slice(0, 10)
    const daysSinceMonday = (t.getUTCDay() + 6) % 7
    const weekStart = fmt(new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate() - daysSinceMonday)))
    const today = fmt(t)
    const monthStart = today.slice(0, 8) + '01'

    /** 参与者聚合行：user_id、展示名、蓝V、总积分、区间内 SUM 值 */
    const participantsSql = (table: string, valueCol: string) => `
      SELECT r.user_id, COALESCE(s.user_name, u.username) AS user_name, u.verified,
        s.avatar AS user_avatar, COALESCE(g.points, 0) AS total_points, SUM(r.${valueCol}) AS value
      FROM ${table} r
      JOIN user_settings us ON us.user_id = r.user_id AND us.join_progress_board = 1
      JOIN users u ON u.id = r.user_id
      LEFT JOIN user_settings s ON s.user_id = r.user_id
      LEFT JOIN gamification g ON g.user_id = r.user_id
      WHERE r.date >= ? AND r.date <= ?
      GROUP BY r.user_id`

    /** 本人区间内总值（无论是否参与榜单，都返回用于自我对照） */
    const myValueSql = (table: string, valueCol: string, start: string, end: string) =>
      first<{ v: number }>(ctx.env,
        `SELECT COALESCE(SUM(${valueCol}), 0) AS v FROM ${table} WHERE user_id = ? AND date >= ? AND date <= ?`,
        ctx.userId, start, end)

    const [weekRows, monthRows, meWeek, meMonth] = await Promise.all([
      all<any>(ctx.env, participantsSql('study_records', 'minutes'), weekStart, today),
      all<any>(ctx.env, participantsSql('problem_sessions', 'total'), monthStart, today),
      myValueSql('study_records', 'minutes', weekStart, today),
      myValueSql('problem_sessions', 'total', monthStart, today)
    ])

    /** 榜单块：TOP 50 + 本人排名/百分位（rank = 参与者中严格大于本人值的人数 + 1；无参与者时 rank/percentile 为 null） */
    const boardBlock = (rows: any[], myValue: number) => {
      const sorted = rows.sort((a, b) => b.value - a.value || b.total_points - a.total_points)
      const list = sorted.slice(0, 50).map((r, i) => ({
        userId: r.user_id, userName: r.user_name || '升本人', verified: !!r.verified,
        userAvatar: r.user_avatar ?? undefined,
        totalPoints: r.total_points, value: r.value, isMe: r.user_id === ctx.userId
      }))
      const greater = sorted.filter(r => r.value > myValue).length
      const total = sorted.length
      const me = total
        ? { value: myValue, rank: greater + 1, percentile: Math.round(((total - greater - 1) / total) * 100) }
        : { value: myValue, rank: null, percentile: null }
      return { list, me }
    }

    const joinedRow = await first<{ joined: number }>(ctx.env,
      'SELECT (join_progress_board = 1) AS joined FROM user_settings WHERE user_id = ?', ctx.userId)
    const joined = !!joinedRow?.joined

    return Response.json({
      joined,
      weekMinutes: boardBlock(weekRows, meWeek?.v ?? 0),
      monthProblems: boardBlock(monthRows, meMonth?.v ?? 0)
    })
  })

  // 个性化推荐：帖子(关注作者/常用tag) + 圈子(人气) + 用户(活跃同科目)；冷启动回退热门
  on('GET', '/api/community/recommend', true, async (ctx) => {
    const weekAgoDate = new Date(Date.now() + 8 * 3600_000 - 7 * 86400_000).toISOString().slice(0, 10)

    // 1. 我的常用 tag（近 30 天我发过/赞过/评论过的帖子 tags）
    const myTags = await all<{ tag: string }>(ctx.env, `
      SELECT t.value AS tag FROM (
        SELECT p.tags FROM community_posts p WHERE p.user_id = ? AND p.created_at >= ?
        UNION ALL SELECT p.tags FROM community_posts p
          JOIN community_likes l ON l.target_type = 'post' AND l.target_id = p.id AND l.user_id = ?
        UNION ALL SELECT p.tags FROM community_posts p
          JOIN community_comments c ON c.post_id = p.id AND c.user_id = ?
      ) x, json_each(x.tags) t
      WHERE t.value LIKE '#%' GROUP BY t.value ORDER BY COUNT(*) DESC LIMIT 5`,
      ctx.userId, nowSec() - 30 * 86400, ctx.userId, ctx.userId)
    const tags = myTags.map(r => r.tag)
    const followIds = (await all<{ followee_id: string }>(ctx.env,
      'SELECT followee_id FROM user_follows WHERE follower_id = ?', ctx.userId)).map(r => r.followee_id)

    // 2. 帖子推荐：关注作者 OR 常用 tag；无信号或结果为空则回退热门
    let postRows: any[]
    // 软违规待审帖仅作者/管理员可见（与列表/详情接口同一口径）
    const postsParams: unknown[] = [ctx.userId]
    let postWhere = 'p.is_hidden = 0 AND p.circle_id IS NULL AND (p.is_flagged = 0 OR p.user_id = ?)'
    if (followIds.length || tags.length) {
      const ors: string[] = []
      if (followIds.length) { ors.push(`p.user_id IN (${followIds.map(() => '?').join(',')})`); postsParams.push(...followIds) }
      if (tags.length) { ors.push(`EXISTS (SELECT 1 FROM json_each(p.tags) j WHERE j.value IN (${tags.map(() => '?').join(',')}))`); postsParams.push(...tags) }
      postWhere += ` AND (${ors.join(' OR ')})`
    }
    postRows = await all<any>(ctx.env,
      `${POST_SELECT} WHERE ${postWhere} ORDER BY (p.likes_count * 2 + p.comments_count * 3) DESC, p.created_at DESC LIMIT 10`,
      ctx.userId, ctx.userId, ...postsParams)
    if (!postRows.length) {
      postRows = await all<any>(ctx.env,
        `${POST_SELECT} WHERE p.is_hidden = 0 AND p.circle_id IS NULL AND (p.is_flagged = 0 OR p.user_id = ?) ORDER BY (p.likes_count * 2 + p.comments_count * 3) DESC, p.created_at DESC LIMIT 10`,
        ctx.userId, ctx.userId, ctx.userId)
    }

    // 3. 圈子推荐：人气降序，排除已加入
    const circles = await all<any>(ctx.env, `
      SELECT c.id, c.name, c.description, c.creator_id, c.is_public, c.member_count, c.created_at,
        (cm.user_id IS NOT NULL) AS joined
      FROM community_circles c
      LEFT JOIN circle_members cm ON cm.circle_id = c.id AND cm.user_id = ? AND cm.status = 'active'
      WHERE c.is_public = 1
      ORDER BY c.member_count DESC, c.created_at DESC
      LIMIT 5`, ctx.userId)
    const circleList = circles.map((r: any) => ({
      id: r.id, name: r.name, description: r.description, creatorId: r.creator_id,
      isPublic: !!r.is_public, memberCount: r.member_count, createdAt: r.created_at,
      myStatus: r.joined ? 'member' : null
    }))

    // 4. 用户推荐：近 7 天活跃 + 同薄弱科目；排除自己/已关注
    const weakMine = await all<{ subject_id: string }>(ctx.env, `
      SELECT c.subject_id FROM topics t JOIN chapters c ON c.id = t.chapter_id AND c.user_id = t.user_id
      WHERE t.user_id = ? AND t.mastery > 0 GROUP BY c.subject_id HAVING AVG(t.mastery) < 3`, ctx.userId)
    const myWeak = weakMine.map(r => r.subject_id)
    const activeUsers = await all<any>(ctx.env, `
      SELECT r.user_id, COALESCE(s.user_name, u.username) AS user_name, u.verified,
        s.avatar AS user_avatar, COALESCE(g.points, 0) AS total_points, SUM(r.minutes) AS minutes
      FROM study_records r
      JOIN users u ON u.id = r.user_id
      LEFT JOIN user_settings s ON s.user_id = r.user_id
      LEFT JOIN gamification g ON g.user_id = r.user_id
      WHERE r.date >= ? AND r.user_id != ?
        AND r.user_id NOT IN (SELECT followee_id FROM user_follows WHERE follower_id = ?)
      GROUP BY r.user_id ORDER BY minutes DESC LIMIT 20`, weekAgoDate, ctx.userId, ctx.userId)
    // 4.1 批量查询全部活跃用户的薄弱科目（替代逐用户 N+1；GROUP BY 用户×科目 与逐条语义等价）
    if (activeUsers.length === 0) {
      return Response.json({ posts: postRows.map(mapPost), circles: circleList, users: [] })
    }
    const weakRows = await all<{ user_id: string; subject_id: string }>(ctx.env,
      `SELECT t.user_id, c.subject_id
       FROM topics t JOIN chapters c ON c.id = t.chapter_id AND c.user_id = t.user_id
       WHERE t.mastery > 0 AND t.user_id IN (${activeUsers.map(() => '?').join(',')})
       GROUP BY t.user_id, c.subject_id
       HAVING AVG(t.mastery) < 3`,
      ...activeUsers.map(u => u.user_id))
    const weakByUser = new Map<string, Set<string>>()
    for (const r of weakRows) {
      const set = weakByUser.get(r.user_id) ?? new Set<string>()
      set.add(r.subject_id)
      weakByUser.set(r.user_id, set)
    }
    const users = activeUsers.map(u => {
      const uWeak = weakByUser.get(u.user_id) ?? new Set<string>()
      const overlap = [...uWeak].filter(s => myWeak.includes(s)).length
      return {
        userId: u.user_id, userName: u.user_name || '升本人', verified: !!u.verified,
        userAvatar: u.user_avatar ?? undefined,
        totalPoints: u.total_points, reason: overlap ? '与你有相同的薄弱科目' : '近一周学习活跃'
      }
    })

    return Response.json({ posts: postRows.map(mapPost), circles: circleList, users: users.slice(0, 5) })
  })

  // 热门话题运营位：近 7 天帖子 tag 频次自动统计（D1 JSON1），叠加管理员 pin/block 干预，上限 5 条
  on('GET', '/api/community/hot-topics', false, async (ctx) => {
    const overrides = await all<{ id: string; text: string; tag: string; action: string }>(ctx.env,
      'SELECT id, text, tag, action FROM community_hot_topics')
    const pins = overrides.filter(o => o.action === 'pin')
    const blocks = new Set(overrides.filter(o => o.action === 'block').map(o => o.tag))
    const weekAgo = nowSec() - 7 * 86400
    const rows = await all<{ tag: string; count: number }>(ctx.env,
      `SELECT t.value AS tag, COUNT(*) AS count FROM community_posts p, json_each(p.tags) t
       WHERE p.created_at >= ? AND p.is_hidden = 0 GROUP BY t.value ORDER BY count DESC LIMIT 50`, weekAgo)
    const pinnedTags = new Set(pins.map(p => p.tag))
    const auto = rows
      .filter(r => r.tag.startsWith('#') && r.tag.length <= 20 && !blocks.has(r.tag) && !pinnedTags.has(r.tag))
      .map(r => ({ text: r.tag, tag: r.tag, count: r.count, pinned: false }))
    const pinned = pins.map(p => ({ text: p.text, tag: p.tag, count: 0, pinned: true }))
    return Response.json({ topics: [...pinned, ...auto].slice(0, 5) })
  })
}
