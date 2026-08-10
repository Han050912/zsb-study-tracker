import { on } from '../router'
import { run, all, batch, HttpError } from '../db'

/**
 * PDF 原文 D1 分片存储：
 * - PDF 二进制拆分为 ~95KB 分片存入 pdf_chunks 表
 * - notes.content 存 'd1:<id>' 引用，阅读时按引用反查分片拼装
 * - key 按 (user_id, pdf_id) 隔离，删除笔记时由同步接口清理孤儿分片
 */

/** 单文件上限 30MB，与前端 src/api/pdfs.ts 的 PDF_MAX_BYTES 保持一致 */
export const PDF_MAX_BYTES = 30 * 1024 * 1024
const PDF_MAX_MB = PDF_MAX_BYTES / 1024 / 1024
/** 单分片上限 95KB，留余量在 D1 行上限内 */
const CHUNK_SIZE = 95 * 1024

/** id 为前端 uid（时间戳 base36 + 随机串），仅字母数字，天然防路径穿越 */
const ID_RE = /^[a-z0-9]+$/

function validId(id: string): string {
  if (!ID_RE.test(id)) throw new HttpError(400, '文件 ID 非法')
  return id
}

export function registerPdfRoutes() {
  on('PUT', '/api/pdfs/:id', true, async (ctx) => {
    const pdfId = validId(ctx.params.id)
    // Content-Length 预检，避免超限文件读入内存后才拒绝
    const declared = Number(ctx.request.headers.get('Content-Length') || 0)
    if (declared > PDF_MAX_BYTES) throw new HttpError(413, `文件超过 ${PDF_MAX_MB}MB 上限`)
    const data = await ctx.request.arrayBuffer()
    if (data.byteLength === 0) throw new HttpError(400, '文件为空')
    if (data.byteLength > PDF_MAX_BYTES) throw new HttpError(413, `文件超过 ${PDF_MAX_MB}MB 上限`)
    // 魔数校验 %PDF-，拒绝伪装成 PDF 的其它文件
    const head = new Uint8Array(data, 0, 5)
    if (String.fromCharCode(...head) !== '%PDF-') throw new HttpError(400, '文件不是有效的 PDF')

    const buf = new Uint8Array(data)
    const chunkCount = Math.ceil(buf.byteLength / CHUNK_SIZE)

    // 分片写入临时 pdf_id，全部成功后原子改名为正式 id——
    // 避免多批 INSERT 中途失败产生不完整文件
    const tmpId = `__tmp_${pdfId}`
    const BATCH_MAX = 50
    // 预清理可能残留的同名临时分片（上次上传失败 catch 清理也未成功的极端情况）
    await run(ctx.env, 'DELETE FROM pdf_chunks WHERE user_id = ? AND pdf_id = ?', ctx.userId, tmpId)
    try {
      for (let group = 0; group < Math.ceil(chunkCount / BATCH_MAX); group++) {
        const stmts: D1PreparedStatement[] = []
        const start = group * BATCH_MAX
        const end = Math.min(start + BATCH_MAX, chunkCount)
        for (let i = start; i < end; i++) {
          const chunk = buf.slice(i * CHUNK_SIZE, Math.min((i + 1) * CHUNK_SIZE, buf.byteLength))
          stmts.push(
            ctx.env.DB.prepare(
              'INSERT INTO pdf_chunks (user_id, pdf_id, chunk_index, data) VALUES (?, ?, ?, ?)'
            ).bind(ctx.userId, tmpId, i, chunk)
          )
        }
        await batch(ctx.env, stmts)
      }
      // 全部写入成功：删旧正式分片 + 临时分片原子改名
      await batch(ctx.env, [
        ctx.env.DB.prepare('DELETE FROM pdf_chunks WHERE user_id = ? AND pdf_id = ?').bind(ctx.userId, pdfId),
        ctx.env.DB.prepare('UPDATE pdf_chunks SET pdf_id = ? WHERE user_id = ? AND pdf_id = ?').bind(pdfId, ctx.userId, tmpId)
      ])
    } catch (e) {
      // 清理半成品临时分片
      await run(ctx.env, 'DELETE FROM pdf_chunks WHERE user_id = ? AND pdf_id = ?', ctx.userId, tmpId).catch(() => {})
      throw e
    }

    return Response.json({ ok: true, size: buf.byteLength })
  })

  on('GET', '/api/pdfs/:id', true, async (ctx) => {
    const pdfId = validId(ctx.params.id)
    const rows = await all(ctx.env,
      'SELECT data FROM pdf_chunks WHERE user_id = ? AND pdf_id = ? ORDER BY chunk_index',
      ctx.userId, pdfId
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

    return new Response(buf, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Length': String(totalLen),
        'Cache-Control': 'private, max-age=3600'
      }
    })
  })

  on('DELETE', '/api/pdfs/:id', true, async (ctx) => {
    const pdfId = validId(ctx.params.id)
    await run(ctx.env, 'DELETE FROM pdf_chunks WHERE user_id = ? AND pdf_id = ?', ctx.userId, pdfId)
    return Response.json({ ok: true })
  })
}
