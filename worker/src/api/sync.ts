import type { Env } from '../index'
import { on, body } from '../router'
import { all, batch, first, utc8Today, HttpError } from '../db'
import type { CrudMapping } from '../db'
import { getSubjectTree, subjectInsertStatements, subjectTreeDeleteStatements } from './subjects'
import { getHabits, habitUpsertStatements, habitDeleteStatements } from './habits'
import { awardBadge } from './badges'
import type { BadgeKey } from './badges'
import {
  achievementsMergeStatement,
  gamificationProjectionStatement,
  getAchievements,
  getGamification,
  pointsAwardStatements,
  pointsRevokeStatements
} from './gamification'
import type { PointsAward } from './gamification'
import { getSettings, settingsRecordStatements, validateSettingsPublicText } from './settings'
import {
  pomodoroDailyStatement,
  pomodoroInterruptionsStatements,
  pomodoroRecordFromRow,
  pomodoroRecordStatement
} from './pomodoro'
import { recordsMapping } from './records'
import { problemsMapping } from './problems'
import { errorsMapping } from './errors'
import { examsMapping } from './exams'
import { notesMapping } from './notes'
import { vocabMapping } from './vocab'
import { readingMapping, listeningMapping, templatesMapping } from './english'
import { materialsMapping } from './materials'
import { todosMapping } from './todos'
import { rateLimit } from '../middleware/rateLimit'

/**
 * 记录级增量同步协议（设计 §4）：
 * - POST /api/data/push：提交若干域的记录级变更（upserts/deletes），记录级 LWW + 删除墓碑，单 batch 原子
 * - POST /api/data/pull：full=true 或未带游标 → 全量快照；否则按游标返回增量（server_seq/seq > cursor）
 *
 * 覆盖除 `gamification` 外的全部 13 个域（键空间见设计 §3.3）：
 * - 单表数组域（键取记录自身 id）：records / problemSessions / errorQuestions / exams / notes / materials / todos
 * - 复杂域：subjects（科目聚合子树）/ habits（习惯 + 打卡 map）/ pomodoro（day:/itr:/rec:）
 *   / english（vocab:/reading:/listening:/template:）/ summaries（date）/ settings（self）
 * `gamification` 由服务端权威维护：客户端推送该域 → 400，仅作为快照随 push/pull 响应回传。
 *
 * 积分（设计 §5.1/§5.2，与记录写入**同一 batch**原子提交）：
 * - `points` 事件：`award` 按 `ref_id` 幂等落账、`revoke` 支持 `refId` 精确与 `refPrefix` 前缀撤销。
 * - 记录删除被接受（写墓碑）时，服务端**同时**撤销该记录关联的流水（records/problemSessions/exams →
 *   `<key>`；errorQuestions → `error:<key>`；habits → `habit:<key>:%`）。
 * - 权威派生量：今日 `study_records` 分钟 ≥60 → +3（`srv:study-minutes:<date>`）；streak 按学习日期集合
 *   计算并写回 `gamification.streak/last_checkin`；里程碑 7/30/100 天 → +5/+10/+20 且发放对应徽章
 *   （`srv:streak:<days>` 幂等，徽章并入主 batch）。batch 前预读 + 内存叠加，杜绝「积分已发/徽章未发」窗口。
 * - `gamification.points` 为流水投影 `SUM(points_log.points)`（不做加减法，重放/并发幂等）。
 * - 删除驱动的孤儿清理：notes 删 Markdown/PDF 分片、errorQuestions 删归属行 + R2 对象。
 *
 * 成就（设计 §5.1/§5.2，同一 batch 原子提交）：
 * - 推送可选字段 `achievements: string[]`（客户端 `checkAchievements()` 判定解锁的成就 id 列表，规则仍在客户端）；
 *   服务端与 `gamification.achievements` 做**只增不减的集合并集**（已有在前、新解锁按传入顺序追加、去重），
 *   幂等：重复推送同一批 id 不产生变化。校验：字符串数组、元素非空字符串、去重后 ≤ 200（非法 → 400 中文文案）。
 *
 * 响应形状（前端协议层依赖）：`changes[domain] = { seq, upserts, deletes }`，full 与增量同一形状——
 * 单表数组域的 upserts 元素为记录对象本身（含 updatedAt），复杂域为 `{ key, value, updatedAt }` 包装。
 * 拉取游标契约（设计 §4.2/§4.4）：客户端推进游标必须取本次 `changes[domain].seq`——即该域**实际返回**
 * 的记录/墓碑中最大的 server_seq/seq；域未出现则不推进。**不得**取 `versions[domain]` 当游标：
 * `allocateSeq` 独立提交会先于业务行可见，「版本号已可见、业务行尚未提交」的窗口里 versions 高于实际
 * 可读序号，取 versions 会把游标推高到空洞号而**永久漏掉**那批尚未提交的行。
 * `versions` 仅作信息性展示（诊断），不是游标；增量查询仍以 `server_seq <= versions 快照` 为上界与之配合。
 */

export const SYNC_MAX_BYTES = 10 * 1024 * 1024

/** 单域记录条数上限（沿用旧整域替换协议的阈值，超限 413） */
const MAX_ITEMS_PER_COLLECTION = 10_000

/** 单个记录的长度上限 1MB（沿用旧协议阈值，超限 413） */
const MAX_FIELD_CHARS = 1_000_000

/** 成就 id 列表上限（只增不减的并集结果同样以此为界；实际成就目录远小于该值，纯输入护栏） */
const MAX_ACHIEVEMENTS = 200

/**
 * 时钟钳制阈值：客户端 updatedAt/deletedAt 超前服务端超过 5 分钟即改用服务端时间（设计 §9）。
 * 否则时钟严重偏快的客户端会给自己的写入「永久占位」，其它设备的后续编辑全部判负而永远不生效。
 */
const CLOCK_SKEW_MS = 5 * 60_000

/** 秒级时间戳（sync_domain_versions.updated_at 存秒，与社区各表同一口径） */
const nowSec = () => Math.floor(Date.now() / 1000)

/** D1 单条查询的绑定参数上限约百个 → IN 列表按 50 分片（与项目既有做法一致） */
const IN_CHUNK = 50

/** 单表数组域（键为前端 state 字段名）→ 映射 */
const ARRAY_DOMAIN_MAPPINGS: Record<string, CrudMapping> = {
  records: recordsMapping.mapping,
  problemSessions: problemsMapping.mapping,
  errorQuestions: errorsMapping.mapping,
  exams: examsMapping.mapping,
  notes: notesMapping.mapping,
  materials: materialsMapping.mapping,
  todos: todosMapping.mapping
}

/** english 域：键前缀 → 分表映射（`vocab:<id>` → vocab_records …） */
const ENGLISH_TABLES: Record<string, CrudMapping> = {
  vocab: vocabMapping.mapping,
  reading: readingMapping.mapping,
  listening: listeningMapping.mapping,
  template: templatesMapping.mapping
}

/**
 * english 四张表的 NOT NULL 列（字段名取前端对象键；以 `worker/schema.sql` 的 DDL 为准）。
 * 缺列会让 SQLite 约束错误冒到 500，而设计 §4.1 要求「结构非法 → 400」：这里做前置校验。
 * 不计入的列：`id`/`user_id`（由键与登录态提供）、`updated_at`/`server_seq`（服务端写入）、
 * 带默认值或可空的列（vocab_records.points、essay_templates.level/category）。
 */
const ENGLISH_REQUIRED_FIELDS: Record<string, readonly string[]> = {
  vocab: ['date', 'newWords', 'reviewWords'], // vocab_records: date/new_words/review_words NOT NULL
  reading: ['date', 'wpm', 'accuracy'], // reading_records: date/wpm/accuracy NOT NULL
  listening: ['date', 'minutes', 'material', 'mode'], // listening_records: date/minutes/material/mode NOT NULL
  template: ['title', 'content'] // essay_templates: title/content NOT NULL
}

/** 全部已知同步域：pull 的 versions 与游标校验以此为准 */
const DOMAIN_NAMES = [
  'subjects',
  'records',
  'problemSessions',
  'errorQuestions',
  'exams',
  'notes',
  'materials',
  'todos',
  'habits',
  'summaries',
  'gamification',
  'pomodoro',
  'settings',
  'english'
] as const
const DOMAIN_SET: ReadonlySet<string> = new Set(DOMAIN_NAMES)

interface DeleteInput {
  key: string
  deletedAt: number
}

/** 内部统一形态的单条 upsert：key = 记录键；数组域的 value 即记录本身，复杂域为包装内的 value */
interface ChangeItem {
  key: string
  value: any
  updatedAt: number
}

/** 拉取到的一条记录（record 为响应 upserts 的元素，或包装内的 value） */
interface FetchedRecord {
  key: string
  updatedAt: number
  /** 该行落库时的服务端序号（客户端游标取该域返回记录的最大值） */
  seq: number
  record: any
}

/** 拉取到的一条墓碑（seq 供计算域游标；响应 deletes 元素仍只回传 { key, deletedAt }） */
interface FetchedDeletion {
  key: string
  deletedAt: number
  seq: number
}

