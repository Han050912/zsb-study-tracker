import type { Env } from './index'

/**
 * 敏感字段加密（AES-256-GCM）：密钥由 JWT_SECRET 经 SHA-256 派生。
 * 密文格式 `enc:<iv_b64>:<ciphertext_b64>`，用于存储第三方凭证（如墨墨开放 API Token），
 * 使数据库被拖库后无法直接还原明文。
 * 解密失败（密钥轮换 / 数据损坏）返回 null，调用方按「未配置」处理。
 */

async function keyFromSecret(secret: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret))
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

function toB64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

function fromB64(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export async function encryptSecret(env: Env, plaintext: string): Promise<string> {
  const key = await keyFromSecret(env.JWT_SECRET)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext))
  return `enc:${toB64(iv)}:${toB64(new Uint8Array(ct))}`
}

export async function decryptSecret(env: Env, ciphertext: string): Promise<string | null> {
  try {
    const parts = ciphertext.split(':')
    if (parts.length !== 3 || parts[0] !== 'enc') return null
    const key = await keyFromSecret(env.JWT_SECRET)
    const iv = fromB64(parts[1])
    const ct = fromB64(parts[2])
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct)
    return new TextDecoder().decode(pt)
  } catch {
    return null
  }
}
