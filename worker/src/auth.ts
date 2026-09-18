import bcrypt from 'bcryptjs'
import { SignJWT, jwtVerify } from 'jose'

/** PBKDF2 迭代次数（登录热路径 CPU 成本与安全性的权衡值） */
const PBKDF2_ITERATIONS = 100_000
/** PBKDF2 哈希前缀：存量 bcrypt 哈希（$2 前缀）无此标记，据此判定是否需要升级 */
const PBKDF2_PREFIX = 'pbkdf2$'
/** JWT 有效期（秒）：3 天。配合登出吊销黑名单（jwt_blacklist）缩短泄露窗口 */
export const JWT_TTL_SECONDS = 3 * 24 * 3600

function toB64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}
function fromB64(s: string): Uint8Array {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function pbkdf2Hash(password: string, salt: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS },
    key,
    256
  )
  return toB64(bits)
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  return `${PBKDF2_PREFIX}${PBKDF2_ITERATIONS}$${toB64(salt)}$${await pbkdf2Hash(password, salt)}`
}

/** 该哈希是否需要在下次登录时升级为 PBKDF2（存量 bcrypt 与任何非 pbkdf2$ 格式均返回 true） */
export function needsRehash(hash: string): boolean {
  return !hash.startsWith(PBKDF2_PREFIX)
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  if (hash.startsWith(PBKDF2_PREFIX)) {
    const [, iterStr, saltB64, hashB64] = hash.split('$')
    const iterations = Number(iterStr)
    if (!Number.isInteger(iterations) || iterations <= 0 || iterations > 10_000_000) return false
    if (!saltB64 || !hashB64) return false
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, [
      'deriveBits'
    ])
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt: fromB64(saltB64) as BufferSource, iterations },
      key,
      256
    )
    return toB64(bits) === hashB64
  }
  // 存量 bcrypt 哈希（$2 前缀）：用异步 compare 按时间片让出，避免同步计算阻塞整个 isolate
  return bcrypt.compare(password, hash)
}

function secretKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret)
}

/** 签发 HS256 JWT，payload 含 user_id（sub）、jti（吊销标识）与 role（可选）。
 *  role 只是签发时快照（签发后无法随 DB 撤销），仅可用于「非 admin 即拒绝」的快速否定；
 *  管理员判定必须回查 DB（middleware/auth.ts 的 isDbAdmin） */
export async function signToken(userId: string, secret: string, role?: string): Promise<string> {
  // jose v6 无 setClaim，任意 claim 经构造器 payload 传入；role 为空时不写入（旧客户端兼容）
  return new SignJWT(role ? { role } : {})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setJti(crypto.randomUUID())
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + JWT_TTL_SECONDS)
    .sign(secretKey(secret))
}

export interface TokenPayload {
  userId: string
  jti: string
  exp: number
  /** 角色快照（签发时值，不可撤销）；不可作为授权依据，旧 token 无此字段（undefined） */
  role?: string
}

/** 验证 JWT 并返回完整载荷（user_id + jti + exp + role）；无效/过期返回 null */
export async function verifyTokenFull(token: string, secret: string): Promise<TokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(secret))
    if (!payload.sub || !payload.jti || typeof payload.exp !== 'number') return null
    return {
      userId: payload.sub,
      jti: payload.jti,
      exp: payload.exp,
      // 仅当 claim 是字符串才带出，防伪造类型
      ...(typeof payload.role === 'string' ? { role: payload.role } : {})
    }
  } catch {
    return null
  }
}