/**
 * 单域拉取结果（与响应 changes[domain] 同形）。
 * `seq` = 本次该域实际返回的记录/墓碑中最大的 server_seq/seq —— 客户端的游标基准（设计 §4.2）。
 */
interface DomainChanges {
  seq: number
  upserts: unknown[]
  deletes: DeleteInput[]
}

/** LWW 判负原因：older = 客户端时间不新；deleted = 已被更新的墓碑覆盖 */
interface RejectedItem {
  domain: string
  key: string
  reason: 'older' | 'deleted'
}

/** 单域判定结果：待生效的 upsert（含是否复活）、待生效的 delete、判负项 */
interface Decision {
  upserts: { item: ChangeItem; revive: boolean }[]
  deletes: DeleteInput[]
  rejected: RejectedItem[]
}

/** 单域策略：把记录级变更映射到业务表，并负责键空间校验与拉取 */
interface DomainStrategy {
  /** 响应形状：raw = upserts 直接回传记录对象；wrapped = `{ key, value, updatedAt }` */
  shape: 'raw' | 'wrapped'
  /** 校验键空间与值形态（删除时 value 为 undefined；非法 → 400） */
  assertChange: (key: string, value?: unknown) => void
  /** 批量读现存记录的 LWW 时间戳（键 → stored.updated_at） */
  storedUpdatedAt: (env: Env, userId: string, keys: string[]) => Promise<Map<string, number>>
  /** 生成记录写入语句（整条记录覆盖，含子表重建） */
  upsertStatements: (env: Env, userId: string, item: ChangeItem, seq: number) => Promise<D1PreparedStatement[]>
  /** 生成业务行删除语句（墓碑由引擎统一写） */
  deleteStatements: (env: Env, userId: string, key: string) => D1PreparedStatement[]
  /** 拉取记录：cursor === null 为全量；否则只取 (cursor, upper] 窗口内的行 */
  fetch: (env: Env, userId: string, cursor: number | null, upper: number | null) => Promise<FetchedRecord[]>
}

/** 毫秒时间戳必须为正整数（0/负数/小数/字符串一律拒绝） */
function isPositiveInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v > 0
}

/** 游标必须为非负整数 */
function isNonNegativeInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0
}

/** 按 size 切片 */
function slice<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/** IN 列表占位符（列表长度已由 slice 限制在 D1 绑定参数上限内） */
const placeholders = (items: unknown[]) => items.map(() => '?').join(', ')

/**
 * 按 IN_CHUNK 分片执行「user_id + IN 列表」查询（键来自客户端，可能上千条，超出 D1 绑定参数上限）。
 * `sql(ph)` 接收占位符串；键先去重。
 */
async function allByKeys<T>(env: Env, sql: (ph: string) => string, userId: string, keys: string[]): Promise<T[]> {
  const parts = await Promise.all(
    slice([...new Set(keys)], IN_CHUNK).map((part) => all<T>(env, sql(placeholders(part)), userId, ...part))
  )
  return parts.flat()
}

/**
 * 记录级序号窗口条件：cursor 为下界（>），upper 为上界（<=）。
 *
 * 增量的上界取「本次读取到的 versions[domain]」快照：把返回集合限制在一个固定窗口内，与回传的 versions 自洽。
 * 客户端游标不取 versions 而取本次实际返回的最大 seq（见 fetchDomainChanges），因此
 * 「读 versions 之后新写入的行」不会被本次裁进来（下次增量按其真实序号带回），也不会被漏掉。
 */
function seqWindow(column: string, cursor: number | null, upper: number | null): { sql: string; params: number[] } {
  const conds: string[] = []
  const params: number[] = []
  if (cursor !== null) {
    conds.push(`${column} > ?`)
    params.push(cursor)
  }
  if (upper !== null) {
    conds.push(`${column} <= ?`)
    params.push(upper)
  }
  return { sql: conds.length ? ` AND ${conds.join(' AND ')}` : '', params }
}

/** 按表的某个键列批量读 updated_at（键 → LWW 时间戳） */
async function storedByColumn(
  env: Env,
  table: string,
  column: string,
  userId: string,
  keys: string[]
): Promise<Map<string, number>> {
  if (!keys.length) return new Map()
  const chunks = await Promise.all(
    slice([...new Set(keys)], IN_CHUNK).map((part) =>
      all<{ k: string; u: number }>(
        env,
        `SELECT ${column} AS k, updated_at AS u FROM ${table} WHERE user_id = ? AND ${column} IN (${placeholders(part)})`,
        userId,
        ...part
      )
    )
  )
  return new Map(chunks.flat().map((r) => [String(r.k), Number(r.u)]))
}

// ---------- 单域策略：单表数组域 ----------

/** 记录行 → 响应记录：复用各域 fromRow 映射，updatedAt 单独取自列 */
function toRecord(mapping: CrudMapping, row: any) {
  return { ...mapping.fromRow(row), updatedAt: row.updated_at }
}

/** 单表记录行 upsert（含复活）：显式写入 updated_at 与 server_seq */
function singleRowUpsert(
  env: Env,
  mapping: CrudMapping,
  userId: string,
  value: any,
  id: string,
  updatedAt: number,
  seq: number
) {
  const row = mapping.toRow(userId, value, id)
  row.updated_at = updatedAt
  row.server_seq = seq
  const keys = Object.keys(row).filter((k) => row[k] !== undefined)
  const columns = keys.map((k) => `"${k}"`).join(', ')
  const values = keys.map(() => '?').join(', ')
  const updates = keys
    .filter((k) => k !== 'id' && k !== 'user_id')
    .map((k) => `"${k}" = excluded."${k}"`)
    .join(', ')
  return env.DB.prepare(
    `INSERT INTO ${mapping.table} (${columns}) VALUES (${values}) ON CONFLICT(user_id, id) DO UPDATE SET ${updates}`
  ).bind(...keys.map((k) => row[k]))
}

/** 单表数组域策略：记录 = 一行，键 = 记录自身 id */
function singleTableStrategy(mapping: CrudMapping): DomainStrategy {
  return {
    shape: 'raw',
    // 键空间无前缀约束（键即记录 id）
    assertChange: () => {},
    storedUpdatedAt: (env, userId, keys) => storedByColumn(env, mapping.table, 'id', userId, keys),
    upsertStatements: async (env, userId, item, seq) => [
      singleRowUpsert(env, mapping, userId, item.value, item.key, item.updatedAt, seq)
    ],
    deleteStatements: (env, userId, key) => [
      env.DB.prepare(`DELETE FROM ${mapping.table} WHERE user_id = ? AND id = ?`).bind(userId, key)
    ],
    fetch: async (env, userId, cursor, upper) => {
      const w = seqWindow('server_seq', cursor, upper)
      const rows = await all<any>(env, `SELECT * FROM ${mapping.table} WHERE user_id = ?${w.sql}`, userId, ...w.params)
      return rows.map((row) => ({
        key: String(row.id),
        updatedAt: Number(row.updated_at),
        seq: Number(row.server_seq),
        record: toRecord(mapping, row)
      }))
    }
  }
}

// ---------- 单域策略：复杂域 ----------

const OBJECT_VALUE_REQUIRED = (domain: string, key: string) => `域 ${domain} 的记录值必须为对象（key: ${key}）`

/** subjects：记录 = 科目 + 其 chapters/topics 子树（子树随记录整体 upsert） */
const subjectsStrategy: DomainStrategy = {
  shape: 'wrapped',
  assertChange: (key, value) => {
    if (value === undefined) return
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new HttpError(400, OBJECT_VALUE_REQUIRED('subjects', key))
    // subjects.name/icon/color 为 NOT NULL：缺失会让整批 batch 失败成 500，提前判成 400
    for (const field of ['name', 'icon', 'color']) {
      if (typeof (value as Record<string, unknown>)[field] !== 'string')
        throw new HttpError(400, `域 subjects 的记录缺少 ${field}（key: ${key}）`)
    }
  },
  storedUpdatedAt: (env, userId, keys) => storedByColumn(env, 'subjects', 'id', userId, keys),
  upsertStatements: async (env, userId, item, seq) => [
    // 子树整树替换：先删该科目的 chapters/topics，再按记录内容重建
    env.DB.prepare(
      'DELETE FROM topics WHERE user_id = ? AND chapter_id IN (SELECT id FROM chapters WHERE user_id = ? AND subject_id = ?)'
    ).bind(userId, userId, item.key),
    env.DB.prepare('DELETE FROM chapters WHERE user_id = ? AND subject_id = ?').bind(userId, item.key),
    ...(await subjectInsertStatements(env, userId, { ...item.value, id: item.key }, { updatedAt: item.updatedAt, seq }))
  ],
  deleteStatements: (env, userId, key) => subjectTreeDeleteStatements(env, userId, key),
  fetch: async (env, userId, cursor, upper) => {
    const w = seqWindow('server_seq', cursor, upper)
    const rows = await all<{ id: string; updated_at: number; server_seq: number }>(
      env,
      `SELECT id, updated_at, server_seq FROM subjects WHERE user_id = ?${w.sql}`,
      userId,
      ...w.params
    )
    if (!rows.length) return []
    // 子树组装复用 getSubjectTree：科目量为个位到几十条，读全表后按变更 id 过滤的代价可忽略
    const wanted = new Set(rows.map((r) => String(r.id)))
    const updatedAt = new Map(rows.map((r) => [String(r.id), Number(r.updated_at)]))
    const seqOf = new Map(rows.map((r) => [String(r.id), Number(r.server_seq)]))
    const trees = await getSubjectTree(env, userId)
    return trees
      .filter((t) => wanted.has(t.id))
      .map((t) => ({ key: t.id, updatedAt: updatedAt.get(t.id) ?? 0, seq: seqOf.get(t.id) ?? 0, record: t }))
  }
}

