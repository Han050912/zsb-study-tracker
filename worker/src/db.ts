import type { Env } from './index'
import type { Ctx } from './router'

/** 业务错误：message 会原样返回给前端 */
export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message)
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

/** 解析 JSON 请求体；非法 JSON 抛出 400（与 router.ts 的 body() 行为一致） */
async function parseBody(request: Request): Promise<any> {
  try {
    return await request.json()
  } catch {
    throw new HttpError(400, '请求体不是合法 JSON')
  }
}

// ---------- D1 参数化查询封装（禁止字符串拼接 SQL） ----------

export async function all<T = any>(env: Env, sql: string, ...params: unknown[]): Promise<T[]> {
  const res = await env.DB.prepare(sql).bind(...params).all<T>()
  return res.results ?? []
}

export async function first<T = any>(env: Env, sql: string, ...params: unknown[]): Promise<T | null> {
  return env.DB.prepare(sql).bind(...params).first<T>()
}

export async function run(env: Env, sql: string, ...params: unknown[]) {
  return env.DB.prepare(sql).bind(...params).run()
}

// ---------- 通用单表 CRUD handler 工厂 ----------

export interface CrudMapping<Body = any> {
  /** 表名（必须带 user_id 列） */
  table: string
  /** 前端 camelCase 对象 → 数据库行（snake_case，含 id/user_id，值已完成 JSON.stringify 等编码） */
  toRow: (userId: string, body: Body, id: string) => Record<string, unknown>
  /** 数据库行 → 前端 camelCase 对象 */
  fromRow: (row: any) => any
}

/** 列名加双引号，兼容 "order" 等保留字列 */
function quoteCol(name: string): string {
  return `"${name}"`
}

function insertStatement(table: string, row: Record<string, unknown>) {
  const keys = Object.keys(row).filter(k => row[k] !== undefined)
  const sql = `INSERT INTO ${table} (${keys.map(quoteCol).join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`
  return { sql, params: keys.map(k => row[k]) }
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
      const rows = await all(ctx.env, `SELECT * FROM ${m.table} WHERE user_id = ?`, ctx.userId)
      return Response.json(rows.map(m.fromRow))
    },

    async create(ctx: Ctx): Promise<Response> {
      const b = await parseBody(ctx.request) as Body & { id?: string }
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
      const b = await parseBody(ctx.request) as Body
      const row = m.toRow(ctx.userId, b, id)
      delete row.id
      delete row.user_id
      // 过滤 undefined：D1 bind 不接受 undefined（抛 TypeError → 500），Partial 更新时缺失字段跳过即可
      const setKeys = Object.keys(row).filter(k => row[k] !== undefined)
      if (setKeys.length) {
        const sql = `UPDATE ${m.table} SET ${setKeys.map(k => `${quoteCol(k)} = ?`).join(', ')} WHERE id = ? AND user_id = ?`
        await run(ctx.env, sql, ...setKeys.map(k => row[k]), id, ctx.userId)
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
 */
export async function batch(env: Env, statements: D1PreparedStatement[]) {
  if (statements.length) await env.DB.batch(statements)
}
