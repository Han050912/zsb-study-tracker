/**
 * 数据静态加密层：用密码派生 AES-GCM-256 密钥，加密用户的 payload 后再存 SQLite。
 * - 密钥仅保存在内存中（登录/注册成功后派生），绝不落盘。
 * - 加密格式：`v1:<iv-base64>:<ciphertext-base64>`，便于识别与后续版本演进。
 * - 明文数据（旧版本）直接返回，实现向后兼容的渐进迁移。
 */

const ENC_PREFIX = 'v1:'

let currentKey: CryptoKey | null = null

function ensureSubtle(): SubtleCrypto {
  if (!globalThis.crypto?.subtle) {
    throw new Error('当前环境不支持加密功能，请使用 HTTPS 或 localhost 访问本页面')
  }
  return globalThis.crypto.subtle
}

function bytesToB64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

export function randomSaltB64(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return bytesToB64(bytes)
}

/** 由密码 + 盐派生 AES-GCM 密钥（与登录用的 PBKDF2 哈希相互独立）。可导出以便会话内缓存。 */
export async function deriveKey(password: string, saltB64: string): Promise<CryptoKey> {
  const subtle = ensureSubtle()
  const enc = new TextEncoder()
  const base = await subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey'])
  return subtle.deriveKey(
    { name: 'PBKDF2', salt: b64ToBytes(saltB64) as BufferSource, iterations: 100_000, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    true, // 允许导出，用于 sessionStorage 会话级缓存（刷新页面后无需重输密码）
    ['encrypt', 'decrypt']
  )
}

// 密钥会话级缓存：仅存 sessionStorage（标签页内存范围，关闭标签页即清除，不落 localStorage/磁盘持久）
const KEY_CACHE = 'zsb-data-key'

/** 设置当前会话的加密密钥（登录/注册成功后调用），并缓存到 sessionStorage 供刷新后恢复。 */
export async function setDataKey(key: CryptoKey | null): Promise<void> {
  currentKey = key
  try {
    if (key) {
      const jwk = await ensureSubtle().exportKey('jwk', key)
      sessionStorage.setItem(KEY_CACHE, JSON.stringify(jwk))
    } else {
      sessionStorage.removeItem(KEY_CACHE)
    }
  } catch { /* 缓存失败不影响使用 */ }
}

/** 应用启动时尝试从 sessionStorage 恢复密钥（无需重新输入密码）。 */
export async function restoreDataKey(): Promise<boolean> {
  if (currentKey) return true
  try {
    const raw = sessionStorage.getItem(KEY_CACHE)
    if (!raw) return false
    const jwk = JSON.parse(raw)
    currentKey = await ensureSubtle().importKey('jwk', jwk, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
    return true
  } catch {
    sessionStorage.removeItem(KEY_CACHE)
    return false
  }
}

export function hasDataKey(): boolean {
  return currentKey !== null
}

export function isEncrypted(payload: string): boolean {
  return payload.startsWith(ENC_PREFIX)
}

/** 加密文本；无密钥时原样返回（向后兼容明文存储场景）。 */
export async function encryptText(plain: string): Promise<string> {
  if (!currentKey) return plain
  const subtle = ensureSubtle()
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const data = new TextEncoder().encode(plain)
  const cipher = await subtle.encrypt({ name: 'AES-GCM', iv }, currentKey, data)
  return `${ENC_PREFIX}${bytesToB64(iv)}:${bytesToB64(new Uint8Array(cipher))}`
}

/** 解密文本；识别加密格式则解密，否则按明文原样返回（向后兼容）。 */
export async function decryptText(payload: string): Promise<string> {
  if (!isEncrypted(payload)) return payload
  if (!currentKey) throw new Error('缺少解密密钥，请重新登录')
  const subtle = ensureSubtle()
  const body = payload.slice(ENC_PREFIX.length)
  const sep = body.indexOf(':')
  if (sep < 0) throw new Error('加密数据格式损坏')
  const iv = b64ToBytes(body.slice(0, sep))
  const cipher = b64ToBytes(body.slice(sep + 1))
  const plain = await subtle.decrypt({ name: 'AES-GCM', iv: iv as BufferSource }, currentKey, cipher as BufferSource)
  return new TextDecoder().decode(plain)
}
