import { ref } from 'vue'
import type { PointsEvent } from '../api/sync'

/** Independent operation keys prevent another tab from overwriting or ACKing a later edit. */
const PREFIX = 'zsb_sync_outbox_v2:'
const LEGACY_PREFIX = 'zsb_sync_outbox_v1:'
export interface OutboxUpsert {
  value: unknown
  updatedAt: number
}
export interface OutboxSnapshot {
  upserts: Record<string, Record<string, OutboxUpsert>>
  deletes: Record<string, Record<string, number>>
  points: PointsEvent[]
  achievements: string[]
  receipt?: { userId: string; keys: string[] }
}
type Change =
  | { kind: 'upsert'; domain: string; key: string; value: unknown; updatedAt: number }
  | { kind: 'delete'; domain: string; key: string; updatedAt: number }
  | { kind: 'points'; event: PointsEvent }
  | { kind: 'achievements'; ids: string[] }
type Operation = Change & { order: number }
let currentUserId: string | null = null
let lastOrder = 0
// Only failed writes stay in memory; persisted operations are always read from shared storage.
const volatile = new Map<string, Operation>()
const readIssues = new Map<string, string>()
export const outboxIssue = ref<string | null>(null)
const prefixFor = (userId: string) => `${PREFIX}${encodeURIComponent(userId)}:`
const emptySnapshot = (): OutboxSnapshot => ({ upserts: {}, deletes: {}, points: [], achievements: [] })

function updateIssue() {
  outboxIssue.value = currentUserId
    ? hasVolatileOutboxChanges()
      ? '本地存储不可用，部分修改仅保留在当前页面。请保持页面打开并重试同步。'
      : (readIssues.get(currentUserId) ?? null)
    : null
}

export function hasVolatileOutboxChanges(allAccounts = false): boolean {
  if (allAccounts) return volatile.size > 0
  return !!currentUserId && [...volatile.keys()].some((key) => key.startsWith(prefixFor(currentUserId!)))
}

function persist(key: string, operation: Operation): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(operation))
    volatile.delete(key)
    return true
  } catch {
    volatile.set(key, operation)
    return false
  }
}

/** Stable migration IDs make retries and migration by two tabs idempotent. */
function fingerprint(text: string): string {
  let a = 2166136261,
    b = 5381
  for (let i = 0; i < text.length; i++) {
    a = Math.imul(a ^ text.charCodeAt(i), 16777619)
    b = Math.imul(b, 33) ^ text.charCodeAt(i)
  }
  return `${(a >>> 0).toString(36)}-${(b >>> 0).toString(36)}-${text.length}`
}

function migrate(userId: string) {
  const legacyKey = `${LEGACY_PREFIX}${userId}`
  const raw = localStorage.getItem(legacyKey)
  if (!raw) return
  const old = JSON.parse(raw) as OutboxSnapshot & { savedAt?: number }
  if (!old || !old.upserts || !old.deletes || !Array.isArray(old.points) || !Array.isArray(old.achievements))
    throw new Error('Invalid legacy outbox')
  const changes: Change[] = []
  for (const [domain, bucket] of Object.entries(old.upserts))
    for (const [key, entry] of Object.entries(bucket)) changes.push({ kind: 'upsert', domain, key, ...entry })
  for (const [domain, bucket] of Object.entries(old.deletes))
    for (const [key, updatedAt] of Object.entries(bucket)) changes.push({ kind: 'delete', domain, key, updatedAt })
  for (const event of old.points) changes.push({ kind: 'points', event })
  if (old.achievements.length) changes.push({ kind: 'achievements', ids: old.achievements })
  const migration = `${prefixFor(userId)}legacy-${fingerprint(raw)}-`
  let complete = true
  changes.forEach((change, index) => {
    const order = (Number(old.savedAt) || 0) * 1000 + index
    if (!persist(`${migration}${index}`, { ...change, order })) complete = false
  })
  // Partial failure keeps the original bucket; retry uses exactly the same operation keys.
  if (complete && localStorage.getItem(legacyKey) === raw) localStorage.removeItem(legacyKey)
}

function validOperation(value: unknown): value is Operation {
  if (!value || typeof value !== 'object') return false
  const op = value as Operation
  if (!Number.isFinite(op.order)) return false
  if (op.kind === 'points') return !!op.event && ['award', 'revoke'].includes(op.event.op)
  if (op.kind === 'achievements') return Array.isArray(op.ids) && op.ids.every((id) => typeof id === 'string')
  return (
    (op.kind === 'upsert' || op.kind === 'delete') &&
    typeof op.domain === 'string' &&
    typeof op.key === 'string' &&
    Number.isFinite(op.updatedAt)
  )
}

function operations(userId: string): [string, Operation][] {
  const found = new Map<string, Operation>()
  const prefix = prefixFor(userId)
  readIssues.delete(userId)
  try {
    migrate(userId)
    // Read a key snapshot first: another tab may remove an ACKed value during the scan.
    const keys: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith(prefix)) keys.push(key)
    }
    for (const key of keys) {
      const raw = localStorage.getItem(key)
      if (!raw) continue
      try {
        const operation: unknown = JSON.parse(raw)
        if (!validOperation(operation)) throw new Error('Invalid outbox operation')
        found.set(key, operation)
      } catch {
        readIssues.set(userId, '部分本地待同步记录无法读取，已保留原数据，请导出备份并联系管理员。')
      }
    }
  } catch {
    readIssues.set(userId, '无法读取本地待同步记录，原数据未删除。请检查浏览器存储并重试。')
  }
  for (const [key, operation] of volatile) {
    if (!key.startsWith(prefix)) continue
    persist(key, operation)
    found.set(key, operation)
  }
  updateIssue()
  const result = [...found].sort(([ka, a], [kb, b]) => a.order - b.order || ka.localeCompare(kb))
  for (const [, operation] of result) lastOrder = Math.max(lastOrder, operation.order)
  return result
}

