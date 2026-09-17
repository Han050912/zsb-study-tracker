import type { AppState } from '../types'
import type { DomainChanges, SyncDeletion } from '../api/sync'
import type { OutboxUpsert } from './syncOutbox'
import { createDefaultState } from '../data/defaults'

/**
 * 记录级同步的域形状注册表（设计 §3.3 键空间 / §4.1 与 §4.2 载荷形状）。
 *
 * 覆盖除 `gamification`（服务端权威，客户端不可写）外的 13 个域，职责有二：
 * 1. `serializeChanges`：把 outbox 里某域的暂存变更组装成 push 载荷的 `{ upserts, deletes }`；
 * 2. `applyChanges`：把 pull 返回的 `{ upserts, deletes }` 按**记录级 LWW + 墓碑**合并进 Pinia state。
 *
 * 记录级 LWW 判定（设计 §4.3 的客户端镜像，实现见 `shouldApply`）：
 * - 本地缺失 → 应用；
 * - 本地打戳为 0（默认数据 / 存量旧数据）→ 应用（服务端为初始来源）；
 * - `incoming.updatedAt > 本地 updatedAt` → 覆盖；否则保留本地（本地有更新的未推送编辑）。
 * 墓碑：`deletedAt > 本地 updatedAt`（或本地缺失）→ 删除本地记录；否则保留本地。
 *
 * 本地 LWW 时间戳统一存放在记录自身的 `updatedAt` 字段上（`Note.updatedAt` 语义相同，直接复用）。
 */

/** 域形状：raw = 拉取 upserts 为记录本身（键取记录自身 id）；wrapped = `{ key, value, updatedAt }` */
export type DomainShape = 'raw' | 'wrapped'

/** 各域形状（与 worker/src/api/sync.ts 的 DomainStrategy.shape 一一对应） */
export const DOMAIN_SHAPES: Record<string, DomainShape> = {
  records: 'raw',
  problemSessions: 'raw',
  errorQuestions: 'raw',
  exams: 'raw',
  notes: 'raw',
  materials: 'raw',
  todos: 'raw',
  subjects: 'wrapped',
  habits: 'wrapped',
  summaries: 'wrapped',
  settings: 'wrapped',
  pomodoro: 'wrapped',
  english: 'wrapped'
}

/** 判定新用户时忽略 settings（注册即建行，恒有变更），见 stores/app.ts */
export const DATA_DOMAINS: readonly string[] = Object.keys(DOMAIN_SHAPES).filter((d) => d !== 'settings')

/** english 子集合前缀（服务端键空间）→ AppState.english 字段名 */
const ENGLISH_COLLECTIONS: Record<string, 'vocab' | 'reading' | 'listening' | 'templates'> = {
  vocab: 'vocab',
  reading: 'reading',
  listening: 'listening',
  template: 'templates'
}

/** push 载荷里单域的变更 */
export interface DomainPushChanges {
  upserts: unknown[]
  deletes: SyncDeletion[]
}

// ---------- 序列化：outbox → push 载荷 ----------

/** outbox 里某域的一条 upsert → push 载荷元素（null = 该条无需传输） */
function serializeUpsert(domain: string, key: string, entry: OutboxUpsert): unknown | null {
  if (DOMAIN_SHAPES[domain] === 'raw') {
    // 单表数组域：元素即记录本身，updatedAt 合入记录对象
    return { ...(entry.value as Record<string, unknown>), updatedAt: entry.updatedAt }
  }
  if (domain === 'pomodoro' && key.startsWith('itr:')) {
    // 该键代表「某一天的全部打断」：单条元素只需 { reason, time }（日期由键承载）；
    // 空列表不参与传输（前端打断列表只增不减，不存在「该日列表被清空」的语义）
    const items = Array.isArray(entry.value) ? (entry.value as Record<string, unknown>[]) : []
    const list = items
      .filter((it) => it && typeof it.reason === 'string' && Number.isInteger(it.time))
      .map((it) => ({ reason: it.reason, time: it.time }))
    if (!list.length) return null
    return { key, value: list, updatedAt: entry.updatedAt }
  }
  return { key, value: entry.value, updatedAt: entry.updatedAt }
}

