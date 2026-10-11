import { computed, ref } from 'vue'
import type { Note } from '../types'
import { fetchNoteBodyLimit, pullNoteBodies, putNoteBody } from '../api/noteBodies'

interface CachedNoteBody {
  key: string
  userId: string
  noteId: string
  content: string
  updatedAt: number
  dirty: boolean
  /** 冲突副本只保存在本机，不进入正文同步通道。 */
  conflictOf?: string
  conflictCreatedAt?: number
  /** 恢复备份的内容在冲突时保留，直到正文和元数据均被确认。 */
  restorationPending?: boolean
  /**
   * 已知永远不会被服务端接受的原因（超过上限等）；null = 可推送。
   * 这类正文不再重试（重试只会重复被拒），但只要正文被改动就会重新判定。
   */
  unsyncable: string | null
}

const DB_NAME = 'zsb-note-bodies-v1'
const STORE_NAME = 'bodies'
const PULL_BATCH = 50

let activeUserId: string | null = null
let userGeneration = 0
let dbPromise: Promise<IDBDatabase> | null = null
const cache = new Map<string, CachedNoteBody>()
const conflicts = new Map<string, CachedNoteBody>()
const searchIndex = new Map<string, string>()
const pendingWrites = new Set<Promise<void>>()
// 按账号保留未落盘的完整正文；被其它标签页强制登出时，也不能把它随界面状态清空。
const unpersisted = new Map<string, CachedNoteBody>()
const failedWrites = new Set<string>()
let retryFlight: Promise<boolean> | null = null

/**
 * 服务端权威的单篇正文上限（字节），由 `GET /api/note-bodies/limit` 随登录载入。
 * 0 = 尚未取到（离线等）：此时不做本地拦截，交由服务端 413 兜底。
 */
let maxBytes = 0

/** 搜索/摘要消费者读取此版本，以便缓存异步变化后重新计算。 */
export const noteBodyIndexVersion = ref(0)

function cacheKey(userId: string, noteId: string): string {
  return `${userId}:${noteId}`
}

/**
 * 正文超限校验（上限值来自服务端，唯一定义在此）：超限返回面向用户的提示文案，否则返回 null。
 * 入库时的标记与界面上的输入/保存提示共用同一判定与文案——界面不要另写一份上限或提示语。
 * 上限未取到（离线等）时返回 null：本地不拦，由服务端 413 兜底。
 */
export function noteBodyOversizeMessage(content: string): string | null {
  if (maxBytes <= 0) return null
  if (new TextEncoder().encode(content).byteLength <= maxBytes) return null
  return `正文超过 ${sizeText(maxBytes)} 上限，请拆分或改用文件导入`
}

function sizeText(bytes: number): string {
  return bytes % (1024 * 1024) === 0 ? `${bytes / (1024 * 1024)}MB` : `${Math.ceil(bytes / 1024)}KB`
}

function openDatabase(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('本机笔记存储不可用'))
  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    let abandoned = false
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'key' })
        store.createIndex('userId', 'userId', { unique: false })
      }
    }
    request.onsuccess = () => {
      const db = request.result
      if (abandoned) {
        db.close()
        return
      }
      db.onversionchange = () => {
        db.close()
        dbPromise = null
      }
      resolve(db)
    }
    request.onblocked = () => {
      abandoned = true
      reject(new Error('本机笔记存储被其他页面占用，请关闭其他页面后重试'))
    }
    request.onerror = () => {
      reject(request.error ?? new Error('无法打开本机笔记存储'))
    }
  })
  dbPromise = opening
  void opening.catch(() => {
    if (dbPromise === opening) dbPromise = null
  })
  return dbPromise
}

async function rowsForUser(userId: string): Promise<CachedNoteBody[]> {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).index('userId').getAll(userId)
    request.onsuccess = () => resolve(request.result as CachedNoteBody[])
    request.onerror = () => reject(request.error)
  })
}

async function writeRow(row: CachedNoteBody): Promise<void> {
  const db = await openDatabase()
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite')
    transaction.objectStore(STORE_NAME).put(row)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  })
}

async function deleteRow(userId: string, noteId: string): Promise<void> {
  const db = await openDatabase()
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite')
    transaction.objectStore(STORE_NAME).delete(cacheKey(userId, noteId))
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  })
}

