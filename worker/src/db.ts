import { z } from 'zod'
import type { Env } from './index'
import type { Ctx } from './router'

// zod 全局中文报错：crud create/update 与记录级同步校验失败的 400 文案直接回给前端
z.config(z.locales.zhCN())

/** 业务错误：message 会原样返回给前端 */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message)
  }
}

/**
 * 识别 SQLite 约束类错误（UNIQUE / FOREIGN KEY / CHECK / NOT NULL，P4-06）。
 * D1 未暴露结构化错误码，只能按错误消息识别（形如 `UNIQUE constraint failed: ...: SQLITE_CONSTRAINT`）。
 * 这类错误源于客户端输入违反数据完整性约束，由全局 catch 统一映射为 400，
 * 避免客户端把输入错误当服务端故障（500）无限重试。
 */
export function isConstraintError(e: unknown): boolean {
  const message = e instanceof Error ? e.message : String(e)
  return message.includes('SQLITE_CONSTRAINT') || message.includes('constraint failed')
}

/**
 * JSON 请求体默认字节上限（issue #52）。
 * 未显式指定上限的端点（社区 / 搭子 / 团队 / 管理 / 设置 / 数据拉取 …）统一按此预检，
 * 杜绝「先把最大 100MB 的请求体读进 isolate、读完再校验」；这些端点的真实载荷都是 KB 级 JSON 文本。
 * 需要更大上限的端点在调用处显式传入（如 /api/data/push 的 10MB）。
 */
export const JSON_BODY_MAX_BYTES = 256 * 1024

/**
 * JSON 与文件上传共用的有界读取：无 Content-Length 或分块传输时也在越界的第一块停止。
 * 按需扩容而非保留全部小块，避免大量微小分块产生无界的数组/对象开销。
 */
export async function readBodyBytes(
  request: Request,
  maxBytes: number,
  limitMessage = '请求体超过大小上限'
): Promise<Uint8Array<ArrayBuffer>> {
  const declared = Number(request.headers.get('Content-Length') || 0)
  if (declared > maxBytes) {
    await request.body?.cancel().catch(() => {})
    throw new HttpError(413, limitMessage)
  }
  if (!request.body) return new Uint8Array(0)
  const reader = request.body.getReader()
  let buffer = new Uint8Array(Math.min(64 * 1024, maxBytes))
  let length = 0
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      if (value.byteLength > maxBytes - length) {
        await reader.cancel().catch(() => {})
        throw new HttpError(413, limitMessage)
      }
      const end = length + value.byteLength
      if (end > buffer.byteLength) {
        const next = new Uint8Array(Math.min(maxBytes, Math.max(end, buffer.byteLength * 2)))
        next.set(buffer.subarray(0, length))
        buffer = next
      }
      buffer.set(value, length)
      length = end
    }
    return buffer.subarray(0, length)
  } catch (error) {
    if (error instanceof HttpError) throw error
    throw new HttpError(400, '请求体读取失败')
  } finally {
    reader.releaseLock()
  }
}

/** 先完成有界字节读取再解码，UTF-8 跨分块字符与 BOM 均由同一解码器处理。 */
export async function readBodyText(request: Request, maxBytes: number = JSON_BODY_MAX_BYTES): Promise<string> {
  return new TextDecoder().decode(await readBodyBytes(request, maxBytes))
}

/** 解析 JSON 请求体：超限 413、非法 JSON 400（router.body / schemas.parseBody / CRUD 共用同一实现） */
export async function parseJsonBody<T = any>(request: Request, maxBytes: number = JSON_BODY_MAX_BYTES): Promise<T> {
  const text = await readBodyText(request, maxBytes)
  try {
    return JSON.parse(text) as T
  } catch {
    throw new HttpError(400, '请求体不是合法 JSON')
  }
}

/** 生成主键 id */
export function uid(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 16)
}

/** 对外用户 ID 字符集：大写字母 + 数字，去掉易混淆的 0/O/1/I，共 32 字符 */
const USER_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/**
 * 生成对外用户 ID：8 位随机短码（32^8 ≈ 1.1 万亿空间，不可枚举）。
 * 256 % 32 === 0，故 bytes[i] % 32 均匀无偏差。
 */
export function randomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  let code = ''
  for (let i = 0; i < 8; i++) code += USER_CODE_ALPHABET[bytes[i] % 32]
  return code
}

/** 业务日期（YYYY-MM-DD）一律按 UTC+8：用户群固定为国内考生，避免 UTC 零点至早八点跨日错位 */
export function utc8Today(): string {
  return new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10)
}

// ---------- D1 参数化查询封装（禁止字符串拼接 SQL） ----------

export async function all<T = any>(env: Env, sql: string, ...params: unknown[]): Promise<T[]> {
  const res = await env.DB.prepare(sql)
    .bind(...params)
    .all<T>()
  return res.results ?? []
}

export async function first<T = any>(env: Env, sql: string, ...params: unknown[]): Promise<T | null> {
  return env.DB.prepare(sql)
    .bind(...params)
    .first<T>()
}

export async function run(env: Env, sql: string, ...params: unknown[]) {
  return env.DB.prepare(sql)
    .bind(...params)
    .run()
}

// ---------- 通用单表 CRUD handler 工厂 ----------

export interface CrudMapping<Body = any> {
  /** 表名（必须带 user_id 列） */
  table: string
  /** 前端 camelCase 对象 → 数据库行（snake_case，含 id/user_id，值已完成 JSON.stringify 等编码） */
  toRow: (userId: string, body: Body, id: string) => Record<string, unknown>
  /** 数据库行 → 前端 camelCase 对象 */
  fromRow: (row: any) => any
  /**
   * 该域记录的**唯一**字段定义（建议 z.object(...).passthrough() 宽松模式，仅约束 toRow 消费的字段）：
   * REST create/update 与记录级同步（api/sync.ts）都经 `assertMappingBody` 用它校验，失败抛 400
   * （首个 issue 的字段路径 + 中文文案）；缺席时行为不变。
   */
  schema?: z.ZodType
}

