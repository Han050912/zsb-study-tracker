import type { Env } from '../index'
import { on } from '../router'
import { all, first, run, batch, uid, HttpError } from '../db'
import { rateLimit } from '../middleware/rateLimit'
import { awardBadge, hasBadge } from './badges'
import { IMAGE_MAX_BYTES, sniff, stripMetadata } from '../image'

/**
 * 社区图片上传：R2 存储 + Worker 代理读取。
 * - 上传为裸二进制直传（复用 pdfs.ts 的模式），Content-Type 仅作参考，真实格式以 Magic Bytes 为准
 * - 服务端剥离隐私元数据：JPEG APP1(EXIF)/COM 段、PNG eXIf/文本块、WebP EXIF/XMP 块；GIF 无 EXIF 概念直接透传
 * - 读取为公开路由（<img> 无法携带 Authorization），id 为 16 位 hex 随机串，不可枚举
 */

/** 单帖最多 9 张 */
export const IMAGE_MAX_PER_POST = 9
/** 单条评论最多 3 张 */
export const IMAGE_MAX_PER_COMMENT = 3
/** 单条私信最多 3 张 */
export const IMAGE_MAX_PER_MESSAGE = 3

const nowSec = () => Math.floor(Date.now() / 1000)

// ---------- 删帖时的图片清理（community.ts 复用） ----------

/** 从帖子 image_urls JSON 中提取上传 id（仅认本系统路径，忽略外部 URL） */
export function uploadIdsOf(raw: unknown): string[] {
  try {
    const v = JSON.parse(String(raw || '[]'))
    if (!Array.isArray(v)) return []
    return v
      .map((u) => (typeof u === 'string' ? u.match(/\/api\/community\/images\/([a-f0-9]{16})$/)?.[1] : undefined))
      .filter((x): x is string => !!x)
  } catch {
    return []
  }
}

/** 删除一组上传记录及对应 R2 对象；R2 删除失败仅记日志，不阻塞 DB 清理 */
export async function deleteUploads(env: Env, ids: string[]): Promise<void> {
  if (!ids.length) return
  const ph = ids.map(() => '?').join(',')
  const rows = await all<{ r2_key: string; thumb_r2_key: string | null }>(
    env,
    `SELECT r2_key, thumb_r2_key FROM community_uploads WHERE id IN (${ph})`,
    ...ids
  )
  await Promise.all(
    rows.flatMap((r) => {
      const dels: Promise<void>[] = [
        env.IMAGES.delete(r.r2_key).catch((e) => console.error('R2 删除失败', r.r2_key, e))
      ]
      if (r.thumb_r2_key)
        dels.push(env.IMAGES.delete(r.thumb_r2_key).catch((e) => console.error('R2 删除失败', r.thumb_r2_key, e)))
      return dels
    })
  )
  await run(env, `DELETE FROM community_uploads WHERE id IN (${ph})`, ...ids)
}

/** 惰性清理：删除 30 天前且未被帖子/评论/反馈引用的孤图。由每周 cron 调用（已从上传路径移除）。 */
export async function cleanupOrphanUploads(env: Env): Promise<void> {
  const cutoff = nowSec() - 30 * 86400
  // 单条查询带引用标记：三个 EXISTS 子查询逐字保留原 LIKE 口径（16 位 hex ID 无子串误匹配）
  const rows = await all<{
    id: string
    r2_key: string
    thumb_r2_key: string | null
    ref_post: number | null
    ref_comment: number | null
    ref_feedback: number | null
  }>(
    env,
    `SELECT cu.id, cu.r2_key, cu.thumb_r2_key,
       (SELECT 1 FROM community_posts   WHERE image_urls LIKE '%/api/community/images/' || cu.id || '%' LIMIT 1) AS ref_post,
       (SELECT 1 FROM community_comments WHERE image_urls LIKE '%/api/community/images/' || cu.id || '%' LIMIT 1) AS ref_comment,
       (SELECT 1 FROM feedback          WHERE image_urls LIKE '%/api/community/images/' || cu.id || '%' LIMIT 1) AS ref_feedback
     FROM community_uploads cu
     WHERE cu.created_at < ? LIMIT 200`,
    cutoff
  )
  const orphans = rows.filter((r) => !r.ref_post && !r.ref_comment && !r.ref_feedback)
  if (!orphans.length) return
  await Promise.all(
    orphans.flatMap((r) => {
      const dels: Promise<void>[] = [
        env.IMAGES.delete(r.r2_key).catch((e) => console.error('R2 删除失败', r.r2_key, e))
      ]
      if (r.thumb_r2_key)
        dels.push(env.IMAGES.delete(r.thumb_r2_key).catch((e) => console.error('R2 删除失败', r.thumb_r2_key, e)))
      return dels
    })
  )
  const ph = orphans.map(() => '?').join(',')
  await run(env, `DELETE FROM community_uploads WHERE id IN (${ph})`, ...orphans.map((r) => r.id))
}

