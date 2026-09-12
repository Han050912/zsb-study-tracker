import type { PointsEvent } from '../api/sync'

/**
 * 待推送队列（持久化 outbox，设计 §6.1）。
 *
 * - localStorage 按**用户分桶**（`zsb_sync_outbox_v1:<userId>`）：换账号不会串数据。
 * - 每次 stage 立即同步落盘（单条 < 1KB，不防抖）：刷新/崩溃/断网后仍可续传。
 * - 刷新顺序固定「先 pull 后 flush」（见 stores/app.ts 的 hydrate）：
 *   成功推送后 `ack` 只清除**值/时间戳与已推送快照一致**的条目，飞行期间的新编辑保留。
 * - 登出/切号调用 `clear()` 清空当前账号队列。
 *
 * 除设计 §6.1 的 API（stageUpsert/stageDelete/takeForFlush/ack/size/clear）外，
 * 另需 `setOutboxUser`（分桶绑定）与 `stagePoints`/`stageAchievements`
 * （积分事件与成就随 push 同一 batch 上报，必须与记录变更一起持久化）。
 */

const OUTBOX_KEY_PREFIX = 'zsb_sync_outbox_v1'

/** 暂存的一条 upsert：值 + 客户端编辑时刻（LWW 比较键） */
export interface OutboxUpsert {
  value: unknown
  updatedAt: number
}

/** 落盘结构 */
interface OutboxState {
  upserts: Record<string, Record<string, OutboxUpsert>>
  deletes: Record<string, Record<string, number>>
  points: PointsEvent[]
  achievements: string[]
  savedAt: number
}

/** `takeForFlush()` 返回的快照（ack 时按其中记录的值/时间戳判定「是否仍是同一条」） */
export interface OutboxSnapshot {
  upserts: Record<string, Record<string, OutboxUpsert>>
  deletes: Record<string, Record<string, number>>
  points: PointsEvent[]
  achievements: string[]
}

/** 当前绑定账号（未绑定 = 尚未登录/hydrate，stage 全部为无操作） */
let currentUserId: string | null = null
/** 内存缓存：与落盘内容一致，避免每次 stage 都重新解析 JSON */
let cache: OutboxState | null = null

function emptyState(): OutboxState {
  return { upserts: {}, deletes: {}, points: [], achievements: [], savedAt: 0 }
}

function storageKey(userId: string): string {
  return `${OUTBOX_KEY_PREFIX}:${userId}`
}

/** 绑定当前账号（登录/hydrate 时调用）；切换账号即丢弃内存缓存，改读新账号的落盘数据 */
export function setOutboxUser(userId: string | null): void {
  if (userId === currentUserId) return
  currentUserId = userId
  cache = null
}

function load(): OutboxState {
  if (!currentUserId) return emptyState()
  if (cache) return cache
  try {
    const raw = localStorage.getItem(storageKey(currentUserId))
    cache = raw ? (JSON.parse(raw) as OutboxState) : emptyState()
  } catch (e) {
    console.error('读取本地待推送队列失败，已重置', e)
    cache = emptyState()
  }
  return cache
}

/** 每次 stage 立即同步落盘（不做防抖，避免丢数据） */
function persist(state: OutboxState): void {
  if (!currentUserId) return
  state.savedAt = Date.now()
  try {
    localStorage.setItem(storageKey(currentUserId), JSON.stringify(state))
  } catch (e) {
    console.error('写入本地待推送队列失败', e)
  }
}

/**
 * 暂存一条 upsert。
 * 同 key 若存在待推送 delete 则一并清除：同一条记录不能同时被 upsert 与 delete（服务端会 400），
 * 以最后一次操作为准。
 */
export function stageUpsert(domain: string, key: string, value: unknown, updatedAt: number): void {
  if (!currentUserId) return
  const state = load()
  if (state.deletes[domain]) delete state.deletes[domain][key]
  const bucket = (state.upserts[domain] ??= {})
  bucket[key] = { value, updatedAt }
  persist(state)
}

