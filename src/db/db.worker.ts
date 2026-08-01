/// <reference lib="webworker" />
import initSqlJs from 'sql.js'
import type { Database } from 'sql.js'
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url'

/**
 * SQLite Web Worker：在独立线程中运行 sql.js（WASM），
 * 避免全量 export() / SQL 执行阻塞主线程导致 UI 冻结。
 * 数据库文件整体持久化到 IndexedDB（Worker 内可访问 indexedDB）。
 */

const IDB_NAME = 'zsb-sqlite'
const IDB_STORE = 'kv'
const DB_KEY = 'database'

let db: Database | null = null

// ---------- IndexedDB（Worker 内，缓存单一连接） ----------
let idbConn: Promise<IDBDatabase> | null = null

function idbOpen(): Promise<IDBDatabase> {
  if (idbConn) return idbConn
  idbConn = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE)
    req.onsuccess = () => {
      const conn = req.result
      conn.onversionchange = () => { conn.close(); idbConn = null }
      conn.onclose = () => { idbConn = null }
      resolve(conn)
    }
    req.onerror = () => { idbConn = null; reject(req.error) }
    req.onblocked = () => { idbConn = null; reject(new Error('IndexedDB 被占用，无法打开')) }
  })
  return idbConn
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

// ---------- 持久化（防抖合并 + 单一 pending Promise） ----------
let persistTimer: ReturnType<typeof setTimeout> | null = null
let pendingPromise: Promise<void> | null = null
let pendingResolve: (() => void) | null = null
let pendingReject: ((e: unknown) => void) | null = null

function settlePending() {
  pendingPromise = null
  pendingResolve = null
  pendingReject = null
  persistTimer = null
}

async function doPersist(): Promise<void> {
  if (!db) return
  await idbPut(DB_KEY, db.export())
}

function persist(): Promise<void> {
  if (pendingPromise && pendingResolve && pendingReject) {
    if (persistTimer) clearTimeout(persistTimer)
    persistTimer = setTimeout(runPersist, 200)
    return pendingPromise
  }
  pendingPromise = new Promise<void>((resolve, reject) => {
    pendingResolve = resolve
    pendingReject = reject
    persistTimer = setTimeout(runPersist, 200)
  })
  return pendingPromise
}

async function runPersist() {
  const resolve = pendingResolve!
  const reject = pendingReject!
  try {
    await doPersist()
    resolve()
  } catch (e) {
    reject(e)
  } finally {
    settlePending()
  }
}

/** 立即写入（跳过防抖），页面卸载前调用。 */
async function flush(): Promise<void> {
  if (persistTimer) clearTimeout(persistTimer)
  const reject = pendingReject
  settlePending()
  try {
    await doPersist()
  } catch (e) {
    reject?.(e)
    throw e
  }
}

// ---------- 数据库操作 ----------
async function init(): Promise<void> {
  if (db) return
  const SQL = await initSqlJs({ locateFile: () => wasmUrl })

  // 读取失败绝不能当作“无数据”，否则会用空库覆盖原有数据
  let saved: Uint8Array | null = null
  try {
    saved = await idbGet(DB_KEY)
  } catch (e) {
    throw new Error('无法读取本地数据库，请检查浏览器存储权限或隐私模式设置')
  }

  db = saved ? new SQL.Database(saved) : new SQL.Database()
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY,
      username      TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      salt          TEXT NOT NULL,
      enc_salt      TEXT,
      created_at    INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS user_data (
      user_id    TEXT PRIMARY KEY REFERENCES users(id),
      payload    TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `)
  // 旧库迁移：若无 enc_salt 列则补充（CREATE TABLE IF NOT EXISTS 不会修改已存在表）
  ensureColumn('users', 'enc_salt', 'TEXT')
  await persist()
}

function ensureColumn(table: string, column: string, type: string) {
  const res = db!.exec(`PRAGMA table_info(${table})`)
  const cols = res.length ? res[0].values.map(r => String(r[1])) : []
  if (!cols.includes(column)) db!.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
}

function requireDb(): Database {
  if (!db) throw new Error('数据库尚未初始化')
  return db
}

export interface UserRow {
  id: string
  username: string
  password_hash: string
  salt: string
  enc_salt: string | null
  created_at: number
}

function rowToUser(v: unknown[]): UserRow {
  return {
    id: String(v[0]), username: String(v[1]), password_hash: String(v[2]),
    salt: String(v[3]), enc_salt: v[4] == null ? null : String(v[4]), created_at: Number(v[5])
  }
}

const USER_COLS = 'id, username, password_hash, salt, enc_salt, created_at'

function findUserByName(username: string): UserRow | null {
  const res = requireDb().exec(`SELECT ${USER_COLS} FROM users WHERE username = ?`, [username])
  if (!res.length || !res[0].values.length) return null
  return rowToUser(res[0].values[0])
}

function findUserById(id: string): UserRow | null {
  const res = requireDb().exec(`SELECT ${USER_COLS} FROM users WHERE id = ?`, [id])
  if (!res.length || !res[0].values.length) return null
  return rowToUser(res[0].values[0])
}

function insertUser(user: UserRow): void {
  try {
    requireDb().run(
      'INSERT INTO users (id, username, password_hash, salt, enc_salt, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [user.id, user.username, user.password_hash, user.salt, user.enc_salt, user.created_at])
  } catch (e) {
    if (String(e).includes('UNIQUE constraint failed')) throw new Error('该用户名已被注册')
    throw e
  }
}

function countUsers(): number {
  const res = requireDb().exec('SELECT COUNT(*) FROM users')
  return res.length ? Number(res[0].values[0][0]) : 0
}

function loadUserData(userId: string): { payload: string; updatedAt: number } | null {
  const res = requireDb().exec('SELECT payload, updated_at FROM user_data WHERE user_id = ?', [userId])
  if (!res.length || !res[0].values.length) return null
  return { payload: String(res[0].values[0][0]), updatedAt: Number(res[0].values[0][1]) }
}

function saveUserData(userId: string, payload: string): void {
  requireDb().run(
    `INSERT INTO user_data (user_id, payload, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`,
    [userId, payload, Date.now()])
}

function deleteUserData(userId: string): void {
  requireDb().run('DELETE FROM user_data WHERE user_id = ?', [userId])
}

function dbFileSize(): number {
  return requireDb().export().byteLength
}

function exportRaw(): Uint8Array {
  return requireDb().export()
}

// ---------- RPC ----------
interface Req { id: number; method: string; args: unknown[] }

const handlers: Record<string, (...args: any[]) => unknown | Promise<unknown>> = {
  init,
  flush,
  persist,
  findUserByName,
  findUserById,
  insertUser,
  countUsers,
  loadUserData,
  saveUserData,
  deleteUserData,
  dbFileSize,
  exportRaw
}

self.onmessage = async (ev: MessageEvent<Req>) => {
  const { id, method, args } = ev.data
  try {
    const fn = handlers[method]
    if (!fn) throw new Error(`未知方法: ${method}`)
    const result = await fn(...args)
    // Uint8Array 等可转移对象通过 structured clone 传回
    ;(self as unknown as Worker).postMessage({ id, ok: true, result })
  } catch (e) {
    ;(self as unknown as Worker).postMessage({ id, ok: false, error: e instanceof Error ? e.message : String(e) })
  }
}
