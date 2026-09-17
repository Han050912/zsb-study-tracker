import { on, body } from '../router'
import { all, batch, first, run, HttpError } from '../db'
import { rateLimit } from '../middleware/rateLimit'
import type { Env } from '../index'

/**
 * Markdown 正文独立通道：正文不进入 notes 元数据同步；按 UTF-8 字节分片存 D1。
 * `NOTE_BODY_MAX_BYTES` 是单篇正文上限（字节）的**服务端唯一定义**：前端经
 * GET /api/note-bodies/limit 读取同一权威值做输入/保存校验，不得在别处再写一份。
 */
export const NOTE_BODY_MAX_BYTES = 1024 * 1024
const CHUNK_SIZE = 95 * 1024
const MAX_PULL_IDS = 50
const CLOCK_SKEW_MS = 5 * 60_000
const NOTE_ID_RE = /^[A-Za-z0-9_-]{1,128}$/

function validNoteId(id: string): string {
  if (!NOTE_ID_RE.test(id)) throw new HttpError(400, '笔记 ID 非法')
  return id
}

function positiveTimestamp(raw: string | null): number {
  const value = Number(raw)
  if (!Number.isInteger(value) || value <= 0) throw new HttpError(400, 'X-Updated-At 必须为毫秒正整数')
  return value
}

function placeholders(items: unknown[]): string {
  return items.map(() => '?').join(',')
}

function joinChunks(rows: { data: ArrayBuffer | ArrayBufferView }[]): string {
  const chunks = rows.map((row) => {
    const value = row.data
    return ArrayBuffer.isView(value)
      ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
      : new Uint8Array(value)
  })
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
  const merged = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(merged)
}

export async function readNoteBody(
  env: Env,
  userId: string,
  noteId: string
): Promise<{ content: string; updatedAt: number } | null> {
  const rows = await all<{ data: ArrayBuffer; updated_at: number }>(
    env,
    'SELECT data, updated_at FROM note_body_chunks WHERE user_id = ? AND note_id = ? ORDER BY chunk_index',
    userId,
    noteId
  )
  if (!rows.length) return null
  return { content: joinChunks(rows), updatedAt: Math.max(...rows.map((row) => Number(row.updated_at))) }
}

