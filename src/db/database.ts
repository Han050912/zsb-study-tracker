import initSqlJs from 'sql.js'
import type { Database } from 'sql.js'
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url'

/**
 * 浏览器内 SQLite 数据库层（sql.js / WASM）
 * 数据库文件整体持久化到 IndexedDB，应用完全离线可用，可静态部署。
 */

const IDB_NAME = 'zsb-sqlite'
const IDB_STORE = 'kv'
const DB_KEY = 'database'

let db: Database | null = null

// ---------- IndexedDB 极简封装 ----------
function idbOpen(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function idbGet(key: string): Promise<Uint8Array | null> {
  const conn = await idbOpen()
  return new Promise((resolve, reject) => {
    const req = conn.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(key)
    req.onsuccess = () => resolve(req.result ?? null)
    req.onerror = () => reject(req.error)
  })
}

async function idbPut(key: string, value: Uint8Array): Promise<void> {
  const conn = await idbOpen()
  return new Promise((resolve, reject) => {
    const req = conn.transaction(IDB_STORE, 'readwrite').objectStore(IDB_STORE).put(value, key)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

// ---------- 数据库初始化 ----------
export async function initDatabase(): Promise<void> {
  if (db) return
  const SQL = await initSqlJs({ locateFile: () => wasmUrl })
  const saved = await idbGet(DB_KEY).catch(() => null)
  db = saved ? new SQL.Database(saved) : new SQL.Database()
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY,
      username      TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      salt          TEXT NOT NULL,
      created_at    INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS user_data (
      user_id    TEXT PRIMARY KEY REFERENCES users(id),
      payload    TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `)
  await persistDb()
}

function getDb(): Database {
  if (!db) throw new Error('数据库尚未初始化')
  return db
}

/** 将内存中的 SQLite 文件写回 IndexedDB（防抖） */
let persistTimer: ReturnType<typeof setTimeout> | null = null
export function persistDb(): Promise<void> {
  return new Promise((resolve) => {
    if (persistTimer) clearTimeout(persistTimer)
    persistTimer = setTimeout(async () => {
      try {
        await idbPut(DB_KEY, getDb().export())
      } catch (e) {
        console.error('数据库持久化失败', e)
      }
      resolve()
    }, 200)
  })
}

/** 数据库文件大小（字节） */
export function dbFileSize(): number {
  return getDb().export().byteLength
}

// ---------- users 表 ----------
export interface UserRow {
  id: string
  username: string
  password_hash: string
  salt: string
  created_at: number
}

export function findUserByName(username: string): UserRow | null {
  const res = getDb().exec('SELECT id, username, password_hash, salt, created_at FROM users WHERE username = ?', [username])
  if (!res.length || !res[0].values.length) return null
  const [id, un, ph, salt, ca] = res[0].values[0]
  return { id: String(id), username: String(un), password_hash: String(ph), salt: String(salt), created_at: Number(ca) }
}

export function findUserById(id: string): UserRow | null {
  const res = getDb().exec('SELECT id, username, password_hash, salt, created_at FROM users WHERE id = ?', [id])
  if (!res.length || !res[0].values.length) return null
  const [uid, un, ph, salt, ca] = res[0].values[0]
  return { id: String(uid), username: String(un), password_hash: String(ph), salt: String(salt), created_at: Number(ca) }
}

export function insertUser(user: UserRow): void {
  getDb().run('INSERT INTO users (id, username, password_hash, salt, created_at) VALUES (?, ?, ?, ?, ?)',
    [user.id, user.username, user.password_hash, user.salt, user.created_at])
  persistDb()
}

export function countUsers(): number {
  const res = getDb().exec('SELECT COUNT(*) FROM users')
  return res.length ? Number(res[0].values[0][0]) : 0
}

// ---------- user_data 表 ----------
export function loadUserData(userId: string): { payload: string; updatedAt: number } | null {
  const res = getDb().exec('SELECT payload, updated_at FROM user_data WHERE user_id = ?', [userId])
  if (!res.length || !res[0].values.length) return null
  return { payload: String(res[0].values[0][0]), updatedAt: Number(res[0].values[0][1]) }
}

export function saveUserData(userId: string, payload: string): void {
  getDb().run(
    `INSERT INTO user_data (user_id, payload, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`,
    [userId, payload, Date.now()])
  persistDb()
}

export function deleteUserData(userId: string): void {
  getDb().run('DELETE FROM user_data WHERE user_id = ?', [userId])
  persistDb()
}
