import { on } from '../router'
import { all, batch, first, HttpError, readBodyBytes } from '../db'
import { withUserTransaction, withUserSnapshot } from '../syncTransaction'

/**
 * PDF 原文 D1 分片存储：
 * - PDF 二进制拆分为 ~95KB 分片存入 pdf_chunks 表
 * - PDF 直接以 note.id 作为 pdf_id，阅读时按该 id 反查分片拼装
 * - key 按 (user_id, pdf_id) 隔离，删除笔记时由同步接口清理孤儿分片
 * - 读取结果按 (user_id, pdf_id, 提交版本) 缓存于 Cache API（TTL 1 小时）；
 *   新版本让所有地区的旧缓存不可达，避免依赖仅限本地的 cache.delete
 */

/** 单文件上限 30MB，与前端 src/api/pdfs.ts 的 PDF_MAX_BYTES 保持一致 */
export const PDF_MAX_BYTES = 30 * 1024 * 1024
const PDF_MAX_MB = PDF_MAX_BYTES / 1024 / 1024
/** 单分片上限 95KB，留余量在 D1 行上限内 */
const CHUNK_SIZE = 95 * 1024

/** 拼装结果的读缓存 TTL（秒）：与响应头 Cache-Control 的 max-age 一致 */
const PDF_CACHE_TTL = 3600

/**
 * 读缓存 key：Cache API 的 key 即 URL（查询串参与 key），这里用内部伪域名承载条目，
 * 与真实路由 URL 的缓存 key 空间隔离，避免与 middleware/cache.ts 的条目相互污染。
 * PDF 字节是用户私有数据，必须按用户隔离：本 handler 在认证之后执行，直接用已校验的 ctx.userId 作标识，
 * 不使用会话 token 代替认证；入口仅缓存公开图片，本缓存始终位于鉴权后。
 */
function pdfCacheKey(userId: string, pdfId: string, revision = 0): string {
  return `https://pdf-cache.internal/${userId}/${pdfId}/${revision}`
}

/** 浏览器不保留私有字节；鉴权后的内部 Cache API 副本单独设置 TTL。 */
function pdfBytesResponse(body: BodyInit, totalLen: number): Response {
  return new Response(body, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Length': String(totalLen),
      'Cache-Control': 'private, no-store'
    }
  })
}

/** 清除初始版本的本地条目；跨地区失效由数据库提交版本保证，旧版本条目按 TTL 自行过期。 */
export async function purgePdfCache(userId: string, pdfId: string): Promise<void> {
  await caches.default.delete(pdfCacheKey(userId, pdfId))
}

/** id 为前端 uid（时间戳 base36 + 随机串），仅字母数字，天然防路径穿越 */
const ID_RE = /^[a-z0-9]+$/

function validId(id: string): string {
  if (!ID_RE.test(id)) throw new HttpError(400, '文件 ID 非法')
  return id
}