/** habits：记录 = 单个习惯（含 records/checkins map），键 = habitId */
const habitsStrategy: DomainStrategy = {
  shape: 'wrapped',
  assertChange: (key, value) => {
    if (value === undefined) return
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new HttpError(400, OBJECT_VALUE_REQUIRED('habits', key))
    for (const field of ['name', 'type']) {
      if (typeof (value as Record<string, unknown>)[field] !== 'string')
        throw new HttpError(400, `域 habits 的记录缺少 ${field}（key: ${key}）`)
    }
  },
  storedUpdatedAt: (env, userId, keys) => storedByColumn(env, 'habits', 'id', userId, keys),
  upsertStatements: async (env, userId, item, seq) =>
    habitUpsertStatements(env, userId, { ...item.value, id: item.key }, { updatedAt: item.updatedAt, seq }),
  deleteStatements: (env, userId, key) => habitDeleteStatements(env, userId, key),
  fetch: async (env, userId, cursor, upper) => {
    const w = seqWindow('server_seq', cursor, upper)
    const rows = await all<{ id: string; updated_at: number; server_seq: number }>(
      env,
      `SELECT id, updated_at, server_seq FROM habits WHERE user_id = ?${w.sql}`,
      userId,
      ...w.params
    )
    if (!rows.length) return []
    const wanted = new Set(rows.map((r) => String(r.id)))
    const updatedAt = new Map(rows.map((r) => [String(r.id), Number(r.updated_at)]))
    const seqOf = new Map(rows.map((r) => [String(r.id), Number(r.server_seq)]))
    const habits = await getHabits(env, userId)
    return habits
      .filter((h) => wanted.has(h.id))
      .map((h) => ({ key: h.id, updatedAt: updatedAt.get(h.id) ?? 0, seq: seqOf.get(h.id) ?? 0, record: h }))
  }
}

/** summaries：记录 = 单日总结，键 = date（daily_summaries 主键 user_id + date） */
const summariesStrategy: DomainStrategy = {
  shape: 'wrapped',
  assertChange: (key, value) => {
    if (value === undefined) return
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new HttpError(400, OBJECT_VALUE_REQUIRED('summaries', key))
  },
  storedUpdatedAt: (env, userId, keys) => storedByColumn(env, 'daily_summaries', 'date', userId, keys),
  upsertStatements: async (env, userId, item, seq) => [
    env.DB.prepare(
      'INSERT INTO daily_summaries (user_id, date, mood, harvest, improve, plan, updated_at, server_seq) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ' +
        'ON CONFLICT(user_id, date) DO UPDATE SET mood = excluded.mood, harvest = excluded.harvest, improve = excluded.improve, plan = excluded.plan, updated_at = excluded.updated_at, server_seq = excluded.server_seq'
    ).bind(
      userId,
      item.key,
      item.value.mood ?? '',
      item.value.harvest ?? '',
      item.value.improve ?? '',
      item.value.plan ?? '',
      item.updatedAt,
      seq
    )
  ],
  deleteStatements: (env, userId, key) => [
    env.DB.prepare('DELETE FROM daily_summaries WHERE user_id = ? AND date = ?').bind(userId, key)
  ],
  fetch: async (env, userId, cursor, upper) => {
    const w = seqWindow('server_seq', cursor, upper)
    const rows = await all<any>(env, `SELECT * FROM daily_summaries WHERE user_id = ?${w.sql}`, userId, ...w.params)
    return rows.map((r) => ({
      key: String(r.date),
      updatedAt: Number(r.updated_at),
      seq: Number(r.server_seq),
      record: { date: r.date, mood: r.mood, harvest: r.harvest, improve: r.improve, plan: r.plan }
    }))
  }
}

/** settings：记录 = 单行设置（键固定 self） */
const settingsStrategy: DomainStrategy = {
  shape: 'wrapped',
  assertChange: (key, value) => {
    if (key !== 'self') throw new HttpError(400, `settings 域只接受键 self（实际：${key}）`)
    if (value === undefined) return
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new HttpError(400, OBJECT_VALUE_REQUIRED('settings', key))
  },
  storedUpdatedAt: async (env, userId, keys) => {
    if (!keys.includes('self')) return new Map()
    const row = await first<{ updated_at: number }>(
      env,
      'SELECT updated_at FROM user_settings WHERE user_id = ?',
      userId
    )
    return row ? new Map([['self', Number(row.updated_at)]]) : new Map()
  },
  upsertStatements: (env, userId, item, seq) =>
    settingsRecordStatements(env, userId, item.value, { updatedAt: item.updatedAt, seq }),
  deleteStatements: (env, userId) => [
    env.DB.prepare('DELETE FROM user_settings WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM default_quotes WHERE user_id = ?').bind(userId)
  ],
  fetch: async (env, userId, cursor, upper) => {
    const w = seqWindow('server_seq', cursor, upper)
    const row = await first<{ updated_at: number; server_seq: number }>(
      env,
      `SELECT updated_at, server_seq FROM user_settings WHERE user_id = ?${w.sql}`,
      userId,
      ...w.params
    )
    if (!row) return []
    // 记录值取 getSettings 的完整形状：永不回传 maimemoToken 明文（只回传 maimemoConnected 标记）
    return [
      {
        key: 'self',
        updatedAt: Number(row.updated_at),
        seq: Number(row.server_seq),
        record: await getSettings(env, userId)
      }
    ]
  }
}

/** 拆分 english 域的键（`<prefix>:<id>`）；校验阶段已确保前缀合法 */
function splitEnglishKey(key: string): { prefix: string; id: string } {
  const i = key.indexOf(':')
  return { prefix: key.slice(0, i), id: key.slice(i + 1) }
}

/** english：4 个子集合的单条记录，键前缀决定落到哪张表 */
const englishStrategy: DomainStrategy = {
  shape: 'wrapped',
  assertChange: (key, value) => {
    const { prefix, id } = splitEnglishKey(key)
    if (!ENGLISH_TABLES[prefix])
      throw new HttpError(400, `域 english 的键必须以 vocab:/reading:/listening:/template: 开头（key: ${key}）`)
    if (!id) throw new HttpError(400, `域 english 的键缺少记录 id（key: ${key}）`)
    if (value === undefined) return
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new HttpError(400, OBJECT_VALUE_REQUIRED('english', key))
    // 前置校验该前缀对应表的 NOT NULL 列：缺失会被 SQLite 约束报成 500，此处提前判成 400（设计 §4.1）
    const required = ENGLISH_REQUIRED_FIELDS[prefix]
    const v = value as Record<string, unknown>
    for (const field of required) {
      if (v[field] === undefined || v[field] === null)
        throw new HttpError(400, `域 english 的 ${prefix} 记录缺少必填字段 ${field}（key: ${key}）`)
    }
  },
  storedUpdatedAt: async (env, userId, keys) => {
    const byPrefix = new Map<string, string[]>()
    for (const key of keys) {
      const { prefix, id } = splitEnglishKey(key)
      const list = byPrefix.get(prefix) ?? []
      list.push(id)
      byPrefix.set(prefix, list)
    }
    const out = new Map<string, number>()
    for (const [prefix, ids] of byPrefix) {
      const stored = await storedByColumn(env, ENGLISH_TABLES[prefix].table, 'id', userId, ids)
      for (const [id, u] of stored) out.set(`${prefix}:${id}`, u)
    }
    return out
  },
  upsertStatements: async (env, userId, item, seq) => {
    const { prefix, id } = splitEnglishKey(item.key)
    return [singleRowUpsert(env, ENGLISH_TABLES[prefix], userId, item.value, id, item.updatedAt, seq)]
  },
  deleteStatements: (env, userId, key) => {
    const { prefix, id } = splitEnglishKey(key)
    return [env.DB.prepare(`DELETE FROM ${ENGLISH_TABLES[prefix].table} WHERE user_id = ? AND id = ?`).bind(userId, id)]
  },
  fetch: async (env, userId, cursor, upper) => {
    const out: FetchedRecord[] = []
    for (const [prefix, mapping] of Object.entries(ENGLISH_TABLES)) {
      const w = seqWindow('server_seq', cursor, upper)
      const rows = await all<any>(env, `SELECT * FROM ${mapping.table} WHERE user_id = ?${w.sql}`, userId, ...w.params)
      for (const row of rows) {
        out.push({
          key: `${prefix}:${row.id}`,
          updatedAt: Number(row.updated_at),
          seq: Number(row.server_seq),
          record: mapping.fromRow(row)
        })
      }
    }
    return out
  }
}

