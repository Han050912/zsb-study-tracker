/**
 * 数据库主线程封装：通过 Web Worker 运行 sql.js（WASM），
 * 所有 SQL/导出/持久化都在 Worker 线程执行，不阻塞 UI。
 * 本文件仅保留与 Worker 通信的轻量 RPC 客户端。
 */

import DbWorker from './db.worker?worker'

export interface UserRow {
  id: string
  username: string
  password_hash: string
  salt: string
  enc_salt: string | null
  created_at: number
}

let worker: Worker | null = null
let seq = 0
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>()

function getWorker(): Worker {
  if (worker) return worker
  worker = new DbWorker()
  worker.onmessage = (ev: MessageEvent) => {
    const { id, ok, result, error } = ev.data as { id: number; ok: boolean; result?: unknown; error?: string }
    const p = pending.get(id)
    if (!p) return
    pending.delete(id)
    if (ok) p.resolve(result)
    else p.reject(new Error(error || '数据库操作失败'))
  }
  worker.onerror = (e) => {
    console.error('数据库 Worker 异常', e)
  }
  return worker
}

function call<T>(method: string, ...args: unknown[]): Promise<T> {
  const w = getWorker()
  const id = ++seq
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
    w.postMessage({ id, method, args })
  })
}

// ---------- 生命周期 ----------
export function initDatabase(): Promise<void> {
  return call('init')
}

export function flushDb(): Promise<void> {
  return call('flush')
}

/** 触发一次防抖持久化（通常无需手动调用，各写操作已自动触发） */
export function persistDb(): Promise<void> {
  return call('persist')
}

// 页面卸载/切后台前尽力 flush，避免防抖窗口内的改动丢失
if (typeof window !== 'undefined') {
  const onHide = () => { call('flush').catch(() => { /* 卸载阶段尽力而为 */ }) }
  window.addEventListener('beforeunload', onHide)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') onHide()
  })
}

// ---------- users 表 ----------
export function findUserByName(username: string): Promise<UserRow | null> {
  return call('findUserByName', username)
}

export function findUserById(id: string): Promise<UserRow | null> {
  return call('findUserById', id)
}

export function insertUser(user: UserRow): Promise<void> {
  return call('insertUser', user)
}

export function countUsers(): Promise<number> {
  return call('countUsers')
}

// ---------- user_data 表 ----------
export function loadUserData(userId: string): Promise<{ payload: string; updatedAt: number } | null> {
  return call('loadUserData', userId)
}

export function saveUserData(userId: string, payload: string): Promise<void> {
  return call('saveUserData', userId, payload)
}

export function deleteUserData(userId: string): Promise<void> {
  return call('deleteUserData', userId)
}

export function dbFileSize(): Promise<number> {
  return call('dbFileSize')
}