/** 暂存一条删除墓碑（同 key 的待推送 upsert 一并清除，理由同 stageUpsert） */
export function stageDelete(domain: string, key: string, deletedAt: number): void {
  if (!currentUserId) return
  const state = load()
  if (state.upserts[domain]) delete state.upserts[domain][key]
  const bucket = (state.deletes[domain] ??= {})
  bucket[key] = deletedAt
  persist(state)
}

/** 暂存一条积分事件（award/revoke；服务端按 refId 幂等，重复推送安全） */
export function stagePoints(event: PointsEvent): void {
  if (!currentUserId) return
  const state = load()
  state.points.push(event)
  persist(state)
}

/** 暂存成就解锁 id（服务端只做只增不减并集，重复推送无副作用） */
export function stageAchievements(ids: string[]): void {
  if (!currentUserId || !ids.length) return
  const state = load()
  for (const id of ids) if (!state.achievements.includes(id)) state.achievements.push(id)
  persist(state)
}

/** 深拷贝当前队列（快照与内存对象解耦，ack 时才能据此判别「飞行期间的新编辑」） */
function cloneSnapshot(state: OutboxState): OutboxSnapshot {
  return JSON.parse(
    JSON.stringify({
      upserts: state.upserts,
      deletes: state.deletes,
      points: state.points,
      achievements: state.achievements
    })
  ) as OutboxSnapshot
}

/** 取出待推送快照；队列为空返回 null（调用方据此跳过网络请求） */
export function takeForFlush(): OutboxSnapshot | null {
  const state = load()
  if (!size()) return null
  return cloneSnapshot(state)
}

/** 从当前积分事件里移除「已推送快照中」的同等条目（各移除一条，允许多次相同事件） */
function removeSentEvents(current: PointsEvent[], sent: PointsEvent[]): PointsEvent[] {
  const remaining = [...current]
  for (const event of sent) {
    const i = remaining.findIndex((c) => JSON.stringify(c) === JSON.stringify(event))
    if (i >= 0) remaining.splice(i, 1)
  }
  return remaining
}

/**
 * 确认已推送的快照：**只清除「值/时间戳与快照一致」的条目**——
 * 若条目在飞行期间被重新编辑（updatedAt 或 value 变了），保留待下次推送，避免丢数据。
 */
export function ack(snapshot: OutboxSnapshot): void {
  if (!currentUserId) return
  const state = load()

  for (const [domain, bucket] of Object.entries(snapshot.upserts)) {
    const current = state.upserts[domain]
    if (!current) continue
    for (const [key, sent] of Object.entries(bucket)) {
      const entry = current[key]
      if (entry && entry.updatedAt === sent.updatedAt && JSON.stringify(entry.value) === JSON.stringify(sent.value)) {
        delete current[key]
      }
    }
    if (!Object.keys(current).length) delete state.upserts[domain]
  }

  for (const [domain, bucket] of Object.entries(snapshot.deletes)) {
    const current = state.deletes[domain]
    if (!current) continue
    for (const [key, sent] of Object.entries(bucket)) if (current[key] === sent) delete current[key]
    if (!Object.keys(current).length) delete state.deletes[domain]
  }

  state.points = removeSentEvents(state.points, snapshot.points)
  state.achievements = state.achievements.filter((id) => !snapshot.achievements.includes(id))

  persist(state)
}

/** 待推送条目数（upserts + deletes + 积分事件 + 成就） */
export function size(): number {
  const state = load()
  let n = state.points.length + state.achievements.length
  for (const bucket of Object.values(state.upserts)) n += Object.keys(bucket).length
  for (const bucket of Object.values(state.deletes)) n += Object.keys(bucket).length
  return n
}

/** 清空当前账号的待推送队列（登出/切号调用，避免串号） */
export function clear(): void {
  if (currentUserId) {
    try {
      localStorage.removeItem(storageKey(currentUserId))
    } catch (e) {
      console.error('清除本地待推送队列失败', e)
    }
  }
  cache = emptyState()
}