function track(write: Promise<void>): void {
  pendingWrites.add(write)
  void write.catch((error) => console.error('写入笔记正文缓存失败', error)).finally(() => pendingWrites.delete(write))
}

function persistRow(row: CachedNoteBody): void {
  unpersisted.set(row.key, row)
  failedWrites.delete(row.key)
  noteBodyIndexVersion.value++
  const write = writeRow(row)
    .then(() => {
      if (unpersisted.get(row.key) === row) {
        unpersisted.delete(row.key)
        failedWrites.delete(row.key)
      }
    })
    .catch((error) => {
      if (unpersisted.get(row.key) === row) failedWrites.add(row.key)
      console.error('写入笔记正文缓存失败', error)
    })
    .finally(() => {
      noteBodyIndexVersion.value++
    })
  track(write)
}

/** 包含仍在写入的正文：关闭页面之前，必须等事务完成或云端确认。 */
export function hasVolatileNoteBodies(allAccounts = false): boolean {
  return [...unpersisted.values()].some(
    (row) => (allAccounts || row.userId === activeUserId) && (row.dirty || !!row.conflictOf)
  )
}

export const noteBodyStorageIssue = computed(() => {
  const _version = noteBodyIndexVersion.value
  const failed = [...unpersisted.values()].filter((row) => row.userId === activeUserId && failedWrites.has(row.key))
  if (!failed.length) return null
  return failed.some((row) => row.dirty || row.conflictOf)
    ? '部分笔记仅保留在当前页面，尚未存入本机。请保持页面打开，重试保存或下载正文。'
    : '笔记已在云端，本机缓存写入失败。请重试保存，以便下次读取。'
})

export type NoteBodySaveState = 'saving' | 'memory' | 'local' | 'synced' | 'missing'
export function noteBodySaveState(noteId: string): NoteBodySaveState {
  const _version = noteBodyIndexVersion.value
  const row = cache.get(noteId)
  if (!row) return 'missing'
  if (!row.dirty) return 'synced'
  if (unpersisted.has(row.key)) return failedWrites.has(row.key) ? 'memory' : 'saving'
  return 'local'
}

/** 明确重开失败/已关闭的连接，再写入原正文；仅重新发起网络同步不能修复本机缓存。 */
export async function retryNoteBodyStorage(): Promise<boolean> {
  if (retryFlight) return retryFlight
  const userId = activeUserId
  const run = async () => {
    await settleWrites()
    if (![...unpersisted.values()].some((row) => row.userId === userId)) return true
    if (dbPromise) {
      try {
        ;(await dbPromise).close()
      } catch {
        /* 下一步重新打开 */
      }
    }
    dbPromise = null
    for (const row of [...unpersisted.values()]) {
      if (row.userId === userId && unpersisted.get(row.key) === row) persistRow(row)
    }
    await settleWrites()
    return ![...unpersisted.values()].some((row) => row.userId === userId)
  }
  retryFlight = run()
  try {
    return await retryFlight
  } finally {
    retryFlight = null
  }
}

export interface NoteConflict {
  id: string
  noteId: string
  content: string
  updatedAt: number
  createdAt: number
  persisted: boolean
}
export const noteConflicts = computed<NoteConflict[]>(() => {
  const _version = noteBodyIndexVersion.value
  return [...conflicts.values()]
    .map((row) => ({
      id: row.noteId,
      noteId: row.conflictOf!,
      content: row.content,
      updatedAt: row.updatedAt,
      createdAt: row.conflictCreatedAt!,
      persisted: !unpersisted.has(row.key)
    }))
    .sort((a, b) => b.createdAt - a.createdAt)
})

function preserveConflict(row: CachedNoteBody): void {
  if ([...conflicts.values()].some((copy) => copy.conflictOf === row.noteId && copy.content === row.content)) return
  const id = `conflict-${crypto.randomUUID()}`
  const copy = {
    ...row,
    key: cacheKey(row.userId, id),
    noteId: id,
    conflictOf: row.noteId,
    conflictCreatedAt: Date.now(),
    dirty: false,
    restorationPending: false,
    unsyncable: null
  }
  conflicts.set(id, copy)
  persistRow(copy)
}

async function settleWrites(): Promise<void> {
  if (pendingWrites.size) await Promise.allSettled([...pendingWrites])
}