/** 拆分 pomodoro 域的键（`day:<date>` / `itr:<date>` / `rec:<id>`）；校验阶段已确保前缀合法 */
function splitPomodoroKey(key: string): { kind: string; rest: string } {
  const i = key.indexOf(':')
  return { kind: key.slice(0, i), rest: key.slice(i + 1) }
}

/** pomodoro：三键空间 —— day:<date>（日统计）/ itr:<date>（该日打断列表）/ rec:<id>（单条记录） */
const pomodoroStrategy: DomainStrategy = {
  shape: 'wrapped',
  assertChange: (key, value) => {
    const { kind, rest } = splitPomodoroKey(key)
    if (kind !== 'day' && kind !== 'itr' && kind !== 'rec')
      throw new HttpError(400, `域 pomodoro 的键必须以 day:/itr:/rec: 开头（key: ${key}）`)
    if (!rest) throw new HttpError(400, `域 pomodoro 的键缺少日期或记录 id（key: ${key}）`)
    if (value === undefined) return
    if (kind === 'itr') {
      if (!Array.isArray(value)) throw new HttpError(400, `域 pomodoro 的 itr: 键需要数组值（key: ${key}）`)
      for (const it of value as any[]) {
        if (
          !it ||
          typeof it !== 'object' ||
          Array.isArray(it) ||
          typeof it.reason !== 'string' ||
          !Number.isInteger(it.time)
        )
          throw new HttpError(400, `域 pomodoro 的 itr: 条目必须为 { reason: string, time: number }（key: ${key}）`)
      }
      return
    }
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new HttpError(400, `域 pomodoro 的 ${kind}: 键需要对象值（key: ${key}）`)
    const rec = value as Record<string, unknown>
    if (kind === 'rec' && (typeof rec.date !== 'string' || !Number.isInteger(rec.time)))
      throw new HttpError(400, `域 pomodoro 的 rec: 记录必须含 date 与 time（key: ${key}）`)
  },
  storedUpdatedAt: async (env, userId, keys) => {
    const dates: string[] = []
    const itrDates: string[] = []
    const ids: string[] = []
    for (const key of keys) {
      const { kind, rest } = splitPomodoroKey(key)
      if (kind === 'day') dates.push(rest)
      else if (kind === 'itr') itrDates.push(rest)
      else ids.push(rest)
    }
    const out = new Map<string, number>()
    for (const [date, u] of await storedByColumn(env, 'pomodoro_daily', 'date', userId, dates))
      out.set(`day:${date}`, u)
    for (const [id, u] of await storedByColumn(env, 'pomodoro_records', 'id', userId, ids)) out.set(`rec:${id}`, u)
    // itr 无业务行主键：以该日打断行的最大 updated_at 作为列表的 LWW 时间戳
    if (itrDates.length) {
      const chunks = await Promise.all(
        slice([...new Set(itrDates)], IN_CHUNK).map((part) =>
          all<{ d: string; u: number }>(
            env,
            `SELECT date AS d, MAX(updated_at) AS u FROM pomodoro_interruptions WHERE user_id = ? AND date IN (${placeholders(part)}) GROUP BY date`,
            userId,
            ...part
          )
        )
      )
      for (const r of chunks.flat()) out.set(`itr:${r.d}`, Number(r.u))
    }
    return out
  },
  upsertStatements: async (env, userId, item, seq) => {
    const { kind, rest } = splitPomodoroKey(item.key)
    const stamp = { updatedAt: item.updatedAt, seq }
    if (kind === 'day') return [pomodoroDailyStatement(env, userId, rest, item.value, stamp)]
    if (kind === 'itr') return pomodoroInterruptionsStatements(env, userId, rest, item.value, stamp)
    return [pomodoroRecordStatement(env, userId, rest, item.value, stamp)]
  },
  deleteStatements: (env, userId, key) => {
    const { kind, rest } = splitPomodoroKey(key)
    if (kind === 'day')
      return [env.DB.prepare('DELETE FROM pomodoro_daily WHERE user_id = ? AND date = ?').bind(userId, rest)]
    if (kind === 'itr')
      return [env.DB.prepare('DELETE FROM pomodoro_interruptions WHERE user_id = ? AND date = ?').bind(userId, rest)]
    return [env.DB.prepare('DELETE FROM pomodoro_records WHERE user_id = ? AND id = ?').bind(userId, rest)]
  },
  fetch: async (env, userId, cursor, upper) => {
    const out: FetchedRecord[] = []
    const wDaily = seqWindow('server_seq', cursor, upper)
    const dailyRows = await all<any>(
      env,
      `SELECT * FROM pomodoro_daily WHERE user_id = ?${wDaily.sql}`,
      userId,
      ...wDaily.params
    )
    for (const r of dailyRows) {
      out.push({
        key: `day:${r.date}`,
        updatedAt: Number(r.updated_at),
        seq: Number(r.server_seq),
        record: { date: r.date, count: r.count ?? 0, minutes: r.minutes ?? 0, interruptions: r.interruptions ?? 0 }
      })
    }
    const wItr = seqWindow('server_seq', cursor, upper)
    const itrRows = await all<any>(
      env,
      `SELECT date, reason, time, updated_at, server_seq FROM pomodoro_interruptions WHERE user_id = ?${wItr.sql} ORDER BY date, id`,
      userId,
      ...wItr.params
    )
    // 同一 date 的多行取该组 updated_at / server_seq 的最大值作为整组时间戳与游标序号
    const byDate = new Map<string, { items: { reason: string; time: number }[]; updatedAt: number; seq: number }>()
    for (const r of itrRows) {
      const group = byDate.get(r.date) ?? { items: [], updatedAt: 0, seq: 0 }
      group.items.push({ reason: r.reason, time: r.time })
      group.updatedAt = Math.max(group.updatedAt, Number(r.updated_at))
      group.seq = Math.max(group.seq, Number(r.server_seq))
      byDate.set(r.date, group)
    }
    for (const [date, group] of byDate)
      out.push({ key: `itr:${date}`, updatedAt: group.updatedAt, seq: group.seq, record: group.items })
    const wRec = seqWindow('server_seq', cursor, upper)
    const recRows = await all<any>(
      env,
      `SELECT * FROM pomodoro_records WHERE user_id = ?${wRec.sql}`,
      userId,
      ...wRec.params
    )
    for (const r of recRows)
      out.push({
        key: `rec:${r.id}`,
        updatedAt: Number(r.updated_at),
        seq: Number(r.server_seq),
        record: pomodoroRecordFromRow(r)
      })
    return out
  }
}

/** 记录级同步域 → 策略（7 个单表数组域 + 6 个复杂域；`gamification` 不可写，无策略） */
const DOMAIN_STRATEGIES: Record<string, DomainStrategy> = {
  ...Object.fromEntries(Object.entries(ARRAY_DOMAIN_MAPPINGS).map(([domain, m]) => [domain, singleTableStrategy(m)])),
  subjects: subjectsStrategy,
  habits: habitsStrategy,
  pomodoro: pomodoroStrategy,
  english: englishStrategy,
  summaries: summariesStrategy,
  settings: settingsStrategy
}

/**
 * 校验单个记录级域的变更形状；任何非法直接 400 / 超限 413。
 * 全部校验在建语句与触碰数据库之前完成（多域原子：任一域非法 → 整批不生效）。
 * 返回前按 key 去重：
 * - 同 key 的多条 upsert 只保留 updatedAt 最大者（否则后写的旧值会覆盖新值，反转 LWW）；
 * - 同 key 的多条 delete 只保留 deletedAt 最大者；
 * - 同 key 同时出现在 upserts 与 deletes → 400（同一条记录不能既写又删）。
 */