// ---------- 路由 ----------

export function registerUploadRoutes() {
  // 上传图片（裸二进制；?filename= 可选，仅用于记录原始文件名）
  on('POST', '/api/community/upload', true, async (ctx) => {
    rateLimit(ctx.request, 'community:upload', 20)
    const q = new URL(ctx.request.url).searchParams
    const variant = q.get('variant')
    const thumbFor = q.get('id')
    const declared = Number(ctx.request.headers.get('Content-Length') || 0)
    if (declared > IMAGE_MAX_BYTES) throw new HttpError(413, '图片超过 5MB 上限')
    const buf = new Uint8Array(await ctx.request.arrayBuffer())
    if (!buf.byteLength) throw new HttpError(400, '文件为空')
    if (buf.byteLength > IMAGE_MAX_BYTES) throw new HttpError(413, '图片超过 5MB 上限')

    const kind = sniff(buf)
    if (!kind) throw new HttpError(400, '仅支持 PNG / JPEG / WebP / GIF 图片')

    const data = stripMetadata(buf, kind)
    if (!data) throw new HttpError(400, '图片文件损坏，无法处理')

    // 缩略图：关联到已有原图记录（原图必须先上传成功）
    if (variant === 'thumb') {
      if (!thumbFor || !/^[a-f0-9]{16}$/.test(thumbFor)) throw new HttpError(400, '参数错误')
      const owner = await first<{ id: string }>(
        ctx.env,
        'SELECT id FROM community_uploads WHERE id = ? AND user_id = ?',
        thumbFor,
        ctx.userId
      )
      if (!owner) throw new HttpError(404, '原图不存在')
      const tKind = sniff(buf)
      if (!tKind || tKind.ext === 'gif') throw new HttpError(400, '缩略图须为 PNG/JPEG/WebP')
      const tData = stripMetadata(buf, tKind)
      if (!tData) throw new HttpError(400, '图片文件损坏，无法处理')
      const tKey = `posts/${thumbFor}.thumb.${tKind.ext}`
      await ctx.env.IMAGES.put(tKey, tData, { httpMetadata: { contentType: tKind.mime } })
      await run(ctx.env, 'UPDATE community_uploads SET thumb_r2_key = ? WHERE id = ?', tKey, thumbFor)
      return Response.json({ id: thumbFor, url: `/api/community/images/${thumbFor}` }, { status: 201 })
    }

    // 头像：独立 R2 前缀 + user_settings.avatar 字段；不写 community_uploads，
    // 否则 cleanupOrphanUploads 会因头像不被帖子/评论/反馈引用而在 30 天后误删
    if (variant === 'avatar') {
      if (kind.ext === 'gif') throw new HttpError(400, '头像仅支持 PNG / JPEG / WebP')
      const old = await first<{ avatar: string | null }>(
        ctx.env,
        'SELECT avatar FROM user_settings WHERE user_id = ?',
        ctx.userId
      )
      const avId = uid()
      const avKey = `avatars/${avId}.${kind.ext}`
      await ctx.env.IMAGES.put(avKey, data, { httpMetadata: { contentType: kind.mime } })
      const url = `/api/avatar/${avId}.${kind.ext}`
      await run(
        ctx.env,
        'INSERT INTO user_settings (user_id, avatar) VALUES (?, ?) ' +
          'ON CONFLICT(user_id) DO UPDATE SET avatar = excluded.avatar',
        ctx.userId,
        url
      )
      // 删除旧头像对象（失败仅记日志；下次换头像时会随新流程再尝试删除）
      const oldFile = old?.avatar?.match(/^\/api\/avatar\/([a-f0-9]{16}\.(?:png|jpg|webp))$/)?.[1]
      if (oldFile)
        await ctx.env.IMAGES.delete(`avatars/${oldFile}`).catch((e) =>
          console.error('[avatar] 旧头像删除失败', oldFile, e)
        )
      return Response.json({ url }, { status: 201 })
    }

    const id = uid()
    const key = `posts/${id}.${kind.ext}`
    await ctx.env.IMAGES.put(key, data, { httpMetadata: { contentType: kind.mime } })
    const url = `/api/community/images/${id}`
    const filename = (new URL(ctx.request.url).searchParams.get('filename') || '').slice(0, 100)
    await run(
      ctx.env,
      'INSERT INTO community_uploads (id, user_id, filename, r2_key, url, size, content_type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      id,
      ctx.userId,
      filename,
      key,
      url,
      data.byteLength,
      kind.mime,
      nowSec()
    )
    // 徽章：图片达人（累计上传 ≥50 张；已持有者跳过统计查询）
    if (!(await hasBadge(ctx.env, ctx.userId, 'image_50'))) {
      const cnt = await first<{ n: number }>(
        ctx.env,
        'SELECT COUNT(*) AS n FROM community_uploads WHERE user_id = ?',
        ctx.userId
      )
      if ((cnt?.n ?? 0) >= 50) await batch(ctx.env, await awardBadge(ctx.env, ctx.userId, 'image_50'))
    }
    return Response.json({ id, url, size: data.byteLength, contentType: kind.mime }, { status: 201 })
  })

  // 读取图片（公开路由，供 <img> 直接引用；内容 immutable 长缓存）
  on('GET', '/api/community/images/:id', false, async (ctx) => {
    const { id } = ctx.params
    if (!/^[a-f0-9]{16}$/.test(id)) throw new HttpError(400, '非法图片 ID')
    const thumb = new URL(ctx.request.url).searchParams.get('thumb') === '1'
    const row = await first<{ r2_key: string; thumb_r2_key: string | null; content_type: string }>(
      ctx.env,
      'SELECT r2_key, thumb_r2_key, content_type FROM community_uploads WHERE id = ?',
      id
    )
    if (!row) throw new HttpError(404, '图片不存在')
    const key = thumb && row.thumb_r2_key ? row.thumb_r2_key : row.r2_key
    const obj = await ctx.env.IMAGES.get(key)
    if (!obj) throw new HttpError(404, '图片不存在')
    return new Response(obj.body, {
      headers: {
        'Content-Type': thumb && row.thumb_r2_key ? 'image/webp' : row.content_type,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff'
      }
    })
  })

  // 读取头像（公开路由，供 <img> 直引；文件名含扩展名，按扩展名给 Content-Type，immutable 长缓存）
  on('GET', '/api/avatar/:file', false, async (ctx) => {
    const { file } = ctx.params
    const m = file.match(/^([a-f0-9]{16})\.(png|jpg|webp)$/)
    if (!m) throw new HttpError(400, '非法头像文件名')
    const obj = await ctx.env.IMAGES.get(`avatars/${file}`)
    if (!obj) throw new HttpError(404, '头像不存在')
    const mime = m[2] === 'png' ? 'image/png' : m[2] === 'jpg' ? 'image/jpeg' : 'image/webp'
    return new Response(obj.body, {
      headers: {
        'Content-Type': mime,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff'
      }
    })
  })
}
