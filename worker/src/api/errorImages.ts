import { on } from '../router'
import { first, run, HttpError } from '../db'
import { rateLimit } from '../middleware/rateLimit'
import { IMAGE_MAX_BYTES, sniff, stripMetadata } from '../image'

/**
 * 错题图片对象存储（R2）：
 * - error_questions.image 仅存 'r2:<id>' 引用；id 由服务端对「剥离元数据后的落盘字节」计算 sha256，
 *   因此不变式 sha256(存储对象) === id 严格成立
 * - 内容寻址使上传天然幂等：相同内容 → 相同 id → 覆盖同一 R2 key，不产生重复对象
 * - 读取走认证通道（私有数据）：<img> 无法携带认证头，前端经 authFetch 拉字节转 blob URL
 * - key 按用户隔离：errors/<userId>/<sha256>.<ext>，读取按 (user_id, id) 查归属行
 * - 不提供删除端点：同一对象可能被多条错题引用，删除错题时由同步接口按引用计数清理
 *   （见 api/sync.ts 的「删除驱动的孤儿清理」：仍有其它错题引用时保留归属行与对象）
 */

/** 内容寻址 id：64 位小写十六进制（sha256），天然防路径穿越 */
const ID_RE = /^[a-f0-9]{64}$/

/** sha256 → 64 位小写十六进制 */
async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export function registerErrorImageRoutes() {
  on('POST', '/api/error-images', true, async (ctx) => {
    await rateLimit(ctx, 'error-images:upload', 20)

    // Content-Length 预检，避免超限文件读入内存后才拒绝
    const declared = Number(ctx.request.headers.get('Content-Length') || 0)
    if (declared > IMAGE_MAX_BYTES) throw new HttpError(413, '图片超过 5MB 上限')
    const buf = new Uint8Array(await ctx.request.arrayBuffer())
    if (!buf.byteLength) throw new HttpError(400, '文件为空')
    if (buf.byteLength > IMAGE_MAX_BYTES) throw new HttpError(413, '图片超过 5MB 上限')

    const kind = sniff(buf)
    if (!kind) throw new HttpError(400, '仅支持 PNG / JPEG / WebP / GIF 图片')
    const data = stripMetadata(buf, kind)
    if (!data) throw new HttpError(400, '图片文件损坏，无法处理')

    // 对落盘字节求 id：保证 sha256(存储对象) === id；相同内容重复上传必得同一 id
    const id = await sha256Hex(data)
    const key = `errors/${ctx.userId}/${id}.${kind.ext}`
    const prev = await first<{ r2_key: string }>(
      ctx.env,
      'SELECT r2_key FROM error_images WHERE user_id = ? AND id = ?',
      ctx.userId,
      id
    )
    await ctx.env.IMAGES.put(key, data, { httpMetadata: { contentType: kind.mime } })
    // 同一 id 的旧对象 key 不同（格式发生变化）时清理，避免残留
    if (prev && prev.r2_key !== key) {
      await ctx.env.IMAGES.delete(prev.r2_key).catch((e) => console.error('R2 删除失败', prev.r2_key, e))
    }
    await run(
      ctx.env,
      `INSERT INTO error_images (id, user_id, r2_key, size, content_type, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, id) DO UPDATE SET r2_key = excluded.r2_key, size = excluded.size, content_type = excluded.content_type`,
      id,
      ctx.userId,
      key,
      data.byteLength,
      kind.mime,
      Date.now()
    )
    // 创建语义统一 201（与 /api/community/upload 一致）；重复上传同内容为幂等覆盖，同样按创建响应
    return Response.json({ id, size: data.byteLength, contentType: kind.mime }, { status: 201 })
  })

  on('GET', '/api/error-images/:id', true, async (ctx) => {
    const id = ctx.params.id
    if (!ID_RE.test(id)) throw new HttpError(400, '图片 ID 非法')
    const row = await first<{ r2_key: string; content_type: string }>(
      ctx.env,
      'SELECT r2_key, content_type FROM error_images WHERE user_id = ? AND id = ?',
      ctx.userId,
      id
    )
    if (!row) throw new HttpError(404, '图片不存在')
    const obj = await ctx.env.IMAGES.get(row.r2_key)
    if (!obj) throw new HttpError(404, '图片不存在')
    return new Response(obj.body, {
      headers: {
        'Content-Type': row.content_type,
        // 内容寻址：同一 id 的内容恒定不可变，可长缓存
        'Cache-Control': 'private, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff'
      }
    })
  })
}