function setCached(row: CachedNoteBody): void {
  cache.set(row.noteId, row)
  searchIndex.set(row.noteId, row.content.toLocaleLowerCase())
  noteBodyIndexVersion.value++
  persistRow(row)
}

export async function setNoteBodyUser(userId: string | null): Promise<void> {
  const generation = ++userGeneration
  await settleWrites()
  if (generation !== userGeneration) return
  activeUserId = userId
  maxBytes = 0
  cache.clear()
  conflicts.clear()
  searchIndex.clear()
  noteBodyIndexVersion.value++
  if (!userId) return
  try {
    const limit = await fetchNoteBodyLimit()
    if (generation !== userGeneration) return
    maxBytes = limit
  } catch (error) {
    // 取不到上限不影响缓存读取：本地不拦超限，交给服务端 413 兜底
    console.warn('读取笔记正文上限失败，本次会话不做本地长度拦截', error)
  }
  if (generation !== userGeneration) return
  try {
    const rows = await rowsForUser(userId)
    if (generation !== userGeneration || activeUserId !== userId) return
    for (const row of rows) {
      if (row.conflictOf) conflicts.set(row.noteId, row)
      else {
        cache.set(row.noteId, { ...row, unsyncable: row.unsyncable ?? null })
        searchIndex.set(row.noteId, row.content.toLocaleLowerCase())
      }
    }
    noteBodyIndexVersion.value++
  } catch (error) {
    console.error('读取笔记正文缓存失败', error)
  }
  if (generation !== userGeneration || activeUserId !== userId) return
  for (const row of unpersisted.values()) {
    if (row.userId !== userId) continue
    if (row.conflictOf) conflicts.set(row.noteId, row)
    else {
      cache.set(row.noteId, row)
      searchIndex.set(row.noteId, row.content.toLocaleLowerCase())
    }
  }
  noteBodyIndexVersion.value++
}

export function getNoteBody(noteId: string): string {
  return cache.get(noteId)?.content ?? ''
}

/** 备份不能把尚未读取的正文当成空字符串；返回当前账号可验证的完整正文。 */
export async function exportNoteBody(note: Note): Promise<{ content: string; updatedAt: number }> {
  const userId = activeUserId
  const generation = userGeneration
  if (!userId) throw new Error('请先登录后导出笔记')
  if (note.type === 'pdf') throw new Error('PDF 请通过文件备份导出')
  const local = cache.get(note.id)
  if (local && (local.dirty || local.updatedAt >= note.bodyUpdatedAt)) {
    return { content: local.content, updatedAt: local.updatedAt }
  }
  const remote = (await pullNoteBodies([note.id])).find((body) => body.id === note.id)
  if (generation !== userGeneration || userId !== activeUserId) throw new Error('账号已改变，请重新导出')
  const latest = cache.get(note.id)
  if (latest && (latest.dirty || latest.updatedAt >= note.bodyUpdatedAt)) {
    return { content: latest.content, updatedAt: latest.updatedAt }
  }
  if (!remote || remote.updatedAt < note.bodyUpdatedAt)
    throw new Error(`笔记「${note.title}」正文尚未完整读取，请同步后重新导出`)
  setCached({
    key: cacheKey(userId, note.id),
    userId,
    noteId: note.id,
    content: remote.content,
    updatedAt: remote.updatedAt,
    dirty: false,
    unsyncable: null
  })
  return { content: remote.content, updatedAt: remote.updatedAt }
}

export function noteBodyIncludes(noteId: string, keyword: string): boolean {
  return searchIndex.get(noteId)?.includes(keyword.toLocaleLowerCase()) ?? false
}

export function noteBodyExcerpt(noteId: string, length = 80): string {
  return (cache.get(noteId)?.content ?? '').replace(/\$+/g, '').slice(0, length)
}

export function queueNoteBody(
  noteId: string,
  content: string,
  updatedAt: number,
  restorationPending = cache.get(noteId)?.restorationPending ?? false
): void {
  if (!activeUserId) throw new Error('尚未选择笔记正文账号')
  setCached({
    key: cacheKey(activeUserId, noteId),
    userId: activeUserId,
    noteId,
    content,
    updatedAt,
    dirty: true,
    restorationPending,
    // 保存时就按服务端上限判定：超限正文当场标记为不可推送，界面立即可见，不必等一次失败的推送
    unsyncable: noteBodyOversizeMessage(content)
  })
}