function validateDomainChanges(
  domain: string,
  strategy: DomainStrategy,
  value: unknown
): { upserts: ChangeItem[]; deletes: DeleteInput[] } {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new HttpError(400, `域 ${domain} 的值必须为对象`)
  const v = value as Record<string, unknown>
  if (!Array.isArray(v.upserts) || !Array.isArray(v.deletes))
    throw new HttpError(400, `域 ${domain} 的 upserts/deletes 必须为数组`)

  const upsertItems = v.upserts as unknown[]
  const deleteItems = v.deletes as unknown[]
  if (upsertItems.length + deleteItems.length > MAX_ITEMS_PER_COLLECTION)
    throw new HttpError(413, `域 ${domain} 记录数超过 ${MAX_ITEMS_PER_COLLECTION} 条上限`)

  const wrapped = strategy.shape === 'wrapped'
  const upserts = new Map<string, ChangeItem>()
  for (const raw of upsertItems) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
      throw new HttpError(400, `域 ${domain} 的 upsert 条目必须为对象`)
    const r = raw as Record<string, unknown>
    let item: ChangeItem
    if (wrapped) {
      // 复杂域：`{ key, value, updatedAt }` 包装（多集合域由键前缀定位落库位置）
      if (typeof r.key !== 'string' || !r.key) throw new HttpError(400, `域 ${domain} 的 upsert 缺少合法 key`)
      if (r.value === undefined) throw new HttpError(400, `域 ${domain} 的 upsert 缺少 value`)
      if (!isPositiveInt(r.updatedAt))
        throw new HttpError(400, `域 ${domain} 的 upsert 缺少合法的 updatedAt（毫秒正整数）`)
      if (JSON.stringify(r.value).length > MAX_FIELD_CHARS)
        throw new HttpError(413, `域 ${domain} 存在超过 1MB 的单条内容`)
      strategy.assertChange(r.key, r.value)
      item = { key: r.key, value: r.value, updatedAt: r.updatedAt }
    } else {
      // 单表数组域：upsert 项即记录本身，键取自记录自身 id
      if (typeof r.id !== 'string' || !r.id)
        throw new HttpError(400, `域 ${domain} 的 upsert 缺少合法 id（键取记录自身 id）`)
      if (!isPositiveInt(r.updatedAt))
        throw new HttpError(400, `域 ${domain} 的 upsert 缺少合法的 updatedAt（毫秒正整数）`)
      for (const field of Object.values(r)) {
        if (typeof field === 'string' && field.length > MAX_FIELD_CHARS)
          throw new HttpError(413, `域 ${domain} 存在超过 1MB 的单条内容`)
      }
      if (domain === 'notes') {
        if (Object.prototype.hasOwnProperty.call(r, 'content'))
          throw new HttpError(400, 'notes 域只接受元数据，正文请使用 /api/note-bodies')
        if (!isNonNegativeInt(r.bodyUpdatedAt)) throw new HttpError(400, 'notes 域的 bodyUpdatedAt 必须为非负整数')
        if (r.type === 'pdf' && r.bodyUpdatedAt !== 0) throw new HttpError(400, 'PDF 笔记的 bodyUpdatedAt 必须为 0')
      }
      strategy.assertChange(r.id)
      item = { key: r.id, value: r, updatedAt: r.updatedAt }
    }
    const prev = upserts.get(item.key)
    if (!prev || item.updatedAt > prev.updatedAt) upserts.set(item.key, item)
  }

  const deletes = new Map<string, DeleteInput>()
  for (const raw of deleteItems) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
      throw new HttpError(400, `域 ${domain} 的 delete 条目必须为对象`)
    const d = raw as Record<string, unknown>
    if (typeof d.key !== 'string' || !d.key) throw new HttpError(400, `域 ${domain} 的 delete 缺少合法 key`)
    if (!isPositiveInt(d.deletedAt))
      throw new HttpError(400, `域 ${domain} 的 delete 缺少合法的 deletedAt（毫秒正整数）`)
    strategy.assertChange(d.key)
    const prev = deletes.get(d.key)
    if (!prev || d.deletedAt > prev.deletedAt) deletes.set(d.key, { key: d.key, deletedAt: d.deletedAt })
  }

  for (const key of deletes.keys()) {
    if (upserts.has(key))
      throw new HttpError(400, `域 ${domain} 的同一条记录不能同时被 upsert 与 delete（key: ${key}）`)
  }
  return { upserts: [...upserts.values()], deletes: [...deletes.values()] }
}

/**
 * 校验并拆分 points 事件（设计 §5.1）：
 * - `award`：需 `refId`（幂等键）、正整数的 `points`、非空 `reason`；`date` 缺省为服务端今日
 * - `revoke`：`refId`（精确）与 `refPrefix`（前缀）二选一
 * 任何非法形状 → 400 中文提示；校验先于任何数据库访问（与域校验同批原子）。
 */
function parsePointsEvents(points: unknown): {
  awards: PointsAward[]
  revokes: { refId?: string; refPrefix?: string }[]
} {
  if (points === undefined || points === null) return { awards: [], revokes: [] }
  if (!Array.isArray(points)) throw new HttpError(400, 'points 必须为数组')
  const awards: PointsAward[] = []
  const revokes: { refId?: string; refPrefix?: string }[] = []
  for (const item of points) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new HttpError(400, 'points 含非法条目')
    const e = item as Record<string, unknown>
    const refId = typeof e.refId === 'string' && e.refId ? e.refId : undefined
    const refPrefix = typeof e.refPrefix === 'string' && e.refPrefix ? e.refPrefix : undefined
    if (e.op === 'award') {
      if (!refId) throw new HttpError(400, 'points 的 award 事件缺少 refId')
      if (!isPositiveInt(e.points)) throw new HttpError(400, 'points 的 award 事件的 points 必须为正整数')
      if (typeof e.reason !== 'string' || !e.reason) throw new HttpError(400, 'points 的 award 事件缺少 reason')
      awards.push({
        refId,
        points: e.points,
        reason: e.reason,
        date: typeof e.date === 'string' && e.date ? e.date : utc8Today()
      })
      continue
    }
    if (e.op === 'revoke') {
      if (refId && refPrefix) throw new HttpError(400, 'points 的 revoke 事件不能同时给 refId 与 refPrefix')
      if (!refId && !refPrefix) throw new HttpError(400, 'points 的 revoke 事件必须给 refId 或 refPrefix')
      revokes.push({ refId, refPrefix })
      continue
    }
    throw new HttpError(400, 'points 事件的 op 只能是 award 或 revoke')
  }
  return { awards, revokes }
}

/**
 * 校验并规范化推送的 `achievements`（成就 id 列表，设计 §5.1）：
 * 缺省/`null` → 无成就上报；必须是字符串数组、元素为非空字符串、去重后不超过 `MAX_ACHIEVEMENTS`。
 * 校验不触碰数据库（与域校验同批原子：任一非法 → 整批 400）。
 */
function parseAchievements(v: unknown): string[] {
  if (v === undefined || v === null) return []
  if (!Array.isArray(v)) throw new HttpError(400, 'achievements 必须为字符串数组')
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of v) {
    if (typeof item !== 'string' || !item) throw new HttpError(400, 'achievements 的元素必须为非空字符串')
    if (seen.has(item)) continue // 去重：重复项不产生变化
    seen.add(item)
    out.push(item)
  }
  if (out.length > MAX_ACHIEVEMENTS) throw new HttpError(400, `achievements 去重后不能超过 ${MAX_ACHIEVEMENTS} 项`)
  return out
}

/**
 * 成就集合并集（只增不减）：已有在前（保持存储顺序稳定），新解锁按传入顺序追加，重复项去重。
 * 幂等：重复推送同一批 id 结果不变。
 */
function mergeAchievements(stored: string[], incoming: string[]): string[] {
  const seen = new Set(stored)
  const merged = [...stored]
  for (const id of incoming) {
    if (seen.has(id)) continue
    seen.add(id)
    merged.push(id)
  }
  return merged
}

/** 批量读已存在的流水 `ref_id`（幂等判重：本次只对缺失的 refId 发语句并计入响应 awarded） */
async function readExistingRefIds(env: Env, userId: string, refIds: string[]): Promise<Set<string>> {
  const rows = await allByKeys<{ ref_id: string }>(
    env,
    (ph) => `SELECT ref_id FROM points_log WHERE user_id = ? AND ref_id IN (${ph})`,
    userId,
    refIds
  )
  return new Set(rows.map((r) => String(r.ref_id)))
}

/** 记录删除被接受时该域关联的积分流水回收规则（服务端不变量：不依赖客户端是否发了 revoke 事件） */
function pointsRefOfDeleted(domain: string, key: string): { refId?: string; refPrefix?: string } {
  switch (domain) {
    case 'records':
    case 'problemSessions':
    case 'exams':
      return { refId: key }
    case 'errorQuestions':
      return { refId: `error:${key}` } // 客户端复习错题时用的就是这个 ref 形式
    case 'habits':
      return { refPrefix: `habit:${key}:` } // 习惯打卡积分 ref 形如 habit:<habitId>:<date>
    default:
      return {}
  }
}

// ---------- 删除驱动的孤儿清理（设计 §6.4） ----------

/**
 * 记录删除被接受时清理其关联的外部数据（语句并入主 batch），替代原先「推送前后整域差集」的清理方式：
 * - `notes`：按 note id 同时删除 Markdown 正文分片与 PDF 原文分片
 * - `errorQuestions`：`image = 'r2:<sha256>'` → 删 `error_images` 归属行 + R2 对象
 * R2 对象无法进 D1 batch，键收集到 `r2Keys` 由主 batch 提交后再删。
 * 幂等：行不存在时删除 0 行；R2 对象不存在时删除为无操作，重复删除同样安全。
 */
async function orphanCleanupStatements(
  env: Env,
  userId: string,
  domain: string,
  keys: string[],
  r2Keys: Set<string>
): Promise<D1PreparedStatement[]> {
  if (!keys.length) return []

  if (domain === 'notes') {
    const statements: D1PreparedStatement[] = []
    for (const key of keys) {
      statements.push(
        env.DB.prepare('DELETE FROM note_body_chunks WHERE user_id = ? AND note_id = ?').bind(userId, key),
        env.DB.prepare('DELETE FROM pdf_chunks WHERE user_id = ? AND pdf_id = ?').bind(userId, key)
      )
    }
    return statements
  }

  if (domain === 'errorQuestions') {
    // 图片内容寻址：同一 sha256 可能被多条错题引用，仅在「本用户已无其它引用」时才删归属行与对象，
    // 否则会删掉其它错题仍在展示的图片（原整域差集清理天然具备该语义）
    const rows = await allByKeys<{ id: string; image: string | null; refs: number }>(
      env,
      (ph) =>
        `SELECT q.id AS id, q.image AS image, ` +
        `(SELECT COUNT(*) FROM error_questions o WHERE o.user_id = q.user_id AND o.image = q.image) AS refs ` +
        `FROM error_questions q WHERE q.user_id = ? AND q.id IN (${ph})`,
      userId,
      keys
    )
    const imageIds = [
      ...new Set(
        rows
          .filter((r) => Number(r.refs) <= 1 && typeof r.image === 'string' && r.image.startsWith('r2:'))
          .map((r) => String(r.image).slice(3))
          .filter(Boolean)
      )
    ]
    if (!imageIds.length) return []
    const owners = await allByKeys<{ id: string; r2_key: string }>(
      env,
      (ph) => `SELECT id, r2_key FROM error_images WHERE user_id = ? AND id IN (${ph})`,
      userId,
      imageIds
    )
    for (const o of owners) if (o.r2_key) r2Keys.add(String(o.r2_key))
    return owners.map((o) => env.DB.prepare('DELETE FROM error_images WHERE user_id = ? AND id = ?').bind(userId, o.id))
  }

  return []
}

