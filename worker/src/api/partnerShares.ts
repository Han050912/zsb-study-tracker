import type { Env } from '../index'
import { on, body } from '../router'
import { all, first, run, batch, uid, HttpError } from '../db'
import { rateLimit } from '../middleware/rateLimit'
import { displayName, notifyStatement } from './community'
import { assertPartner } from './partners'

const nowSec = () => Math.floor(Date.now() / 1000)

/** 校验用户是否开启了搭子数据共享（分享/查看均需 owner 开启） */
async function assertShareEnabled(env: Env, ownerId: string) {
  const s = await first<{ partner_share_enabled: number }>(env,
    `SELECT partner_share_enabled FROM user_settings WHERE user_id = ?`, ownerId)
  if (!s?.partner_share_enabled) throw new HttpError(403, '分享者未开放学习数据共享')
}

/** 获取分享项内容（错题/笔记），归属校验 */
async function getItem(env: Env, itemType: string, itemId: string, ownerId: string) {
  if (itemType === 'error') {
    // error_questions 实际列为 content（题目）/ answer（答案）/ review_count（复习次数），无 note 列，
    // 此处以别名映射到前端期望的 question/answer/wrong_count 字段
    const r = await first<{
      id: string; question: string; answer: string; wrong_count: number; subject_id: string
    }>(env,
      `SELECT id, content AS question, answer, review_count AS wrong_count, subject_id FROM error_questions WHERE id = ? AND user_id = ?`,
      itemId, ownerId)
    if (!r) throw new HttpError(404, '错题不存在')
    return r
  }
  if (itemType === 'note') {
    const r = await first<{ id: string; title: string; content: string }>(env,
      `SELECT id, title, content FROM notes WHERE id = ? AND user_id = ?`, itemId, ownerId)
    if (!r) throw new HttpError(404, '笔记不存在')
    return r
  }
  throw new HttpError(400, 'itemType 需为 error 或 note')
}