export function registerPdfRoutes() {
  on('PUT', '/api/pdfs/:id', true, async (ctx) => {
    const pdfId = validId(ctx.params.id)
    const startedAt = Date.now()
    const buf = await readBodyBytes(ctx.request, PDF_MAX_BYTES, `文件超过 ${PDF_MAX_MB}MB 上限`)
    if (buf.byteLength === 0) throw new HttpError(400, '文件为空')
    // 魔数校验 %PDF-，拒绝伪装成 PDF 的其它文件
    const head = buf.subarray(0, 5)
    if (String.fromCharCode(...head) !== '%PDF-') throw new HttpError(400, '文件不是有效的 PDF')

    const chunkCount = Math.ceil(buf.byteLength / CHUNK_SIZE)

    // 分片写入临时 pdf_id，全部成功后原子改名为正式 id——
    // 避免多批 INSERT 中途失败产生不完整文件
    const tmpId = `__tmp_${pdfId}_${crypto.randomUUID()}`
    const BATCH_MAX = 50
    try {
      for (let group = 0; group < Math.ceil(chunkCount / BATCH_MAX); group++) {
        const stmts: D1PreparedStatement[] = []
        const start = group * BATCH_MAX
        const end = Math.min(start + BATCH_MAX, chunkCount)
        for (let i = start; i < end; i++) {
          const chunk = buf.slice(i * CHUNK_SIZE, Math.min((i + 1) * CHUNK_SIZE, buf.byteLength))
          stmts.push(
            ctx.env.DB.prepare('INSERT INTO pdf_chunks (user_id, pdf_id, chunk_index, data) VALUES (?, ?, ?, ?)').bind(
              ctx.userId,
              tmpId,
              i,
              chunk
            )
          )
        }
        await batch(ctx.env, stmts)
      }
      // 全部写入成功：删旧正式分片 + 临时分片原子改名
      await withUserTransaction(ctx.env, ctx.userId, async () => {
        const deletion = await first<{ deleted_at: number }>(
          ctx.env,
          "SELECT deleted_at FROM sync_deletions WHERE user_id = ? AND domain = 'notes' AND record_key = ?",
          ctx.userId,
          pdfId
        )
        if (deletion && deletion.deleted_at >= startedAt) throw new HttpError(409, '笔记已在另一设备删除，请重新同步')
        return {
          statements: [
            ctx.env.DB.prepare('DELETE FROM pdf_chunks WHERE user_id = ? AND pdf_id = ?').bind(ctx.userId, pdfId),
            ctx.env.DB.prepare('UPDATE pdf_chunks SET pdf_id = ? WHERE user_id = ? AND pdf_id = ?').bind(
              pdfId,
              ctx.userId,
              tmpId
            )
          ],
          value: undefined
        }
      })
    } catch (e) {
      // 补偿同样推进版本：若失败的是在途 finalize，它不能在临时分片被清掉后再删旧正文。
      await withUserTransaction(ctx.env, ctx.userId, async () => ({
        statements: [
          ctx.env.DB.prepare('DELETE FROM pdf_chunks WHERE user_id = ? AND pdf_id = ?').bind(ctx.userId, tmpId)
        ],
        value: undefined
      })).catch((cleanupError) => console.error('PDF 临时分片清理失败', cleanupError))
      throw e
    }

    // 新提交版本已使旧缓存不可达，顺便清除本地区的初始版本缓存。
    await purgePdfCache(ctx.userId, pdfId)

    return Response.json({ ok: true, size: buf.byteLength })
  })

  on('GET', '/api/pdfs/:id', true, async (ctx) => {
    const pdfId = validId(ctx.params.id)
    return withUserSnapshot(ctx.env, ctx.userId, async () => {
      // Cache API invalidation is local to one PoP. The database revision makes old
      // bytes unreachable in every PoP after a replacement or a note deletion.
      const revision = await first<{ version: number }>(
        ctx.env,
        "SELECT version FROM sync_domain_versions WHERE user_id = ? AND domain = '__push__'",
        ctx.userId
      )
      const cache = caches.default
      const cacheKey = pdfCacheKey(ctx.userId, pdfId, revision?.version ?? 0)
      const cached = await cache.match(cacheKey)
      if (cached) {
        // 命中：字节直接取自 Cache API，不再读 D1、不再拼装；长度按实际字节数给出，不依赖缓存回放的响应头
        const hit = new Uint8Array(await cached.arrayBuffer())
        return pdfBytesResponse(hit, hit.byteLength)
      }

      const rows = await all(
        ctx.env,
        'SELECT data FROM pdf_chunks WHERE user_id = ? AND pdf_id = ? ORDER BY chunk_index',
        ctx.userId,
        pdfId
      )
      if (!rows.length) throw new HttpError(404, '文件不存在或已被删除')

      // 拼装分片
      const chunks = rows.map((r: any) => new Uint8Array(r.data))
      const totalLen = chunks.reduce((s, c) => s + c.byteLength, 0)
      const buf = new Uint8Array(totalLen)
      let offset = 0
      for (const c of chunks) {
        buf.set(c, offset)
        offset += c.byteLength
      }

      const res = pdfBytesResponse(buf, totalLen)
      // 缓存副本必须去掉 private：Cloudflare Cache API 对「指示不缓存」的响应直接以 413 拒绝写入
      // （官方文档 cache.put errors 一节），副本只在 Cache API 内部流转、不经此路径出网给浏览器，
      // 客户端拿到的仍是 private, no-store；写失败只降级为不缓存，不影响本次读取。
      const store = res.clone()
      store.headers.set('Cache-Control', `max-age=${PDF_CACHE_TTL}`)
      await cache.put(cacheKey, store).catch((e) => console.error('写入 PDF 读缓存失败', e))
      return res
    })
  })

  on('DELETE', '/api/pdfs/:id', true, async (ctx) => {
    const pdfId = validId(ctx.params.id)
    await withUserTransaction(ctx.env, ctx.userId, async () => ({
      statements: [
        ctx.env.DB.prepare('DELETE FROM pdf_chunks WHERE user_id = ? AND pdf_id = ?').bind(ctx.userId, pdfId)
      ],
      value: undefined
    }))
    // 新提交版本在所有地区阻止旧字节被返回，本地条目可提早回收。
    await purgePdfCache(ctx.userId, pdfId)
    return Response.json({ ok: true })
  })
}