export function registerNoteBodyRoutes() {
  // 公开读取上限：前端据此在上传前拦下超限正文并给出提示，避免前后端各写一份上限值
  on('GET', '/api/note-bodies/limit', false, () => Response.json({ maxBytes: NOTE_BODY_MAX_BYTES }))

  on('PUT', '/api/note-bodies/:id', true, async (ctx) => {
    await rateLimit(ctx, 'note-body:write', 60)
    const noteId = validNoteId(ctx.params.id)
    const declared = Number(ctx.request.headers.get('Content-Length') || 0)
    if (declared > NOTE_BODY_MAX_BYTES) throw new HttpError(413, '笔记正文超过 1MB 上限')

    const bytes = new Uint8Array(await ctx.request.arrayBuffer())
    if (bytes.byteLength > NOTE_BODY_MAX_BYTES) throw new HttpError(413, '笔记正文超过 1MB 上限')
    try {
      new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes)
    } catch {
      throw new HttpError(400, '笔记正文不是合法 UTF-8 文本')
    }

    const requestedAt = positiveTimestamp(ctx.request.headers.get('X-Updated-At'))
    const now = Date.now()
    const clamped = requestedAt > now + CLOCK_SKEW_MS
    const updatedAt = clamped ? now : requestedAt
    const stored = await first<{ updated_at: number }>(
      ctx.env,
      'SELECT MAX(updated_at) AS updated_at FROM note_body_chunks WHERE user_id = ? AND note_id = ?',
      ctx.userId,
      noteId
    )
    const storedAt = Number(stored?.updated_at ?? 0)
    if (storedAt >= updatedAt) return Response.json({ applied: false, updatedAt: storedAt, clamped })

    // 每次写入使用独立临时键；冒号不在公开 note id 字符集中，不会与真实笔记冲突。
    const tmpId = `tmp:${crypto.randomUUID()}`
    const createdAt = Math.floor(now / 1000)
    try {
      const writes: D1PreparedStatement[] = []
      const count = Math.max(1, Math.ceil(bytes.byteLength / CHUNK_SIZE))
      for (let i = 0; i < count; i++) {
        const chunk = bytes.slice(i * CHUNK_SIZE, Math.min((i + 1) * CHUNK_SIZE, bytes.byteLength))
        writes.push(
          ctx.env.DB.prepare(
            'INSERT INTO note_body_chunks (user_id, note_id, chunk_index, data, updated_at, created_at) VALUES (?, ?, ?, ?, ?, ?)'
          ).bind(ctx.userId, tmpId, i, chunk, updatedAt, createdAt)
        )
      }
      await batch(ctx.env, writes)
      // 删除旧版本与晋升临时分片位于同一 D1 batch。若并发请求已写入相同或更新版本，
      // 第一条不会删除它，第二条也因目标仍存在而不会晋升旧临时分片。
      await batch(ctx.env, [
        ctx.env.DB.prepare('DELETE FROM note_body_chunks WHERE user_id = ? AND note_id = ? AND updated_at < ?').bind(
          ctx.userId,
          noteId,
          updatedAt
        ),
        ctx.env.DB.prepare(
          `UPDATE note_body_chunks SET note_id = ?
           WHERE user_id = ? AND note_id = ?
             AND NOT EXISTS (
               SELECT 1 FROM note_body_chunks WHERE user_id = ? AND note_id = ?
             )`
        ).bind(noteId, ctx.userId, tmpId, ctx.userId, noteId),
        // 并发竞争失败的临时分片也在同一原子 batch 内清掉；晋升成功时此语句自然删除 0 行。
        ctx.env.DB.prepare('DELETE FROM note_body_chunks WHERE user_id = ? AND note_id = ?').bind(ctx.userId, tmpId)
      ])
      const final = await first<{ updated_at: number }>(
        ctx.env,
        'SELECT MAX(updated_at) AS updated_at FROM note_body_chunks WHERE user_id = ? AND note_id = ?',
        ctx.userId,
        noteId
      )
      const finalAt = Number(final?.updated_at ?? 0)
      return Response.json({ applied: finalAt === updatedAt, updatedAt: finalAt, clamped })
    } catch (error) {
      await run(ctx.env, 'DELETE FROM note_body_chunks WHERE user_id = ? AND note_id = ?', ctx.userId, tmpId).catch(
        () => {}
      )
      throw error
    }
  })

  on('POST', '/api/note-bodies/pull', true, async (ctx) => {
    await rateLimit(ctx, 'note-body:pull', 120)
    const payload = await body<{ ids?: unknown }>(ctx.request)
    if (!Array.isArray(payload?.ids)) throw new HttpError(400, 'ids 必须为数组')
    if (payload.ids.length > MAX_PULL_IDS) throw new HttpError(413, `每次最多拉取 ${MAX_PULL_IDS} 篇正文`)
    const ids = [...new Set(payload.ids.map((id) => validNoteId(String(id))))]
    if (!ids.length) return Response.json({ bodies: [] })

    const rows = await all<{ note_id: string; chunk_index: number; data: ArrayBuffer; updated_at: number }>(
      ctx.env,
      `SELECT c.note_id, c.chunk_index, c.data, c.updated_at
       FROM note_body_chunks c
       INNER JOIN notes n ON n.user_id = c.user_id AND n.id = c.note_id AND n.type IS NULL
       WHERE c.user_id = ? AND c.note_id IN (${placeholders(ids)})
       ORDER BY c.note_id, c.chunk_index`,
      ctx.userId,
      ...ids
    )
    const grouped = new Map<string, typeof rows>()
    for (const row of rows) {
      const list = grouped.get(row.note_id) ?? []
      list.push(row)
      grouped.set(row.note_id, list)
    }
    const bodies = ids.flatMap((id) => {
      const chunks = grouped.get(id)
      if (!chunks?.length) return []
      return [{ id, content: joinChunks(chunks), updatedAt: Math.max(...chunks.map((row) => Number(row.updated_at))) }]
    })
    return Response.json({ bodies })
  })
}
