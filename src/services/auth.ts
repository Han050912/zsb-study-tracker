import { ref, computed } from 'vue'
import {
  findUserByName, findUserById, insertUser, loadUserData, saveUserData,
  type UserRow
} from '../db/database'
import {
  deriveKey, setDataKey, restoreDataKey, encryptText, decryptText, isEncrypted, randomSaltB64
} from './crypto'
import { uid } from '../utils/date'

/**
 * 认证服务：注册 / 登录 / 退出 / 会话持久化
 * - 密码校验：PBKDF2(SHA-256, 10 万次迭代) + 随机盐哈希存储，绝不保存明文。
 * - 数据加密：用密码派生 AES-GCM 密钥（独立盐 enc_salt），payload 静态加密存储。
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

// ---------- PBKDF2 密码哈希（WebCrypto，用于校验密码） ----------
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16)
  return bytes
}

function ensureSubtle(): SubtleCrypto {
  if (!globalThis.crypto?.subtle) {
    throw new Error('当前环境不支持加密功能，请使用 HTTPS 或 localhost 访问本页面')
  }
  return globalThis.crypto.subtle
}

async function hashPassword(password: string, saltHex: string): Promise<string> {
  const subtle = ensureSubtle()
  const enc = new TextEncoder()
  const key = await subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await subtle.deriveBits(
    { name: 'PBKDF2', salt: hexToBytes(saltHex) as BufferSource, iterations: 100_000, hash: 'SHA-256' },
    key, 256)
  return bytesToHex(new Uint8Array(bits))
}

function randomSaltHex(): string {
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

/** 应用启动时恢复登录状态（需在 initDatabase 之后调用）。
 *  同时从 sessionStorage 恢复数据密钥，刷新页面后无需重新输入密码即可解密数据。 */
export async function restoreSession(): Promise<SessionUser | null> {
  const id = localStorage.getItem(SESSION_KEY)
  if (!id) return null
  const row = await findUserById(id)
  if (!row) { localStorage.removeItem(SESSION_KEY); return null }
  await restoreDataKey()
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
  if (await findUserByName(username)) throw new Error('该用户名已被注册')

  const salt = randomSaltHex()
  const encSalt = randomSaltB64()
  const row: UserRow = {
    id: uid(),
    username,
    password_hash: await hashPassword(password, salt),
    salt,
    enc_salt: encSalt,
    created_at: Date.now()
  }
  // 并发注册同名时 insertUser 会抛“该用户名已被注册”（worker 已转换为友好提示）
  await insertUser(row)
  // 注册即登录：派生数据加密密钥
  await setDataKey(await deriveKey(password, encSalt))
  const user = toSessionUser(row)
  setSession(user)
  return user
}

// ---------- 登录 ----------
export async function login(username: string, password: string): Promise<SessionUser> {
  username = username.trim()
  if (!username || !password) throw new Error('请输入用户名和密码')
  const row = await findUserByName(username)
  if (!row) throw new Error('用户不存在，请先注册')
  const hash = await hashPassword(password, row.salt)
  if (hash !== row.password_hash) throw new Error('密码错误，请重试')
  // 派生数据加密密钥；老账号可能无 enc_salt（历史明文数据），此时密钥置空走明文路径
  await setDataKey(row.enc_salt ? await deriveKey(password, row.enc_salt) : null)
  const user = toSessionUser(row)
  setSession(user)
  return user
}

// ---------- 退出 ----------
export function logout(): void {
  setDataKey(null).catch(() => { /* 忽略 */ })
  setSession(null)
}

// ---------- 当前用户数据读写（自动加解密 + 明文渐进迁移） ----------
export async function loadCurrentUserPayload(): Promise<{ payload: string; updatedAt: number } | null> {
  if (!currentUser.value) return null
  const row = await loadUserData(currentUser.value.id)
  if (!row) return null
  try {
    const plain = await decryptText(row.payload)
    return { payload: plain, updatedAt: row.updatedAt }
  } catch (e) {
    console.error('解密用户数据失败', e)
    throw new Error('无法解密你的数据，请确认登录密码正确')
  }
}

export async function saveCurrentUserPayload(payload: string): Promise<void> {
  if (!currentUser.value) return
  const stored = await encryptText(payload)
  await saveUserData(currentUser.value.id, stored)
}

/** 判断当前账号数据是否仍为明文（用于提示/迁移）。 */
export async function isCurrentDataPlaintext(): Promise<boolean> {
  if (!currentUser.value) return false
  const row = await loadUserData(currentUser.value.id)
  return !!row && !isEncrypted(row.payload)
}
