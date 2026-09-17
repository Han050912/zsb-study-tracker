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

// ---------- 上传引用源（单点口径：孤图清理与删帖/删评论共用） ----------

/**
 * 引用社区图片（`/api/community/images/<id>`）的**全部**真实来源表（口径单点，勿在别处另立一份）。
 * 孤图判定（周 cron）与删除上传前的引用统计共用此列表，避免两处漂移（issue #10 / #37）。
 * 每张表都有一个 JSON 数组列 `image_urls`；`partner_shares` / `partner_share_comments` 等表不引用图片。
 */
const UPLOAD_REF_TABLES = ['community_posts', 'community_comments', 'community_messages', 'feedback'] as const

/** D1 单条语句绑定参数上限 100；UNION 4 张来源表 → 每块候选最多 20 个 URL（4×20=80 参数） */
const REF_CHECK_CHUNK = 20

/** 本系统图片路径 → 上传 id（仅认自身路径，忽略外部 URL / 头像路径） */
const IMAGE_ID_RE = /\/api\/community\/images\/([a-f0-9]{16})/

/**
 * 在给定候选上传 id 中筛出**仍被引用**的 id（posts / comments / messages / feedback）。
 *
 * 用 `json_each` 展开各来源表的 `image_urls` 后按 `IN` **等值**匹配整批候选，取代原先「每个候选行
 * 跑 3 次 `LIKE '%…%'`」的前缀通配写法——后者对每张来源表都是全表扫描，最坏放大成 N×3 次全表扫描
 * （issue #42）。此处每张来源表每块候选只扫一次，复杂度与候选批大小线性。
 */
async function referencedUploadIds(env: Env, ids: string[]): Promise<Set<string>> {
  const unique = [...new Set(ids)]
  const found = new Set<string>()
  for (let i = 0; i < unique.length; i += REF_CHECK_CHUNK) {
    const urls = unique.slice(i, i + REF_CHECK_CHUNK).map((id) => `/api/community/images/${id}`)
    const ph = urls.map(() => '?').join(',')
    // json_valid 兜底：单行损坏的 image_urls 不至于让整条清理查询报错（与历史 LIKE 写法的容错一致）
    const sql = UPLOAD_REF_TABLES.map(
      (t) =>
        `SELECT j.value AS url FROM ${t} t` +
        `, json_each(CASE WHEN json_valid(t.image_urls) THEN t.image_urls ELSE '[]' END) j` +
        ` WHERE j.value IN (${ph})`
    ).join(' UNION ')
    const rows = await all<{ url: string }>(env, sql, ...UPLOAD_REF_TABLES.flatMap(() => urls))
    for (const r of rows) {
      const m = IMAGE_ID_RE.exec(String(r.url))
      if (m) found.add(m[1])
    }
  }
  return found
}

/** 删除给定上传行的 R2 对象（含缩略图）与归属行；R2 删除失败仅记日志，不阻塞 DB 清理 */
async function deleteUploadRows(
  env: Env,
  rows: { id: string; r2_key: string; thumb_r2_key: string | null }[]
): Promise<void> {
  if (!rows.length) return
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
  const ph = rows.map(() => '?').join(',')
  await run(env, `DELETE FROM community_uploads WHERE id IN (${ph})`, ...rows.map((r) => r.id))
}

/** 从帖子/评论/私信/反馈的 image_urls JSON 中提取上传 id（仅认本系统路径，忽略外部 URL） */
export function uploadIdsOf(raw: unknown): string[] {
  try {
    const v = JSON.parse(String(raw || '[]'))
    if (!Array.isArray(v)) return []
    return v.map((u) => (typeof u === 'string' ? IMAGE_ID_RE.exec(u)?.[1] : undefined)).filter((x): x is string => !!x)
  } catch {
    return []
  }
}

/**
 * 删除一组上传记录及对应 R2 对象。
 *
 * **仍有其它引用时不删**（issue #37）：同一张图可被多个帖子 / 评论 / 私信 / 反馈复用，
 * 删除其中一个引用方（其引用关系已随级联删除先行解除）不得连带删掉其它引用方仍在使用的
 * R2 对象与 `community_uploads` 归属行。R2 删除失败仅记日志，不阻塞 DB 清理。
 */
export async function deleteUploads(env: Env, ids: string[]): Promise<void> {
  const candidates = [...new Set(ids)]
  if (!candidates.length) return
  const referenced = await referencedUploadIds(env, candidates)
  const deletable = candidates.filter((id) => !referenced.has(id))
  if (!deletable.length) return
  const ph = deletable.map(() => '?').join(',')
  const rows = await all<{ id: string; r2_key: string; thumb_r2_key: string | null }>(
    env,
    `SELECT id, r2_key, thumb_r2_key FROM community_uploads WHERE id IN (${ph})`,
    ...deletable
  )
  await deleteUploadRows(env, rows)
}

/** 单轮清理的候选批大小（游标推进的步长） */
const CLEANUP_BATCH = 200
/** 单轮 cron 最多处理的候选行数：约束单次执行耗时（避免 cron 超时），游标保证下次接着推进 */
const CLEANUP_MAX_ROWS = 1000

/**
 * 惰性清理：删除 30 天前且**未被帖子 / 评论 / 私信 / 反馈引用**的孤图。由每周 cron 调用。
 *
 * 两处修复（issue #10 / #42）：
 * - 引用判定并入 `community_messages`（以及全部真实来源，见 `UPLOAD_REF_TABLES`），
 *   历史私信配图不再被误判为孤图；
 * - 按 `(created_at, id)` 升序取候选并**向后滚动游标**：被引用而未被删除的行同样推进游标，
 *   避免「前若干条都被引用 → 每周取到同一批 → 真正靠后的孤图永远轮不到」的清理饥饿。
 */
export async function cleanupOrphanUploads(env: Env): Promise<void> {
  const cutoff = nowSec() - 30 * 86400
  let cursorCreatedAt = -1
  let cursorId = ''
  for (let processed = 0; processed < CLEANUP_MAX_ROWS;) {
    const rows = await all<{ id: string; r2_key: string; thumb_r2_key: string | null; created_at: number }>(
      env,
      `SELECT id, r2_key, thumb_r2_key, created_at FROM community_uploads
       WHERE created_at < ? AND (created_at > ? OR (created_at = ? AND id > ?))
       ORDER BY created_at ASC, id ASC LIMIT ?`,
      cutoff,
      cursorCreatedAt,
      cursorCreatedAt,
      cursorId,
      CLEANUP_BATCH
    )
    if (!rows.length) break
    const last = rows[rows.length - 1]
    cursorCreatedAt = last.created_at
    cursorId = last.id
    processed += rows.length
    const referenced = await referencedUploadIds(
      env,
      rows.map((r) => r.id)
    )
    await deleteUploadRows(
      env,
      rows.filter((r) => !referenced.has(r.id))
    )
    if (rows.length < CLEANUP_BATCH) break
  }
}

// ---------- 路由 ----------

export function registerUploadRoutes() {
  // 上传图片（裸二进制；?filename= 可选，仅用于记录原始文件名）
  on('POST', '/api/community/upload', true, async (ctx) => {
    await rateLimit(ctx, 'community:upload', 20)
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