export function isNoteRestorePending(noteId: string): boolean {
  return !!cache.get(noteId)?.restorationPending
}

export function finishNoteRestore(noteId: string): void {
  const row = cache.get(noteId)
  if (row?.restorationPending && !row.dirty) setCached({ ...row, restorationPending: false })
}

/**
 * 是否还有**可推送**的待同步正文（页面卸载兜底 flushSave 的短路条件）。
 * 服务端永远不会接受的正文（超过上限）不计入：它会一直保持 dirty，
 * 若计入则卸载兜底推送被永久短路，毒记录连累整个 outbox 都上不了云。
 */
export function hasPendingNoteBodies(): boolean {
  return [...cache.values()].some((row) => row.dirty && !row.unsyncable)
}

/**
 * 尚未成功推送到服务端的笔记 id 集合，供笔记列表渲染「未同步」标识。
 * 含已知不可推送（超限）的正文：它们同样没上云，必须让用户看得见。
 */
export const pendingNoteBodyIds = computed<ReadonlySet<string>>(() => {
  const _version = noteBodyIndexVersion.value
  const ids = new Set<string>()
  for (const row of cache.values()) if (row.dirty) ids.add(row.noteId)
  return ids
})

/** 单篇正文的推送失败：必须交给界面展示，只打日志等于「静默停止同步」 */
export interface NoteBodyPushFailure {
  noteId: string
  /** 可展示原因（超限类已含服务端权威上限值） */
  reason: string
  /** 服务端永远不会接受（超过上限）：不再重试，直到用户改短正文 */
  permanent: boolean
}

export interface NoteBodyFlushResult {
  revisions: Map<string, { from: number; to: number }>
  failures: NoteBodyPushFailure[]
}

/**
 * 推送全部待同步正文。**不抛错**：逐行隔离失败，失败经 `failures` 返回（由调用方写入可见状态），
 * 而不是只 `console.error` —— 用户必须知道某篇正文没上云，否则跨设备看到的是空白正文。
 * 超过服务端上限（413）的正文标记为 `unsyncable`：它永远不会被接受，重试只是重复被拒，
 * 且会一直保持 dirty（若被 `hasPendingNoteBodies()` 计入，卸载兜底推送会被永久短路）。
 */
export async function flushPendingNoteBodies(): Promise<NoteBodyFlushResult> {
  const generation = userGeneration
  const userId = activeUserId
  const revisions = new Map<string, { from: number; to: number }>()
  const failures: NoteBodyPushFailure[] = []
  await retryNoteBodyStorage()
  if (!userId || generation !== userGeneration) return { revisions, failures }
  for (const current of [...cache.values()].filter((row) => row.dirty)) {
    if (generation !== userGeneration) return { revisions, failures }
    // 已知不可推送：跳过网络请求，但每次同步都上报，让提示常驻可见直到正文被改短
    if (current.unsyncable) {
      failures.push({ noteId: current.noteId, reason: current.unsyncable, permanent: true })
      continue
    }
    try {
      const result = await putNoteBody(current.noteId, current.content, current.updatedAt)
      if (generation !== userGeneration || activeUserId !== userId) return { revisions, failures }
      const latest = cache.get(current.noteId)
      if (!latest || latest.updatedAt !== current.updatedAt || latest.content !== current.content) continue
      if (!result.applied) {
        if (latest.restorationPending) {
          const updatedAt = Math.max(Date.now(), current.updatedAt + 1, result.updatedAt + 1)
          setCached({ ...latest, updatedAt })
          revisions.set(current.noteId, { from: current.updatedAt, to: updatedAt })
          failures.push({ noteId: current.noteId, reason: '备份正文被服务器拒绝，已保留待重试', permanent: false })
          continue
        }
        const remote = (await pullNoteBodies([current.noteId]))[0]
        if (generation !== userGeneration || activeUserId !== userId) return { revisions, failures }
        // 回拉期间可能再次保存或删除；迟到的远端正文只能替换原提交版本。
        const afterPull = cache.get(current.noteId)
        if (!afterPull || afterPull !== latest || !afterPull.dirty) continue
        if (!remote) throw new Error(`服务端拒绝笔记正文 ${current.noteId}，但未返回权威正文`)
        if (remote.content !== latest.content) preserveConflict(latest)
        setCached({
          key: cacheKey(userId, remote.id),
          userId,
          noteId: remote.id,
          content: remote.content,
          updatedAt: remote.updatedAt,
          dirty: false,
          unsyncable: null
        })
        continue
      }
      const updated: CachedNoteBody = { ...latest, updatedAt: result.updatedAt, dirty: false, unsyncable: null }
      setCached(updated)
      if (result.updatedAt !== current.updatedAt) {
        revisions.set(current.noteId, { from: current.updatedAt, to: result.updatedAt })
      }
    } catch (error) {
      if (generation !== userGeneration || activeUserId !== userId) return { revisions, failures }
      // 413 = 服务端明确告诉我们是正文超限：必然重试失败，标记后交给界面提示，
      // 其余（网络 / 5xx / 429）保留 dirty 待下次同步重试（服务端按 updatedAt LWW 幂等）
      const oversize = (error as { status?: number } | null)?.status === 413
      const reason = oversize
        ? (noteBodyOversizeMessage(current.content) ?? '正文超过服务端上限，请拆分或改用文件导入')
        : '正文同步失败，请检查网络后重试'
      if (oversize) {
        const latest = cache.get(current.noteId)
        if (latest && latest.updatedAt === current.updatedAt && latest.content === current.content) {
          setCached({ ...latest, unsyncable: reason })
        }
      }
      failures.push({ noteId: current.noteId, reason, permanent: oversize })
      console.error(`笔记正文 ${current.noteId} 推送失败`, error)
    }
  }
  await settleWrites()
  return { revisions, failures }
}

