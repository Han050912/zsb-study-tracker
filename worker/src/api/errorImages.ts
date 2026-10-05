import { on } from '../router'
import { first, HttpError, readBodyBytes } from '../db'
import { withUserTransaction } from '../syncTransaction'
import { rateLimit } from '../middleware/rateLimit'
import { IMAGE_MAX_BYTES, sniff, stripMetadata } from '../image'

/**
 * 错题图片对象存储（R2）：
 * - error_questions.image 仅存 'r2:<id>' 引用；id 由服务端对「剥离元数据后的落盘字节」计算 sha256，
 *   因此不变式 sha256(存储对象) === id 严格成立
 * - 内容寻址使公开 id 稳定；R2 使用不可复用的 generation，替换旧对象时事务内排队回收
 * - 读取走认证通道（私有数据）：<img> 无法携带认证头，前端经 authFetch 拉字节转 blob URL
 * - key 按用户隔离：errors/<userId>/<sha256>/<generation>.<ext>，读取按 (user_id, id) 查归属行
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

    const buf = await readBodyBytes(ctx.request, IMAGE_MAX_BYTES, '图片超过 5MB 上限')
    if (!buf.byteLength) throw new HttpError(400, '文件为空')

    const kind = sniff(buf)
    if (!kind) throw new HttpError(400, '仅支持 PNG / JPEG / WebP / GIF 图片')
    const data = stripMetadata(buf, kind)
    if (!data) throw new HttpError(400, '图片文件损坏，无法处理')

    // 对落盘字节求 id：保证 sha256(存储对象) === id；相同内容重复上传必得同一 id
    const id = await sha256Hex(data)
    // The public content id is stable; an immutable storage generation prevents an
    // in-flight cleanup of an earlier upload from deleting this new object.
    const key = `errors/${ctx.userId}/${id}/${crypto.randomUUID()}.${kind.ext}`
    await ctx.env.IMAGES.put(key, data, { httpMetadata: { contentType: kind.mime } })
    try {
      await withUserTransaction(ctx.env, ctx.userId, async () => ({
        statements: [
          ctx.env.DB.prepare(
            `INSERT OR IGNORE INTO r2_cleanup_jobs (r2_key, created_at)
            SELECT r2_key, ? FROM error_images WHERE user_id = ? AND id = ?`
          ).bind(Date.now(), ctx.userId, id),
          ctx.env.DB.prepare(
            `INSERT INTO error_images (id, user_id, r2_key, size, content_type, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, id) DO UPDATE SET r2_key = excluded.r2_key, size = excluded.size, content_type = excluded.content_type`
          ).bind(id, ctx.userId, key, data.byteLength, kind.mime, Date.now())
        ],
        value: undefined
      }))
    } catch (error) {
      // D1 可能已经提交，只是响应丢失，不能直接删除刚上传的对象。
      // 补偿也走同一版本守卫：已提交的引用保留；真正回滚的 generation 持久化回收。
      // 若原 batch 仍在途，该守卫会使它的旧版本决策无法在补偿之后再提交。
      await withUserTransaction(ctx.env, ctx.userId, async () => ({
        statements: [
          ctx.env.DB.prepare(
            `INSERT OR IGNORE INTO r2_cleanup_jobs (r2_key, created_at)
             SELECT ?, ? WHERE NOT EXISTS (SELECT 1 FROM error_images WHERE r2_key = ?)`
          ).bind(key, Date.now(), key)
        ],
        value: undefined
      })).catch((cleanupError) => console.error('R2 上传补偿任务登记失败', key, cleanupError))
      throw error
    }
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
