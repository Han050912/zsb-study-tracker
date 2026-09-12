import { ref } from 'vue'
import type { Note } from '../types'
import { pullNoteBodies, putNoteBody } from '../api/noteBodies'

interface CachedNoteBody {
  key: string
  userId: string
  noteId: string
  content: string
  updatedAt: number
  dirty: boolean
}

const DB_NAME = 'zsb-note-bodies-v1'
const STORE_NAME = 'bodies'
const PULL_BATCH = 50

let activeUserId: string | null = null
let dbPromise: Promise<IDBDatabase | null> | null = null
const cache = new Map<string, CachedNoteBody>()
const searchIndex = new Map<string, string>()
const pendingWrites = new Set<Promise<void>>()

/** 搜索/摘要消费者读取此版本，以便缓存异步变化后重新计算。 */
export const noteBodyIndexVersion = ref(0)

function cacheKey(userId: string, noteId: string): string {
  return `${userId}:${noteId}`
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)
  dbPromise = new Promise((resolve) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'key' })
        store.createIndex('userId', 'userId', { unique: false })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => {
      console.error('打开笔记正文缓存失败', request.error)
      resolve(null)
    }
  })
  return dbPromise
}

async function rowsForUser(userId: string): Promise<CachedNoteBody[]> {
  const db = await openDatabase()
  if (!db) return []
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).index('userId').getAll(userId)
    request.onsuccess = () => resolve(request.result as CachedNoteBody[])
    request.onerror = () => reject(request.error)
  })
}

async function writeRow(row: CachedNoteBody): Promise<void> {
  const db = await openDatabase()
  if (!db) return
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
  if (!db) return
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

async function settleWrites(): Promise<void> {
  if (pendingWrites.size) await Promise.allSettled([...pendingWrites])
}

function setCached(row: CachedNoteBody): void {
  cache.set(row.noteId, row)
  searchIndex.set(row.noteId, row.content.toLocaleLowerCase())
  noteBodyIndexVersion.value++
  track(writeRow(row))
}

export async function setNoteBodyUser(userId: string | null): Promise<void> {
  await settleWrites()
  activeUserId = userId
  cache.clear()
  searchIndex.clear()
  noteBodyIndexVersion.value++
  if (!userId) return
  try {
    const rows = await rowsForUser(userId)
    if (activeUserId !== userId) return
    for (const row of rows) {
      cache.set(row.noteId, row)
      searchIndex.set(row.noteId, row.content.toLocaleLowerCase())
    }
    noteBodyIndexVersion.value++
  } catch (error) {
    console.error('读取笔记正文缓存失败', error)
  }
}

export function getNoteBody(noteId: string): string {
  return cache.get(noteId)?.content ?? ''
}

export function noteBodyIncludes(noteId: string, keyword: string): boolean {
  return searchIndex.get(noteId)?.includes(keyword.toLocaleLowerCase()) ?? false
}

export function noteBodyExcerpt(noteId: string, length = 80): string {
  return (cache.get(noteId)?.content ?? '').replace(/\$+/g, '').slice(0, length)
}

export function queueNoteBody(noteId: string, content: string, updatedAt: number): void {
  if (!activeUserId) throw new Error('尚未选择笔记正文账号')
  setCached({
    key: cacheKey(activeUserId, noteId),
    userId: activeUserId,
    noteId,
    content,
    updatedAt,
    dirty: true
  })
}

export function hasPendingNoteBodies(): boolean {
  return [...cache.values()].some((row) => row.dirty)
}

export async function flushPendingNoteBodies(): Promise<Map<string, { from: number; to: number }>> {
  await settleWrites()
  const userId = activeUserId
  if (!userId) return new Map()
  const revisions = new Map<string, { from: number; to: number }>()
  for (const current of [...cache.values()].filter((row) => row.dirty)) {
    // 逐行隔离失败：单行网络错误/正文超限（413）不再抛出阻塞其余正文与整个 outbox 的推送，
    // 失败行保留 dirty 待下次同步重试（服务端按 updatedAt LWW 幂等）
    try {
      const result = await putNoteBody(current.noteId, current.content, current.updatedAt)
      if (activeUserId !== userId) return revisions
      const latest = cache.get(current.noteId)
      if (!latest || latest.updatedAt !== current.updatedAt || latest.content !== current.content) continue
      if (!result.applied) {
        const remote = (await pullNoteBodies([current.noteId]))[0]
        if (activeUserId !== userId) return revisions
        if (!remote) throw new Error(`服务端拒绝笔记正文 ${current.noteId}，但未返回权威正文`)
        setCached({
          key: cacheKey(userId, remote.id),
          userId,
          noteId: remote.id,
          content: remote.content,
          updatedAt: remote.updatedAt,
          dirty: false
        })
        continue
      }
      const updated: CachedNoteBody = { ...latest, updatedAt: result.updatedAt, dirty: false }
      setCached(updated)
      if (result.updatedAt !== current.updatedAt) {
        revisions.set(current.noteId, { from: current.updatedAt, to: result.updatedAt })
      }
    } catch (error) {
      console.error(`笔记正文 ${current.noteId} 推送失败，保留待下次重试`, error)
    }
  }
  await settleWrites()
  return revisions
}

export async function reconcileNoteBodies(notes: Note[]): Promise<void> {
  await settleWrites()
  const userId = activeUserId
  if (!userId) return
  const markdown = notes.filter((note) => note.type !== 'pdf')
  const liveIds = new Set(notes.map((note) => note.id))

  for (const row of [...cache.values()]) {
    if (liveIds.has(row.noteId) || row.dirty) continue
    cache.delete(row.noteId)
    searchIndex.delete(row.noteId)
    track(deleteRow(userId, row.noteId))
  }

  const stale = markdown.filter((note) => {
    const local = cache.get(note.id)
    if (local?.dirty && local.updatedAt >= note.bodyUpdatedAt) return false
    return note.bodyUpdatedAt > 0 && (!local || local.updatedAt < note.bodyUpdatedAt)
  })
  for (let start = 0; start < stale.length; start += PULL_BATCH) {
    const bodies = await pullNoteBodies(stale.slice(start, start + PULL_BATCH).map((note) => note.id))
    if (activeUserId !== userId) return
    for (const body of bodies) {
      const local = cache.get(body.id)
      if (local?.dirty && local.updatedAt >= body.updatedAt) continue
      setCached({
        key: cacheKey(userId, body.id),
        userId,
        noteId: body.id,
        content: body.content,
        updatedAt: body.updatedAt,
        dirty: false
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
  searchIndex.delete(noteId)
  noteBodyIndexVersion.value++
  track(deleteRow(userId, noteId))
}

export function clearAllNoteBodies(): void {
  for (const noteId of [...cache.keys()]) removeNoteBody(noteId)
}