/**
 * 用 `mapping.schema` 校验请求体/记录：schema 缺席直接放行；失败取首个 issue 组 400 文案（字段路径 + 中文消息）。
 * REST（crudHandlers）与记录级同步（api/sync.ts）共用同一个字段定义与同一套报错口径（issue #39：
 * 记录级同步不得只判存在性，否则非法类型会被 SQLite 动态类型原样落库，或让 D1 bind 抛 TypeError 变 500）。
 */
export function assertMappingBody(m: CrudMapping<any>, b: unknown): void {
  if (!m.schema) return
  const result = m.schema.safeParse(b)
  if (!result.success) {
    const issue = result.error.issues[0]
    const path = issue.path.join('.')
    throw new HttpError(400, `参数无效：${path ? `${path} ` : ''}${issue.message}`)
  }
}

/** 列名加双引号，兼容 "order" 等保留字列 */
function quoteCol(name: string): string {
  return `"${name}"`
}

function insertStatement(table: string, row: Record<string, unknown>) {
  const keys = Object.keys(row).filter((k) => row[k] !== undefined)
  const sql = `INSERT INTO ${table} (${keys.map(quoteCol).join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`
  return { sql, params: keys.map((k) => row[k]) }
}

/**
 * 为标准「id 主键 + user_id 隔离」表生成 list/create/update/delete 四个 handler。
 * PUT 采用整行覆盖语义：toRow 返回的全部字段（除 id/user_id）都会被更新，
 * 前端提交完整对象，缺失字段即视为清空。
 */
export function crudHandlers<Body = any>(m: CrudMapping<Body>) {
  return {
    /** 原始映射，供全量同步（sync）复用同一套 snake↔camel 转换 */
    mapping: m,
    async list(ctx: Ctx): Promise<Response> {
      // 防御性上限（非分页能力）：与同步协议单域记录上限 MAX_ITEMS_PER_COLLECTION（sync.ts，10000）同口径。
      // 全量 hydration 走 /api/data/pull，这些 list 端点仅承载单用户小数据量，实践中永远不会触顶。
      const listLimit = 10000
      const rows = await all(ctx.env, `SELECT * FROM ${m.table} WHERE user_id = ? LIMIT ${listLimit}`, ctx.userId)
      // P5-03：行数达到上限时无法区分「恰好 1 万条」与「更多被截断」，一律按截断标记，
      // 经响应头告知客户端（正文保持裸数组不变，smoke 断言与既有调用方依赖数组形状）。
      const res = Response.json(rows.map(m.fromRow))
      res.headers.set('X-Truncated', rows.length >= listLimit ? 'true' : 'false')
      return res
    },

    async create(ctx: Ctx): Promise<Response> {
      const b = (await parseJsonBody(ctx.request)) as Body & { id?: string }
      assertMappingBody(m, b)
      const id = typeof b?.id === 'string' && b.id ? b.id : uid()
      const row = m.toRow(ctx.userId, b, id)
      const { sql, params } = insertStatement(m.table, row)
      await run(ctx.env, sql, ...params)
      const created = await first(ctx.env, `SELECT * FROM ${m.table} WHERE id = ? AND user_id = ?`, id, ctx.userId)
      return Response.json(m.fromRow(created), { status: 201 })
    },

    async update(ctx: Ctx): Promise<Response> {
      const id = ctx.params.id
      const exists = await first(ctx.env, `SELECT id FROM ${m.table} WHERE id = ? AND user_id = ?`, id, ctx.userId)
      if (!exists) throw new HttpError(404, '记录不存在')
      const b = (await parseJsonBody(ctx.request)) as Body
      assertMappingBody(m, b)
      const row = m.toRow(ctx.userId, b, id)
      delete row.id
      delete row.user_id
      // 过滤 undefined：D1 bind 不接受 undefined（抛 TypeError → 500），Partial 更新时缺失字段跳过即可
      const setKeys = Object.keys(row).filter((k) => row[k] !== undefined)
      if (setKeys.length) {
        const sql = `UPDATE ${m.table} SET ${setKeys.map((k) => `${quoteCol(k)} = ?`).join(', ')} WHERE id = ? AND user_id = ?`
        await run(ctx.env, sql, ...setKeys.map((k) => row[k]), id, ctx.userId)
      }
      const updated = await first(ctx.env, `SELECT * FROM ${m.table} WHERE id = ? AND user_id = ?`, id, ctx.userId)
      return Response.json(m.fromRow(updated))
    },

    async remove(ctx: Ctx): Promise<Response> {
      const id = ctx.params.id
      const res = await run(ctx.env, `DELETE FROM ${m.table} WHERE id = ? AND user_id = ?`, id, ctx.userId)
      if (!res.meta.changes) throw new HttpError(404, '记录不存在')
      return Response.json({ ok: true })
    }
  }
}

/**
 * 原子批量执行：D1 保证单个 batch 全成功或全失败。
 * 不分块——分块会破坏「先删后插」全量替换的原子性（中途失败即数据已删未插）。
 * 语句数超出 D1 上限时宁可以错误形式整体失败，也不产生半提交状态。
 * 返回各语句执行结果（空数组入参返回 undefined），供调用方读取 meta.changes 等；不需要时直接丢弃即可。
 */
export async function batch(env: Env, statements: D1PreparedStatement[]) {
  if (statements.length) return env.DB.batch(statements)
}
