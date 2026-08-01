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

// ---------- IndexedDB 封装（缓存单一连接，避免频繁建连/泄漏） ----------
let idbConn: Promise<IDBDatabase> | null = null

function idbOpen(): Promise<IDBDatabase> {
  if (idbConn) return idbConn
  idbConn = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE)
    req.onsuccess = () => {
      const conn = req.result
      // 数据库升级/其他标签页关闭时，释放连接便于后续重新建立
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

// ---------- 数据库初始化 ----------
export async function initDatabase(): Promise<void> {
  if (db) return
  const SQL = await initSqlJs({ locateFile: () => wasmUrl })

  // 读取失败绝不能当作“无数据”，否则下方 persistDb() 会用空库覆盖原有数据
  let saved: Uint8Array | null = null
  try {
    saved = await idbGet(DB_KEY)
  } catch (e) {
    console.error('读取本地数据库失败', e)
    throw new Error('无法读取本地数据库，请检查浏览器存储权限或隐私模式设置')
  }

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

/**
 * 将内存中的 SQLite 文件写回 IndexedDB（防抖合并）。
 * - 跟踪单一 pending 写入：新调用复用同一 Promise，避免被 clearTimeout 取消后挂死。
 * - 写入失败会 reject，调用方应感知并提示用户（本应用离线依赖 IndexedDB）。
 */
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
  await idbPut(DB_KEY, getDb().export())
}

export function persistDb(): Promise<void> {
  if (pendingPromise && pendingResolve && pendingReject) {
    // 已有待执行的写入：重置计时器并复用同一 Promise
    if (persistTimer) clearTimeout(persistTimer)
    persistTimer = setTimeout(async () => {
      const resolve = pendingResolve!
      const reject = pendingReject!
      try {
        await doPersist()
        resolve()
      } catch (e) {
        console.error('数据库持久化失败', e)
        reject(e)
      } finally {
        settlePending()
      }
    }, 200)
    return pendingPromise
  }

  pendingPromise = new Promise<void>((resolve, reject) => {
    pendingResolve = resolve
    pendingReject = reject
    persistTimer = setTimeout(async () => {
      try {
        await doPersist()
        resolve()
      } catch (e) {
        console.error('数据库持久化失败', e)
        reject(e)
      } finally {
        settlePending()
      }
    }, 200)
  })
  return pendingPromise
}

/** 立即写入（跳过防抖），失败时抛错。用于页面卸载前尽力保存。 */
export async function flushDb(): Promise<void> {
  if (!db) return
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

// 页面卸载/切后台前尽力 flush，避免最后 200ms 防抖窗口内的改动丢失
if (typeof window !== 'undefined') {
  const onHide = () => {
    if (!db) return
    try {
      // export 是同步的；put 请求排队后在页面关闭时浏览器通常仍会处理
      const conn = idbConn as Promise<IDBDatabase> | null
      if (conn) {
        conn.then(c => {
          try { c.transaction(IDB_STORE, 'readwrite').objectStore(IDB_STORE).put(db!.export(), DB_KEY) } catch { /* 忽略 */ }
        }).catch(() => { /* 忽略 */ })
      }
    } catch { /* 卸载阶段尽力而为 */ }
  }
  window.addEventListener('beforeunload', onHide)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') onHide()
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

/** 插入用户；用户名冲突（UNIQUE 约束）时抛出友好错误。 */
export function insertUser(user: UserRow): void {
  try {
    getDb().run('INSERT INTO users (id, username, password_hash, salt, created_at) VALUES (?, ?, ?, ?, ?)',
      [user.id, user.username, user.password_hash, user.salt, user.created_at])
  } catch (e) {
    if (String(e).includes('UNIQUE constraint failed')) throw new Error('该用户名已被注册')
    throw e
  }
  persistDb().catch(() => { /* 注册流程中由 save 触发提示 */ })
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
  persistDb().catch(e => console.error('保存用户数据失败', e))
}

export function deleteUserData(userId: string): void {
  getDb().run('DELETE FROM user_data WHERE user_id = ?', [userId])
  persistDb().catch(e => console.error('删除用户数据失败', e))
}