export function setOutboxUser(userId: string | null): void {
  currentUserId = userId
  if (userId) operations(userId)
  updateIssue()
}

function append(change: Change) {
  if (!currentUserId) return
  // This shared clock is only an ordering hint, never a queue or ACK source. Concurrent
  // allocations may tie (the operation ID breaks ties); sequential writes observe the clock.
  // Keeping it separate avoids re-reading the complete journal for every imported record.
  const clockKey = `zsb_sync_outbox_order_v2:${encodeURIComponent(currentUserId)}`
  try {
    const sharedOrder = Number(localStorage.getItem(clockKey))
    if (Number.isSafeInteger(sharedOrder)) lastOrder = Math.max(lastOrder, sharedOrder)
  } catch {
    // The operation's own durable write below reports any storage failure to the user.
  }
  lastOrder = Math.max(Date.now() * 1000, lastOrder + 1)
  try {
    localStorage.setItem(clockKey, String(lastOrder))
  } catch {
    /* Nonessential ordering hint. */
  }
  // Detach Vue proxies and mutable state before recording an immutable operation.
  const operation = JSON.parse(JSON.stringify({ ...change, order: lastOrder })) as Operation
  persist(`${prefixFor(currentUserId)}${crypto.randomUUID()}`, operation)
  updateIssue()
}

export function stageUpsert(domain: string, key: string, value: unknown, updatedAt: number): void {
  append({ kind: 'upsert', domain, key, value, updatedAt })
}
export function stageDelete(domain: string, key: string, updatedAt: number): void {
  append({ kind: 'delete', domain, key, updatedAt })
}
export function stagePoints(event: PointsEvent): void {
  append({ kind: 'points', event })
}
export function stageAchievements(ids: string[]): void {
  if (ids.length) append({ kind: 'achievements', ids })
}

interface FlushBatchOptions {
  /** Restrict a drain to operations present at its start; later edits belong to the next drain. */
  keys: ReadonlySet<string>
  maxChanges: number
  maxBytes: number
}

export function takeForFlush(options?: FlushBatchOptions): OutboxSnapshot | null {
  if (!currentUserId) return null
  let entries = operations(currentUserId).filter(([key]) => !options || options.keys.has(key))
  if (!entries.length) return null
  if (options) {
    // Keep all revisions of one business key together so ACK cannot expose an older queued edit.
    const records = new Map<string, [string, Operation][]>()
    const events: [string, Operation][][] = []
    for (const entry of entries) {
      const operation = entry[1]
      if (operation.kind === 'upsert' || operation.kind === 'delete') {
        const identity = JSON.stringify([operation.domain, operation.key])
        const revisions = records.get(identity) ?? []
        revisions.push(entry)
        records.set(identity, revisions)
      } else events.push([entry])
    }
    const selected: [string, Operation][] = []
    const encoder = new TextEncoder()
    let count = 0,
      bytes = 0
    // Points intents follow records. In particular, a pomodoro completion must never be ACKed
    // before its record is persisted; when space permits, the final records and events share a batch.
    for (const revisions of [...records.values(), ...events]) {
      const operation = revisions[revisions.length - 1][1]
      const cost = encoder.encode(JSON.stringify(operation)).byteLength + 256
      if (count && (count >= options.maxChanges || bytes + cost > options.maxBytes)) break
      // An individually large subject tree still gets one attempt; the server validates its limit.
      selected.push(...revisions)
      count++
      bytes += cost
    }
    entries = selected
  }
  const snapshot = emptySnapshot()
  const winners = new Map<string, Operation & { kind: 'upsert' | 'delete' }>()
  const achievements = new Set<string>()
  for (const [, operation] of entries) {
    if (operation.kind === 'points') snapshot.points.push(operation.event)
    else if (operation.kind === 'achievements') operation.ids.forEach((id) => achievements.add(id))
    else {
      const identity = JSON.stringify([operation.domain, operation.key])
      // Match stage's last-operation semantics (including restore/import delete-then-upsert).
      // Server LWW still decides whether the resulting version may replace cloud data.
      winners.set(identity, operation)
    }
  }
  for (const op of winners.values()) {
    if (op.kind === 'upsert') {
      const bucket = (snapshot.upserts[op.domain] ??= Object.create(null))
      bucket[op.key] = { value: op.value, updatedAt: op.updatedAt }
    } else {
      const bucket = (snapshot.deletes[op.domain] ??= Object.create(null))
      bucket[op.key] = op.updatedAt
    }
  }
  snapshot.achievements = [...achievements]
  snapshot.receipt = { userId: currentUserId, keys: entries.map(([key]) => key) }
  return snapshot
}

export function ack(snapshot: OutboxSnapshot): void {
  const receipt = snapshot.receipt
  if (!receipt || receipt.userId !== currentUserId) return
  for (const key of receipt.keys) {
    if (!key.startsWith(prefixFor(receipt.userId))) continue
    try {
      localStorage.removeItem(key)
    } catch {
      readIssues.set(receipt.userId, '已同步，但本地队列清理失败，下次将安全重试。')
    }
    volatile.delete(key)
  }
  updateIssue()
}

export function size(): number {
  const snapshot = takeForFlush()
  if (!snapshot) return 0
  return (
    snapshot.points.length +
    snapshot.achievements.length +
    Object.values(snapshot.upserts).reduce((n, bucket) => n + Object.keys(bucket).length, 0) +
    Object.values(snapshot.deletes).reduce((n, bucket) => n + Object.keys(bucket).length, 0)
  )
}