// ---------- 服务端权威派生量（设计 §5.2） ----------

/** 今日学习时长奖励（沿用既有阈值与分值） */
const STUDY_MINUTE_THRESHOLD = 60
const STUDY_MINUTE_POINTS = 3

/** 连续学习里程碑 → 积分 + 徽章（沿用既有阈值与分值；`ref_id` 幂等保证只发一次） */
const STREAK_MILESTONES: readonly { days: number; points: number; badge: BadgeKey; reason: string }[] = [
  { days: 7, points: 5, badge: 'streak_7', reason: '连续学习满 7 天' },
  { days: 30, points: 10, badge: 'streak_30', reason: '连续学习满 30 天' },
  { days: 100, points: 20, badge: 'streak_100', reason: '连续学习满 100 天' }
]

/** 单日学习聚合：删除/覆盖修改时要精确回退，故条数与分钟数一起维护 */
interface DayAggregate {
  count: number
  minutes: number
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** 记录里的学习日期（缺失或格式非法返回 undefined，避免非法日期参与 streak 计算） */
function studyDateOf(value: any): string | undefined {
  const d = value?.date
  return typeof d === 'string' && DATE_RE.test(d) ? d : undefined
}

/** 分钟数（非数值按 0 计） */
function minutesOf(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function addStudyDay(agg: Map<string, DayAggregate>, date: string | undefined, minutes: number) {
  if (!date) return
  const cur = agg.get(date) ?? { count: 0, minutes: 0 }
  agg.set(date, { count: cur.count + 1, minutes: cur.minutes + minutes })
}

function removeStudyDay(agg: Map<string, DayAggregate>, date: string | undefined, minutes: number) {
  if (!date) return
  const cur = agg.get(date)
  if (!cur) return
  const next = { count: cur.count - 1, minutes: cur.minutes - minutes }
  if (next.count <= 0) agg.delete(date)
  else agg.set(date, next)
}

/** 前一个自然日（按 UTC 解析纯日期，避开本地时区） */
function prevDate(date: string): string {
  const d = new Date(`${date}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return ''
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

/**
 * 连续学习天数：以**最新学习日**结尾的连续日期段长度（与客户端 `checkin()` 同口径——
 * 客户端每次加记录时「lastCheckin === 昨天 ? streak + 1 : 1」，等价于按学习日期集合数连续天数）。
 * 无记录 → 0。
 */
function computeStreak(dates: string[]): number {
  if (!dates.length) return 0
  const set = new Set(dates)
  const sorted = [...set].sort()
  let days = 1
  let cur = sorted[sorted.length - 1]
  for (;;) {
    const prev = prevDate(cur)
    if (!prev || !set.has(prev)) break
    days++
    cur = prev
  }
  return days
}

/**
 * 服务端权威派生（设计 §5.2）：batch 前预读 `study_records` 的按日聚合，用本批**已接受**的记录变更
 * 在内存里叠加，得出确定性的「今日学习分钟数」与「连续学习天数」，再把发放语句并入主 batch——
 * 不做「先写记录、再单独 batch 发放」（那会重现「积分已发/徽章未发」的非原子窗口）。
 *
 * 并发下靠 `ref_id` 幂等（`srv:study-minutes:<date>` / `srv:streak:<days>`）保证不重复发放；
 * 若主 batch 失败，下次推送会按同一派生结果重算并补发（流水未落则判重通过）。
 *
 * 返回：待落账的派生积分条目 + 待写回的 streak（未改动学习记录时均为空，避免无谓改写）。
 */
async function deriveServerAwards(
  env: Env,
  userId: string,
  records: Decision | undefined
): Promise<{
  awards: PointsAward[]
  streak: { streak: number; lastCheckin: string } | null
  statements: D1PreparedStatement[]
}> {
  if (!records || (!records.upserts.length && !records.deletes.length))
    return { awards: [], streak: null, statements: [] }

  const agg = new Map<string, DayAggregate>()
  const dayRows = await all<{ date: string; n: number; m: number }>(
    env,
    'SELECT date AS date, COUNT(*) AS n, COALESCE(SUM(minutes), 0) AS m FROM study_records WHERE user_id = ? GROUP BY date',
    userId
  )
  for (const r of dayRows) agg.set(String(r.date), { count: Number(r.n), minutes: Number(r.m) })

  // 本批被覆盖/删除行的原值：先回退旧值再写入新值，才能得到「本批之后」的确定性聚合
  const touched = [...records.upserts.map((op) => op.item.key), ...records.deletes.map((d) => d.key)]
  const stored = new Map(
    (
      await allByKeys<{ id: string; date: string; minutes: number }>(
        env,
        (ph) => `SELECT id, date, minutes FROM study_records WHERE user_id = ? AND id IN (${ph})`,
        userId,
        touched
      )
    ).map((r) => [String(r.id), r])
  )
  for (const op of records.upserts) {
    const old = stored.get(op.item.key)
    if (old) removeStudyDay(agg, studyDateOf(old), minutesOf(old.minutes))
    addStudyDay(agg, studyDateOf(op.item.value), minutesOf(op.item.value?.minutes))
  }
  for (const del of records.deletes) {
    const old = stored.get(del.key)
    if (old) removeStudyDay(agg, studyDateOf(old), minutesOf(old.minutes))
  }

  const today = utc8Today()
  const dates = [...agg.keys()].sort()
  const streak = computeStreak(dates)
  const awards: PointsAward[] = []
  if ((agg.get(today)?.minutes ?? 0) >= STUDY_MINUTE_THRESHOLD)
    awards.push({
      refId: `srv:study-minutes:${today}`,
      points: STUDY_MINUTE_POINTS,
      reason: `今日学习满 ${STUDY_MINUTE_THRESHOLD} 分钟`,
      date: today
    })

  const statements: D1PreparedStatement[] = []
  for (const m of STREAK_MILESTONES) {
    if (streak < m.days) continue
    awards.push({ refId: `srv:streak:${m.days}`, points: m.points, reason: m.reason, date: today })
    // 徽章发放：awardBadge 内部 INSERT OR IGNORE 原子抢占（避免重复通知/广播帖），
    // 返回的通知/广播帖语句并入主 batch，与积分同批提交
    statements.push(...(await awardBadge(env, userId, m.badge)))
  }
  return { awards, streak: { streak, lastCheckin: dates.length ? dates[dates.length - 1] : '' }, statements }
}

/** 读取用户各域当前序号 */
async function currentVersions(env: Env, userId: string): Promise<Map<string, number>> {
  const rows = await all<{ domain: string; version: number }>(
    env,
    'SELECT domain, version FROM sync_domain_versions WHERE user_id = ?',
    userId
  )
  return new Map(rows.map((r) => [r.domain, Number(r.version)]))
}

/** 全部已知域的当前序号（缺省 0），供客户端对齐游标 */
async function allVersions(env: Env, userId: string): Promise<Record<string, number>> {
  const current = await currentVersions(env, userId)
  return Object.fromEntries(DOMAIN_NAMES.map((d) => [d, current.get(d) ?? 0]))
}

/** 批量读某域指定键的墓碑（键 → deleted_at） */
async function readTombstones(env: Env, userId: string, domain: string, keys: string[]): Promise<Map<string, number>> {
  const chunks = await Promise.all(
    slice([...new Set(keys)], IN_CHUNK).map((part) =>
      all<{ record_key: string; deleted_at: number }>(
        env,
        `SELECT record_key, deleted_at FROM sync_deletions WHERE user_id = ? AND domain = ? AND record_key IN (${placeholders(part)})`,
        userId,
        domain,
        ...part
      )
    )
  )
  return new Map(chunks.flat().map((t) => [String(t.record_key), Number(t.deleted_at)]))
}

/**
 * 按设计 §4.3 的判定表逐条决策（先读后写）。
 * 业务行与墓碑各用批量 SELECT 取当前状态；本函数只读不写。
 */
async function decideDomain(
  env: Env,
  userId: string,
  domain: string,
  strategy: DomainStrategy,
  upserts: ChangeItem[],
  deletes: DeleteInput[]
): Promise<Decision> {
  const decision: Decision = { upserts: [], deletes: [], rejected: [] }
  const keys = [...new Set([...upserts.map((u) => u.key), ...deletes.map((d) => d.key)])]
  if (!keys.length) return decision

  const [stored, tombstoned] = await Promise.all([
    strategy.storedUpdatedAt(env, userId, keys),
    readTombstones(env, userId, domain, keys)
  ])

  for (const item of upserts) {
    const tomb = tombstoned.get(item.key)
    if (tomb !== undefined) {
      // 有墓碑：编辑时间新于删除时刻才复活，否则判负（避免旧设备复活已删记录）
      if (item.updatedAt > tomb) decision.upserts.push({ item, revive: true })
      else decision.rejected.push({ domain, key: item.key, reason: 'deleted' })
      continue
    }
    const storedAt = stored.get(item.key)
    if (storedAt !== undefined && item.updatedAt <= storedAt) {
      // 幂等重放安全：同时间戳或更旧的编辑不覆盖服务端
      decision.rejected.push({ domain, key: item.key, reason: 'older' })
      continue
    }
    decision.upserts.push({ item, revive: false })
  }

  for (const item of deletes) {
    const tomb = tombstoned.get(item.key)
    if (tomb !== undefined && item.deletedAt <= tomb) {
      decision.rejected.push({ domain, key: item.key, reason: 'older' })
      continue
    }
    const storedAt = stored.get(item.key)
    if (storedAt !== undefined && item.deletedAt <= storedAt) {
      decision.rejected.push({ domain, key: item.key, reason: 'older' })
      continue
    }
    // 服务端没有该记录时同样写墓碑：否则其它设备无从得知这条记录已被删除
    decision.deletes.push(item)
  }
  return decision
}

/** 写墓碑（同 key 重复删除 = 更新 deletedAt/seq） */
function tombstoneStatement(env: Env, userId: string, domain: string, key: string, deletedAt: number, seq: number) {
  return env.DB.prepare(
    'INSERT OR REPLACE INTO sync_deletions (user_id, domain, record_key, deleted_at, seq) VALUES (?, ?, ?, ?, ?)'
  ).bind(userId, domain, key, deletedAt, seq)
}

/** 复活时清除墓碑 */
function removeTombstoneStatement(env: Env, userId: string, domain: string, key: string) {
  return env.DB.prepare('DELETE FROM sync_deletions WHERE user_id = ? AND domain = ? AND record_key = ?').bind(
    userId,
    domain,
    key
  )
}

/**
 * 原子分配域序号（语义为「域级单调序号」，本批写入的所有行/墓碑取该值）。
 *
 * 必须是**单条语句取号**：先 `SELECT version` 再 `version + 1` 会让同域并发 push 拿到同一个序号
 * （版本号却各 +1，最终跳号 2），已把游标推进到该序号的客户端此后 `server_seq > cursor` 会永久漏掉其中一批。
 * `INSERT ... ON CONFLICT DO UPDATE ... RETURNING version` 由 SQLite 在单条语句内原子完成读改写。
 *
 * 取号发生在 batch **之前**：若其后 batch 失败或进程中断会消耗掉一个号（版本空洞）。
 * 这对游标无害——客户端游标只会跳到更大的号，等价于「跳过一个空批次」，不会漏数据。
 */
export async function allocateSeq(env: Env, userId: string, domain: string): Promise<number> {
  const row = await first<{ version: number }>(
    env,
    `INSERT INTO sync_domain_versions (user_id, domain, version, updated_at) VALUES (?, ?, 1, ?)
     ON CONFLICT(user_id, domain) DO UPDATE SET version = sync_domain_versions.version + 1, updated_at = excluded.updated_at
     RETURNING version`,
    userId,
    domain,
    nowSec()
  )
  if (!row) throw new HttpError(500, '域序号分配失败')
  return Number(row.version)
}

/** 拉取某域的墓碑变更（cursor === null 为全量）；seq 供计算该域游标 */
async function fetchDeletions(
  env: Env,
  userId: string,
  domain: string,
  cursor: number | null,
  upper: number | null
): Promise<FetchedDeletion[]> {
  const w = seqWindow('seq', cursor, upper)
  const rows = await all<{ record_key: string; deleted_at: number; seq: number }>(
    env,
    `SELECT record_key, deleted_at, seq FROM sync_deletions WHERE user_id = ? AND domain = ?${w.sql}`,
    userId,
    domain,
    ...w.params
  )
  return rows.map((t) => ({ key: String(t.record_key), deletedAt: Number(t.deleted_at), seq: Number(t.seq) }))
}

/**
 * 组装单域拉取结果：记录（按 shape 决定是否包装）+ 墓碑 + 该域游标 `seq`。
 *
 * `seq` = 本次实际返回的记录/墓碑中最大的 server_seq/seq：客户端把它当作新游标（设计 §4.2 游标契约），
 * 因此即使 `versions[domain]` 因 `allocateSeq` 独立提交而高于实际可读序号，游标也不会被推高到空洞号。
 * 响应 deletes 元素仍只回传 `{ key, deletedAt }`（形状稳定），seq 不进入元素。
 */
async function fetchDomainChanges(
  env: Env,
  userId: string,
  domain: string,
  strategy: DomainStrategy,
  cursor: number | null,
  upper: number | null
): Promise<DomainChanges> {
  const [records, deletions] = await Promise.all([
    strategy.fetch(env, userId, cursor, upper),
    fetchDeletions(env, userId, domain, cursor, upper)
  ])
  const seqs = [...records.map((r) => r.seq), ...deletions.map((d) => d.seq)]
  return {
    seq: seqs.length ? Math.max(...seqs) : 0,
    upserts: records.map((r) =>
      strategy.shape === 'raw' ? r.record : { key: r.key, value: r.record, updatedAt: r.updatedAt }
    ),
    deletes: deletions.map((d) => ({ key: d.key, deletedAt: d.deletedAt }))
  }
}

/**
 * full 拉取：全部 13 个记录级域的全部记录 + 全部墓碑，与增量**同一响应形状**
 * （不再有 subjects/habits/pomodoro/settings/summaries/english 的顶层整域快照键）。
 * 各域 `changes[domain].seq` = 本次实际返回的最大 server_seq/seq，客户端据此建立初始游标。
 * `gamification` 不是可写域，仍单独回传服务端权威快照。
 */
async function pullSnapshot(env: Env, userId: string) {
  const [versions, gamification] = await Promise.all([allVersions(env, userId), getGamification(env, userId)])

  const changes: Record<string, DomainChanges> = {}
  await Promise.all(
    Object.entries(DOMAIN_STRATEGIES).map(async ([domain, strategy]) => {
      changes[domain] = await fetchDomainChanges(env, userId, domain, strategy, null, null)
    })
  )

  return { full: true, versions, changes, gamification }
}

/**
 * 增量拉取：只返回 (cursor, version] 窗口内的记录与墓碑；空域不出现。
 *
 * 客户端游标取响应里各域的 `seq`（本次实际返回的最大序号，见 fetchDomainChanges），**不是** `versions`：
 * versions 只是信息性字段，`allocateSeq` 先行提交会让它暂时高于实际已提交的业务行。
 */
async function pullIncremental(env: Env, userId: string, cursors: Record<string, number>) {
  const [versions, gamification] = await Promise.all([allVersions(env, userId), getGamification(env, userId)])

  const changes: Record<string, DomainChanges> = {}
  await Promise.all(
    Object.entries(DOMAIN_STRATEGIES).map(async ([domain, strategy]) => {
      const cursor = cursors[domain] ?? 0
      // 上界取本次读取到的 versions[domain] 快照（见 seqWindow 注释），与回传的 versions 自洽
      const result = await fetchDomainChanges(env, userId, domain, strategy, cursor, versions[domain] ?? 0)
      if (result.upserts.length || result.deletes.length) changes[domain] = result
    })
  )

  return { full: false, versions, changes, gamification }
}

/**
 * 读取 pull 请求体：空 body 等价于 `{}`（即 full 快照），避免前端漏传 body 时收到 400。
 * 先读 clone() 探空，非空再交给 body() 做 10MB 限制与 JSON 解析（同一份流的两次读取）。
 */
async function pullBody(request: Request): Promise<{ full?: boolean; cursors?: unknown }> {
  const text = (await request.clone().text()).trim()
  if (!text) return {}
  return body<{ full?: boolean; cursors?: unknown }>(request, SYNC_MAX_BYTES)
}

export function registerSyncRoutes() {
  on('POST', '/api/data/push', true, async (ctx) => {
    rateLimit(ctx.request, 'data:sync', 60)
    const payload = await body<{ domains?: unknown; points?: unknown; achievements?: unknown }>(
      ctx.request,
      SYNC_MAX_BYTES
    )
    const events = parsePointsEvents(payload?.points)
    const achievements = parseAchievements(payload?.achievements)

    const domainsRaw = payload?.domains
    if (
      domainsRaw !== undefined &&
      domainsRaw !== null &&
      (typeof domainsRaw !== 'object' || Array.isArray(domainsRaw))
    )
      throw new HttpError(400, 'domains 必须为对象')
    const domains = (domainsRaw ?? {}) as Record<string, unknown>
    const names = Object.keys(domains)
    if (!names.length && !events.awards.length && !events.revokes.length && !achievements.length)
      throw new HttpError(400, '没有需要同步的变更')

    // 1. 全部校验先于任何数据库访问（多域单请求原子：任一域非法 → 整批 400）
    const validated: { domain: string; strategy: DomainStrategy; upserts: ChangeItem[]; deletes: DeleteInput[] }[] = []
    for (const domain of names) {
      if (!DOMAIN_SET.has(domain)) throw new HttpError(400, `未知同步域: ${domain}`)
      if (domain === 'gamification') throw new HttpError(400, '积分由服务端维护，gamification 域不可由客户端推送')
      const strategy = DOMAIN_STRATEGIES[domain]
      if (!strategy) throw new HttpError(400, `域 ${domain} 尚未启用记录级同步`)
      const { upserts, deletes } = validateDomainChanges(domain, strategy, domains[domain])
      validated.push({ domain, strategy, upserts, deletes })
    }

    // 公开资料校验仍属于阶段 1：命中时在任何数据库访问前整批拒绝。
    for (const item of validated.find((entry) => entry.domain === 'settings')?.upserts ?? []) {
      item.value = await validateSettingsPublicText(item.value, ctx.env)
    }

    // 2. 时钟钳制：客户端 updatedAt/deletedAt 超前服务端超过 5 分钟 → 改用服务端时间参与 LWW 与落库。
    //    计数 clamped 供观测；正常请求（偏差在阈值内）恒为 0。
    const serverNow = Date.now()
    let clamped = 0
    for (const v of validated) {
      for (const item of v.upserts) {
        if (item.updatedAt > serverNow + CLOCK_SKEW_MS) {
          item.updatedAt = serverNow
          clamped++
        }
      }
      for (const item of v.deletes) {
        if (item.deletedAt > serverNow + CLOCK_SKEW_MS) {
          item.deletedAt = serverNow
          clamped++
        }
      }
    }

    // 3. 逐域先读后写决策
    const decisions = await Promise.all(
      validated.map((v) => decideDomain(ctx.env, ctx.userId, v.domain, v.strategy, v.upserts, v.deletes))
    )

    // 4. 序号分配 + 语句装配：域内有任一条生效才原子取号（见 allocateSeq），本批该域全部写入取同一序号
    const statements: D1PreparedStatement[] = []
    const versions: Record<string, number> = {}
    const applied: Record<string, number> = {}
    const deletes: Record<string, number> = {}
    // 待撤销的积分流水（删除驱动 + 客户端 revoke 事件）：refId 精确 + refPrefix 前缀
    const revokeRefIds = new Set<string>()
    const revokePrefixes = new Set<string>()
    /** 待删除的 R2 对象键：R2 无法进 D1 batch，故主 batch 提交后再删 */
    const r2Keys = new Set<string>()

    const rejected: RejectedItem[] = []
    for (let i = 0; i < validated.length; i++) {
      const { domain, strategy } = validated[i]
      const d = decisions[i]
      rejected.push(...d.rejected)
      if (!d.upserts.length && !d.deletes.length) continue

      const seq = await allocateSeq(ctx.env, ctx.userId, domain)
      for (const op of d.upserts) {
        statements.push(...(await strategy.upsertStatements(ctx.env, ctx.userId, op.item, seq)))
        if (op.revive) statements.push(removeTombstoneStatement(ctx.env, ctx.userId, domain, op.item.key))
      }
      const deletedKeys: string[] = []
      for (const item of d.deletes) {
        statements.push(...strategy.deleteStatements(ctx.env, ctx.userId, item.key))
        statements.push(tombstoneStatement(ctx.env, ctx.userId, domain, item.key, item.deletedAt, seq))
        deletedKeys.push(item.key)
        // 删除被接受即撤销该记录关联的积分流水（服务端不变量，不依赖客户端是否发了 revoke 事件；
        // 与客户端显式 revoke 重复到达也安全——按 refId 删除 + 投影重算都是幂等的）
        const ref = pointsRefOfDeleted(domain, item.key)
        if (ref.refId) revokeRefIds.add(ref.refId)
        if (ref.refPrefix) revokePrefixes.add(ref.refPrefix)
      }
      // 删除驱动的孤儿清理（notes → pdf_chunks；errorQuestions → error_images + R2）
      statements.push(...(await orphanCleanupStatements(ctx.env, ctx.userId, domain, deletedKeys, r2Keys)))
      versions[domain] = seq
      applied[domain] = d.upserts.length
      deletes[domain] = d.deletes.length
    }

    // 5. 服务端权威派生（今日学习时长 / streak / 里程碑徽章）：与记录写入同一 batch
    const recordsIndex = validated.findIndex((v) => v.domain === 'records')
    const derived = await deriveServerAwards(
      ctx.env,
      ctx.userId,
      recordsIndex >= 0 ? decisions[recordsIndex] : undefined
    )

    // 6. 积分落账：先撤销（删除驱动 + 客户端事件），再按 ref_id 幂等发放。
    //    同批内既撤销又发放同一 refId 时以**本次发放**为准（离线一次性刷 outbox 的典型场景：取消后
    //    重新完成打卡）；撤销语句在前执行，因此判重看到的是「已删除」后的状态，与最终落库一致。
    for (const r of events.revokes) {
      if (r.refId) revokeRefIds.add(r.refId)
      if (r.refPrefix) revokePrefixes.add(r.refPrefix)
    }
    statements.push(...pointsRevokeStatements(ctx.env, ctx.userId, [...revokeRefIds], [...revokePrefixes]))
    const awards: PointsAward[] = [...events.awards, ...derived.awards]
    const existing = await readExistingRefIds(
      ctx.env,
      ctx.userId,
      awards.map((a) => a.refId)
    )
    // 同批 refPrefix 撤销覆盖到的 refId 同样以本次发放为准（前缀撤销删掉旧流水后需重新写入）
    const newAwards = awards.filter(
      (a) =>
        !existing.has(a.refId) || revokeRefIds.has(a.refId) || [...revokePrefixes].some((p) => a.refId.startsWith(p))
    )
    statements.push(...pointsAwardStatements(ctx.env, ctx.userId, newAwards))
    statements.push(...derived.statements)

    // 7. 权威投影：points = SUM(points_log.points)；派生过 streak 时一并写回（同批，无中间态）
    if (newAwards.length || revokeRefIds.size || revokePrefixes.size || derived.streak)
      statements.push(gamificationProjectionStatement(ctx.env, ctx.userId, derived.streak ?? undefined))

    // 7b. 成就集合并集（设计 §5.1/§5.2）：规则留在客户端（`checkAchievements()`），以**事件**传输解锁结果；
    //     服务端只负责「只增不减」的并集落库——读现存列表（保持已有顺序）→ 追加本次新解锁 id → 同一 batch 写回。
    //     幂等：重复推送同一批 id 结果不变；与上面的积分投影语句各写各的列，同批互不覆盖。
    if (achievements.length) {
      const merged = mergeAchievements(await getAchievements(ctx.env, ctx.userId), achievements)
      if (merged.length > MAX_ACHIEVEMENTS) throw new HttpError(400, `成就列表合并后不能超过 ${MAX_ACHIEVEMENTS} 项`)
      statements.push(achievementsMergeStatement(ctx.env, ctx.userId, merged))
    }

    // 8. 单 batch 原子提交（任一步失败整批回滚）
    await batch(ctx.env, statements)

    // 9. R2 对象清理：主 batch 成功后再删，避免「对象已删、记录仍在」；对象不存在时删除为无操作
    for (const key of r2Keys) await ctx.env.IMAGES.delete(key).catch((e) => console.error('R2 删除失败', key, e))

    return Response.json({
      ok: true,
      versions,
      applied,
      deletes,
      clamped,
      rejected,
      awarded: newAwards.map((a) => ({ points: a.points, reason: a.reason })),
      gamification: await getGamification(ctx.env, ctx.userId)
    })
  })

  on('POST', '/api/data/pull', true, async (ctx) => {
    // full=true 全量快照是全站最重的读端点（逐域 SELECT + 子树组装），与其他昂贵端点一样限流
    rateLimit(ctx.request, 'data:pull', 60)
    const payload = await pullBody(ctx.request)

    const cursorsRaw = payload?.cursors
    if (
      cursorsRaw !== undefined &&
      cursorsRaw !== null &&
      (typeof cursorsRaw !== 'object' || Array.isArray(cursorsRaw))
    )
      throw new HttpError(400, 'cursors 必须为对象')

    const cursors: Record<string, number> = {}
    for (const [domain, value] of Object.entries((cursorsRaw ?? {}) as Record<string, unknown>)) {
      if (!DOMAIN_SET.has(domain)) throw new HttpError(400, `游标域未知: ${domain}`)
      if (!isNonNegativeInt(value)) throw new HttpError(400, `域 ${domain} 的游标必须为非负整数`)
      cursors[domain] = value
    }

    // full=true 或未带游标 → 全量快照（首次 hydrate）
    const full = payload?.full === true || cursorsRaw === undefined || cursorsRaw === null
    return Response.json(
      full ? await pullSnapshot(ctx.env, ctx.userId) : await pullIncremental(ctx.env, ctx.userId, cursors)
    )
  })
}