/** 把 outbox 中某域的暂存变更序列化为 push 载荷（设计 §4.1） */
export function serializeChanges(
  domain: string,
  upserts: Record<string, OutboxUpsert>,
  deletes: Record<string, number>
): DomainPushChanges {
  const out: DomainPushChanges = { upserts: [], deletes: [] }
  for (const [key, entry] of Object.entries(upserts)) {
    const item = serializeUpsert(domain, key, entry)
    if (item) out.upserts.push(item)
  }
  for (const [key, deletedAt] of Object.entries(deletes)) out.deletes.push({ key, deletedAt })
  return out
}

// ---------- LWW 判定 ----------

/** 本地记录的 LWW 时间戳（未打戳的默认/存量旧数据返回 0） */
export function readRecordUpdatedAt(record: unknown): number {
  const v = record && typeof record === 'object' ? (record as { updatedAt?: unknown }).updatedAt : undefined
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

/** 记录级 LWW：本地缺失 / 本地打戳为 0 / 服务端更新 → 采用服务端记录；否则保留本地 */
function shouldApply(incomingUpdatedAt: number, local: unknown): boolean {
  if (local === undefined || local === null) return true
  const localStamp = readRecordUpdatedAt(local)
  return localStamp === 0 || incomingUpdatedAt > localStamp
}

/** 给记录附加 LWW 时间戳（仅运行时字段，不进入业务类型定义） */
function stamped<T extends object>(record: T, updatedAt: number): T {
  return Object.assign(record, { updatedAt })
}

/** 按 id 的记录级 LWW 合并（值就地替换以保持数组顺序，新记录追加到末尾） */
function mergeArrayById(target: unknown[], upserts: unknown[], deletes: SyncDeletion[]): number {
  const list = target as { id?: string }[]
  let changed = 0
  for (const incoming of upserts as { id?: string }[]) {
    const idx = list.findIndex((r) => r && r.id === incoming.id)
    if (idx < 0) {
      list.push(incoming)
      changed++
    } else if (shouldApply(readRecordUpdatedAt(incoming), list[idx])) {
      list[idx] = incoming
      changed++
    }
  }
  for (const tomb of deletes) {
    const idx = list.findIndex((r) => r && r.id === tomb.key)
    if (idx >= 0 && shouldApply(tomb.deletedAt, list[idx])) {
      list.splice(idx, 1)
      changed++
    }
  }
  return changed
}

/** 展开 wrapped 元素为「记录 + updatedAt」（值必为对象） */
function unwrapWrapped(raw: unknown): Record<string, unknown> {
  const item = (raw ?? {}) as { value?: Record<string, unknown>; updatedAt?: number }
  return { ...(item.value ?? {}), updatedAt: item.updatedAt }
}

// ---------- 反序列化：pull 载荷 → Pinia state ----------

/** english：4 个子集合按 `vocab:<id>` / `reading:<id>` / `listening:<id>` / `template:<id>` 合并 */
function applyEnglish(state: AppState, changes: DomainChanges): number {
  let changed = 0
  for (const raw of changes.upserts) {
    const key = String((raw as { key?: string })?.key ?? '')
    const i = key.indexOf(':')
    const collection = ENGLISH_COLLECTIONS[key.slice(0, i)]
    if (!collection) continue
    const record = unwrapWrapped(raw)
    const list = state.english[collection] as unknown[]
    const idx = list.findIndex((r) => (r as { id?: string })?.id === record.id)
    if (idx < 0) {
      list.push(record)
      changed++
    } else if (shouldApply(readRecordUpdatedAt(record), list[idx])) {
      list[idx] = record
      changed++
    }
  }
  for (const tomb of changes.deletes) {
    const i = tomb.key.indexOf(':')
    const collection = ENGLISH_COLLECTIONS[tomb.key.slice(0, i)]
    if (!collection) continue
    const id = tomb.key.slice(i + 1)
    const list = state.english[collection] as unknown[]
    const idx = list.findIndex((r) => (r as { id?: string })?.id === id)
    if (idx >= 0 && shouldApply(tomb.deletedAt, list[idx])) {
      list.splice(idx, 1)
      changed++
    }
  }
  return changed
}

/** summaries：键 = 日期，值为当天的 DailySummary */
function applySummaries(state: AppState, changes: DomainChanges): number {
  const map = state.summaries as Record<string, unknown>
  let changed = 0
  for (const raw of changes.upserts) {
    const item = (raw ?? {}) as { key?: string; value?: Record<string, unknown>; updatedAt?: number }
    if (!item.key) continue
    if (!shouldApply(item.updatedAt ?? 0, map[item.key])) continue
    map[item.key] = stamped({ ...(item.value ?? {}) }, item.updatedAt ?? 0)
    changed++
  }
  for (const tomb of changes.deletes) {
    if (!(tomb.key in map)) continue
    if (!shouldApply(tomb.deletedAt, map[tomb.key])) continue
    delete map[tomb.key]
    changed++
  }
  return changed
}

/** settings：单行记录（键固定 self，多设备同时修改会整体覆盖，与现状同级） */
function applySettings(state: AppState, changes: DomainChanges): number {
  let changed = 0
  for (const raw of changes.upserts) {
    const item = (raw ?? {}) as { key?: string; value?: Record<string, unknown>; updatedAt?: number }
    if (item.key !== 'self') continue
    if (!shouldApply(item.updatedAt ?? 0, state.settings)) continue
    // 服务端快照不回传 maimemoToken 明文：Object.assign 保留本地已填写的 Token
    Object.assign(state.settings, item.value ?? {})
    ;(state.settings as unknown as Record<string, unknown>).updatedAt = item.updatedAt ?? 0
    changed++
  }
  for (const tomb of changes.deletes) {
    if (tomb.key !== 'self') continue
    if (!shouldApply(tomb.deletedAt, state.settings)) continue
    // 设置被删除：回退为默认设置（保留本地 Token 无意义——服务端记录已不存在）
    Object.assign(state.settings, createDefaultState().settings)
    delete (state.settings as unknown as Record<string, unknown>).updatedAt
    changed++
  }
  return changed
}

/** 某日打断列表的本地 LWW 时间戳 = 当日打断行的最大 updatedAt（无则 0） */
function maxInterruptionStamp(interruptions: { date: string }[], date: string): number {
  let max = 0
  for (const it of interruptions) if (it.date === date) max = Math.max(max, readRecordUpdatedAt(it))
  return max
}

/** pomodoro：三键空间 —— `day:<date>`（日统计）/ `itr:<date>`（该日打断列表）/ `rec:<id>`（单条记录） */
function applyPomodoro(state: AppState, changes: DomainChanges): number {
  const pomodoro = state.pomodoro
  let changed = 0

  for (const raw of changes.upserts) {
    const item = (raw ?? {}) as { key?: string; value?: unknown; updatedAt?: number }
    const key = item.key ?? ''
    const i = key.indexOf(':')
    const kind = key.slice(0, i)
    const rest = key.slice(i + 1)
    const updatedAt = item.updatedAt ?? 0
    if (!rest) continue

    if (kind === 'day') {
      const value = (item.value ?? {}) as { count?: number; minutes?: number; interruptions?: number }
      if (!shouldApply(updatedAt, pomodoro.daily[rest])) continue
      pomodoro.daily[rest] = stamped(
        { count: value.count ?? 0, minutes: value.minutes ?? 0, interruptions: value.interruptions ?? 0 },
        updatedAt
      )
      changed++
      continue
    }

    if (kind === 'itr') {
      // 消费者契约（设计 §4.2）：该键代表某日的全部打断 → **整体替换**该日列表（非追加、非逐条合并）
      const local = maxInterruptionStamp(pomodoro.interruptions, rest)
      const hasLocal = pomodoro.interruptions.some((it) => it.date === rest)
      // 本地无该日打断 / 本地未打戳 / 服务端更新 → 接受；否则保留本地（本地是更新的编辑）
      if (hasLocal && local !== 0 && updatedAt <= local) continue
      const others = pomodoro.interruptions.filter((it) => it.date !== rest)
      const items = (Array.isArray(item.value) ? (item.value as Record<string, unknown>[]) : []).map((it) =>
        stamped({ date: rest, reason: String(it.reason ?? ''), time: Number(it.time) }, updatedAt)
      )
      pomodoro.interruptions = [...others, ...items]
      changed++
      continue
    }

    if (kind === 'rec') {
      const incoming = stamped({ ...((item.value ?? {}) as Record<string, unknown>), id: rest }, updatedAt)
      const idx = pomodoro.records.findIndex((r) => r.id === rest)
      if (idx < 0) {
        pomodoro.records.push(incoming as (typeof pomodoro.records)[number])
        changed++
      } else if (shouldApply(updatedAt, pomodoro.records[idx])) {
        pomodoro.records[idx] = incoming as (typeof pomodoro.records)[number]
        changed++
      }
    }
  }

  for (const tomb of changes.deletes) {
    const i = tomb.key.indexOf(':')
    const kind = tomb.key.slice(0, i)
    const rest = tomb.key.slice(i + 1)
    if (!rest) continue

    if (kind === 'day') {
      const local = pomodoro.daily[rest]
      if (local !== undefined && shouldApply(tomb.deletedAt, local)) {
        delete pomodoro.daily[rest]
        changed++
      }
    } else if (kind === 'itr') {
      const local = maxInterruptionStamp(pomodoro.interruptions, rest)
      const hasLocal = pomodoro.interruptions.some((it) => it.date === rest)
      if (hasLocal && (local === 0 || tomb.deletedAt > local)) {
        pomodoro.interruptions = pomodoro.interruptions.filter((it) => it.date !== rest)
        changed++
      }
    } else if (kind === 'rec') {
      const idx = pomodoro.records.findIndex((r) => r.id === rest)
      if (idx >= 0 && shouldApply(tomb.deletedAt, pomodoro.records[idx])) {
        pomodoro.records.splice(idx, 1)
        changed++
      }
    }
  }

  return changed
}

/**
 * 把 pull 返回的某域变更合并进本地 state（记录级 LWW + 墓碑，设计 §4.3 的客户端镜像）。
 * 返回本次实际合入的条数（供「立即同步」的结果提示）。
 */
export function applyChanges(domain: string, state: AppState, changes: DomainChanges): number {
  switch (domain) {
    case 'records':
    case 'problemSessions':
    case 'errorQuestions':
    case 'exams':
    case 'notes':
    case 'materials':
    case 'todos':
      return mergeArrayById(state[domain] as unknown[], changes.upserts, changes.deletes)
    case 'subjects':
    case 'habits':
      // 复杂域为 wrapped：值即记录（科目整树 / 习惯含打卡 map），id 在值内
      return mergeArrayById(state[domain] as unknown[], changes.upserts.map(unwrapWrapped), changes.deletes)
    case 'english':
      return applyEnglish(state, changes)
    case 'summaries':
      return applySummaries(state, changes)
    case 'settings':
      return applySettings(state, changes)
    case 'pomodoro':
      return applyPomodoro(state, changes)
    default:
      return 0
  }
}

// ---------- T6 打点工具 ----------

/**
 * 本地记录 → 域键（设计 §3.3 键空间）。
 * - `english` 需传集合前缀 kind（vocab/reading/listening/template）
 * - `pomodoro` 需传 kind（day/itr/rec）；day 与 itr 取记录的 `date`，rec 取 `id`
 * - 其余域：数组域与 subjects/habits 取 `record.id`；summaries 取 `record.date`；settings 固定 `self`
 */
export function recordKeyOf(domain: string, record: Record<string, unknown>, kind?: string): string {
  switch (domain) {
    case 'english':
      return `${kind}:${String(record.id)}`
    case 'pomodoro':
      if (kind === 'day') return `day:${String(record.date)}`
      if (kind === 'itr') return `itr:${String(record.date)}`
      return `rec:${String(record.id)}`
    case 'summaries':
      return String(record.date)
    case 'settings':
      return 'self'
    default:
      return String(record.id)
  }
}

/** 本地记录 → `{ key, value }`（value 即记录本身；updatedAt 由 serializeChanges 合入载荷） */
export function toStagedRecord(
  domain: string,
  record: Record<string, unknown>,
  kind?: string
): { key: string; value: unknown } {
  return { key: recordKeyOf(domain, record, kind), value: record }
}
