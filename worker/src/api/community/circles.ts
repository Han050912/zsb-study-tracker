import { on, body } from '../../router'
import { all, first, run, batch, uid, HttpError } from '../../db'
import { rateLimit } from '../../middleware/rateLimit'
import { assertCleanAsync } from '../sensitive'
import { mapCircle, nowSec, displayName, notifyStatement, escapeLike } from './shared'

/**
 * 社区广场话题圈子域路由：圈子列表 / 建圈 / 详情 / 加入退圈 / 审批 / 移除成员。
 * 由 community/index.ts 的 registerCommunityRoutes 聚合注册。
 * 零逻辑改动：on(...) 块从原 community.ts 逐字搬迁，仅调整 import 路径与包一层 registerCirclesRoutes()。
 */
export function registerCirclesRoutes() {
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
    await assertCleanAsync(name, ctx.env)
    if (description) await assertCleanAsync(description, ctx.env)
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
      SELECT m.user_id, m.role, COALESCE(s.user_name, u.username) AS user_name, u.verified, s.avatar AS user_avatar
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
        SELECT m.user_id, COALESCE(s.user_name, u.username) AS user_name, m.created_at, s.avatar AS user_avatar
        FROM circle_members m
        JOIN users u ON u.id = m.user_id
        LEFT JOIN user_settings s ON s.user_id = m.user_id
        WHERE m.circle_id = ? AND m.status = 'pending'
        ORDER BY m.created_at ASC`, ctx.params.id)
    }
    return Response.json({
      circle: mapCircle(circle, myStatus),
      members: members.map(m => ({ userId: m.user_id, userName: m.user_name || '升本人', role: m.role, verified: !!m.verified, userAvatar: m.user_avatar ?? undefined })),
      pending: pending.map(p => ({ userId: p.user_id, userName: p.user_name || '升本人', createdAt: p.created_at, userAvatar: p.user_avatar ?? undefined }))
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
      // 取消申请：同时撤回给圈主的申请通知（按「申请加入圈子「<圈名>」」精确匹配，
      // 避免误删同一圈主名下其他圈子的申请通知；LIKE 通配符转义同 tags 查询口径）
      await batch(ctx.env, [
        ctx.env.DB.prepare('DELETE FROM circle_members WHERE circle_id = ? AND user_id = ?').bind(ctx.params.id, ctx.userId),
        ctx.env.DB.prepare(
          "DELETE FROM community_notifications WHERE type = 'system' AND actor_id = ? AND user_id = ? " +
          "AND content LIKE ? ESCAPE '\\'"
        ).bind(ctx.userId, circle.creator_id, `%申请加入圈子「${escapeLike(circle.name)}」%`)
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
        targetType: 'circle', targetId: ctx.params.id,
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
        targetType: 'circle', targetId: ctx.params.id,
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
}