export async function reconcileNoteBodies(notes: Note[]): Promise<void> {
  const generation = userGeneration
  const userId = activeUserId
  await settleWrites()
  if (!userId || generation !== userGeneration) return
  const markdown = notes.filter((note) => note.type !== 'pdf')
  const liveIds = new Set(notes.map((note) => note.id))

  for (const row of [...cache.values()]) {
    if (liveIds.has(row.noteId) || row.restorationPending) continue
    if (row.dirty) preserveConflict(row)
    cache.delete(row.noteId)
    unpersisted.delete(row.key)
    failedWrites.delete(row.key)
    searchIndex.delete(row.noteId)
    track(deleteRow(userId, row.noteId))
  }

  const stale = markdown.filter((note) => {
    const local = cache.get(note.id)
    if (local?.restorationPending || (local?.dirty && local.updatedAt >= note.bodyUpdatedAt)) return false
    return note.bodyUpdatedAt > 0 && (!local || local.updatedAt < note.bodyUpdatedAt)
  })
  for (let start = 0; start < stale.length; start += PULL_BATCH) {
    const bodies = await pullNoteBodies(stale.slice(start, start + PULL_BATCH).map((note) => note.id))
    if (generation !== userGeneration || activeUserId !== userId) return
    for (const body of bodies) {
      const local = cache.get(body.id)
      if (local?.restorationPending || (local?.dirty && local.updatedAt >= body.updatedAt)) continue
      if (local?.dirty && local.content !== body.content) preserveConflict(local)
      setCached({
        key: cacheKey(userId, body.id),
        userId,
        noteId: body.id,
        content: body.content,
        updatedAt: body.updatedAt,
        dirty: false,
        unsyncable: null
      })
    }
  }
  noteBodyIndexVersion.value++
  await settleWrites()
}

export function removeNoteBody(noteId: string): void {
  if (!activeUserId) return
  const userId = activeUserId
  cache.delete(noteId)
  unpersisted.delete(cacheKey(userId, noteId))
  failedWrites.delete(cacheKey(userId, noteId))
  searchIndex.delete(noteId)
  noteBodyIndexVersion.value++
  track(deleteRow(userId, noteId))
}

export function clearAllNoteBodies(): void {
  for (const noteId of [...cache.keys()]) removeNoteBody(noteId)
  for (const row of conflicts.values()) {
    unpersisted.delete(row.key)
    failedWrites.delete(row.key)
    track(deleteRow(row.userId, row.noteId))
  }
  conflicts.clear()
  noteBodyIndexVersion.value++
}
