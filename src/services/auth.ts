import { ref, computed } from 'vue'
import {
  findUserByName, findUserById, insertUser, loadUserData, saveUserData,
  type UserRow
} from '../db/database'
import { uid } from '../utils/date'

/**
 * 认证服务：注册 / 登录 / 退出 / 会话持久化
 * 密码使用 PBKDF2(SHA-256, 10 万次迭代) + 随机盐哈希存储，绝不保存明文。
 */

const SESSION_KEY = 'zsb-session'

export interface SessionUser {
  id: string
  username: string
  createdAt: number
}

const currentUser = ref<SessionUser | null>(null)

export const isLoggedIn = computed(() => currentUser.value !== null)
export const sessionUser = computed(() => currentUser.value)

// ---------- PBKDF2 密码哈希（WebCrypto） ----------
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16)
  return bytes
}

async function hashPassword(password: string, saltHex: string): Promise<string> {
  // WebCrypto 仅在安全上下文（HTTPS 或 localhost）可用；HTTP 部署时给出友好提示
  if (!globalThis.crypto?.subtle) {
    throw new Error('当前环境不支持加密功能，请使用 HTTPS 或 localhost 访问本页面')
  }
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: hexToBytes(saltHex) as BufferSource, iterations: 100_000, hash: 'SHA-256' },
    key, 256)
  return bytesToHex(new Uint8Array(bits))
}

function randomSalt(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return bytesToHex(bytes)
}

// ---------- 会话 ----------
function setSession(user: SessionUser | null) {
  currentUser.value = user
  if (user) localStorage.setItem(SESSION_KEY, user.id)
  else localStorage.removeItem(SESSION_KEY)
}

/** 应用启动时恢复登录状态（需在 initDatabase 之后调用） */
export function restoreSession(): SessionUser | null {
  const id = localStorage.getItem(SESSION_KEY)
  if (!id) return null
  const row = findUserById(id)
  if (!row) { localStorage.removeItem(SESSION_KEY); return null }
  const user = toSessionUser(row)
  currentUser.value = user
  return user
}

function toSessionUser(row: UserRow): SessionUser {
  return { id: row.id, username: row.username, createdAt: row.created_at }
}

// ---------- 注册 ----------
export async function register(username: string, password: string): Promise<SessionUser> {
  username = username.trim()
  if (username.length < 2) throw new Error('用户名至少 2 个字符')
  if (username.length > 20) throw new Error('用户名最多 20 个字符')
  if (password.length < 6) throw new Error('密码至少 6 位')
  if (password.length > 128) throw new Error('密码最多 128 位')
  if (findUserByName(username)) throw new Error('该用户名已被注册')

  const salt = randomSalt()
  const row: UserRow = {
    id: uid(),
    username,
    password_hash: await hashPassword(password, salt),
    salt,
    created_at: Date.now()
  }
  // 并发注册同名时 insertUser 会抛“该用户名已被注册”，已在 db 层转换为友好提示
  insertUser(row)
  const user = toSessionUser(row)
  setSession(user)
  return user
}

// ---------- 登录 ----------
export async function login(username: string, password: string): Promise<SessionUser> {
  username = username.trim()
  if (!username || !password) throw new Error('请输入用户名和密码')
  const row = findUserByName(username)
  if (!row) throw new Error('用户不存在，请先注册')
  const hash = await hashPassword(password, row.salt)
  if (hash !== row.password_hash) throw new Error('密码错误，请重试')
  const user = toSessionUser(row)
  setSession(user)
  return user
}

// ---------- 退出 ----------
export function logout(): void {
  setSession(null)
}

// ---------- 当前用户数据读写 ----------
export function loadCurrentUserPayload(): { payload: string; updatedAt: number } | null {
  if (!currentUser.value) return null
  return loadUserData(currentUser.value.id)
}

export function saveCurrentUserPayload(payload: string): void {
  if (!currentUser.value) return
  saveUserData(currentUser.value.id, payload)
}