export function registerPartnerShareRoutes() {
  // 分享错题/笔记给搭子（需 owner 开启数据共享）
  on('POST', '/api/partner-shares', true, async (ctx) => {
    rateLimit(ctx.request, 'partner:share', 30)
    const b = await body(ctx.request)
    const partnerId = typeof b?.partnerId === 'string' ? b.partnerId : ''
    const itemType = typeof b?.itemType === 'string' ? b.itemType : ''
    const itemId = typeof b?.itemId === 'string' ? b.itemId : ''
    if (!partnerId || !itemId) throw new HttpError(400, 'partnerId 与 itemId 必填')
    if (partnerId === ctx.userId) throw new HttpError(400, '不能分享给自己')

    await assertPartner(ctx.env, ctx.userId, partnerId)
    await assertShareEnabled(ctx.env, ctx.userId)
    await getItem(ctx.env, itemType, itemId, ctx.userId)

    // 防止重复分享同一内容给同一搭子
    const dup = await first<{ id: string }>(ctx.env,
      `SELECT id FROM partner_shares WHERE owner_id = ? AND partner_id = ? AND item_type = ? AND item_id = ?`,
      ctx.userId, partnerId, itemType, itemId)
    if (dup) return Response.json({ id: dup.id })

    const id = uid()
    await batch(ctx.env, [
      ctx.env.DB.prepare(
        `INSERT INTO partner_shares (id, owner_id, partner_id, item_type, item_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(id, ctx.userId, partnerId, itemType, itemId, nowSec()),
      notifyStatement(ctx.env, {
        userId: partnerId, type: 'partner', actorId: ctx.userId,
        targetType: 'partner', targetId: id,
        content: `${await displayName(ctx.env, ctx.userId)} 分享了一篇${itemType === 'error' ? '错题' : '笔记'}给你`
      })
    ])
    return Response.json({ id }, { status: 201 })
  })

  // 分享列表：我收到的 + 我发出的
  on('GET', '/api/partner-shares', true, async (ctx) => {
    const rows = await all<{
      id: string; owner_id: string; partner_id: string; item_type: string; item_id: string; created_at: number
      owner_name: string; partner_name: string; comment_count: number
    }>(ctx.env, `
      SELECT s.*,
        COALESCE(so.user_name, uo.username) AS owner_name,
        COALESCE(sp.user_name, up.username) AS partner_name,
        (SELECT COUNT(*) FROM partner_share_comments c WHERE c.share_id = s.id) AS comment_count
      FROM partner_shares s
      LEFT JOIN users uo ON uo.id = s.owner_id
      LEFT JOIN user_settings so ON so.user_id = s.owner_id
      LEFT JOIN users up ON up.id = s.partner_id
      LEFT JOIN user_settings sp ON sp.user_id = s.partner_id
      WHERE s.owner_id = ? OR s.partner_id = ?
      ORDER BY s.created_at DESC LIMIT 100
    `, ctx.userId, ctx.userId)

    return Response.json({
      received: rows.filter(r => r.partner_id === ctx.userId).map(mapShare),
      sent: rows.filter(r => r.owner_id === ctx.userId).map(mapShare)
    })
  })

  // 分享详情（含错题/笔记内容 + 批注列表）
  on('GET', '/api/partner-shares/:id', true, async (ctx) => {
    const share = await first<{
      id: string; owner_id: string; partner_id: string; item_type: string; item_id: string; created_at: number
    }>(ctx.env,
      `SELECT id, owner_id, partner_id, item_type, item_id, created_at FROM partner_shares WHERE id = ?`,
      ctx.params.id)
    if (!share) throw new HttpError(404, '分享不存在')
    if (share.owner_id !== ctx.userId && share.partner_id !== ctx.userId) throw new HttpError(403, '无权查看')

    // 内容受 owner 隐私开关管控
    await assertShareEnabled(ctx.env, share.owner_id)
    const item = await getItem(ctx.env, share.item_type, share.item_id, share.owner_id)

    const comments = await all<{ id: string; user_id: string; content: string; created_at: number; user_name: string }>(ctx.env, `
      SELECT c.id, c.user_id, c.content, c.created_at,
        COALESCE(s.user_name, u.username) AS user_name
      FROM partner_share_comments c
      LEFT JOIN users u ON u.id = c.user_id
      LEFT JOIN user_settings s ON s.user_id = c.user_id
      WHERE c.share_id = ? ORDER BY c.created_at ASC
    `, share.id)

    const [ownerName, partnerName] = await Promise.all([
      displayName(ctx.env, share.owner_id),
      displayName(ctx.env, share.partner_id)
    ])

    return Response.json({
      id: share.id,
      ownerId: share.owner_id,
      ownerName,
      partnerId: share.partner_id,
      partnerName,
      itemType: share.item_type,
      itemId: share.item_id,
      item,
      createdAt: share.created_at,
      comments: comments.map(c => ({
        id: c.id, userId: c.user_id, userName: c.user_name, content: c.content, createdAt: c.created_at
      }))
    })
  })

  // 添加批注（双人私密交流）
  on('POST', '/api/partner-shares/:id/comments', true, async (ctx) => {
    rateLimit(ctx.request, 'partner:comment', 30)
    const b = await body(ctx.request)
    const content = typeof b?.content === 'string' ? b.content.trim() : ''
    if (!content) throw new HttpError(400, '批注内容必填')
    if (content.length > 500) throw new HttpError(400, '批注最多 500 字')

    const share = await first<{ id: string; owner_id: string; partner_id: string }>(ctx.env,
      `SELECT id, owner_id, partner_id FROM partner_shares WHERE id = ?`, ctx.params.id)
    if (!share) throw new HttpError(404, '分享不存在')
    if (share.owner_id !== ctx.userId && share.partner_id !== ctx.userId) throw new HttpError(403, '无权批注')

    const id = uid()
    const otherId = share.owner_id === ctx.userId ? share.partner_id : share.owner_id
    await batch(ctx.env, [
      ctx.env.DB.prepare(
        `INSERT INTO partner_share_comments (id, share_id, user_id, content, created_at) VALUES (?, ?, ?, ?, ?)`
      ).bind(id, share.id, ctx.userId, content, nowSec()),
      notifyStatement(ctx.env, {
        userId: otherId, type: 'partner', actorId: ctx.userId,
        targetType: 'partner', targetId: share.id,
        content: `${await displayName(ctx.env, ctx.userId)} 批注了你分享的内容`
      })
    ])
    return Response.json({ id }, { status: 201 })
  })

  // 删除分享（仅分享者）
  on('DELETE', '/api/partner-shares/:id', true, async (ctx) => {
    const res = await run(ctx.env,
      `DELETE FROM partner_shares WHERE id = ? AND owner_id = ?`, ctx.params.id, ctx.userId)
    if (!res.meta.changes) throw new HttpError(404, '分享不存在或无权删除')
    // 级联删除批注
    await run(ctx.env, `DELETE FROM partner_share_comments WHERE share_id = ?`, ctx.params.id)
    return Response.json({ ok: true })
  })
}

function mapShare(r: {
  id: string; owner_id: string; partner_id: string; item_type: string; item_id: string; created_at: number
  owner_name: string; partner_name: string; comment_count: number
}) {
  return {
    id: r.id,
    ownerId: r.owner_id,
    ownerName: r.owner_name,
    partnerId: r.partner_id,
    partnerName: r.partner_name,
    itemType: r.item_type,
    itemId: r.item_id,
    commentCount: r.comment_count,
    createdAt: r.created_at
  }
}
