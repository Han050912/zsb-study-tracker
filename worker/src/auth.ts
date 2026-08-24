import bcrypt from 'bcryptjs'
import { SignJWT, jwtVerify } from 'jose'

const BCRYPT_COST = 10
/** JWT 有效期（秒）：3 天。配合登出吊销黑名单（jwt_blacklist）缩短泄露窗口 */
export const JWT_TTL_SECONDS = 3 * 24 * 3600

export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, BCRYPT_COST)
}

export function verifyPassword(password: string, hash: string): boolean {
  return bcrypt.compareSync(password, hash)
}

function secretKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret)
}

/** 签发 HS256 JWT，payload 含 user_id（sub）与 jti（吊销标识） */
export async function signToken(userId: string, secret: string): Promise<string> {
  return new SignJWT({})
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
}

/** 验证 JWT 并返回完整载荷（user_id + jti + exp）；无效/过期返回 null */
export async function verifyTokenFull(token: string, secret: string): Promise<TokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(secret))
    if (!payload.sub || !payload.jti || typeof payload.exp !== 'number') return null
    return { userId: payload.sub, jti: payload.jti, exp: payload.exp }
  } catch {
    return null
  }
}

/** 验证 JWT 并返回 user_id；无效/过期返回 null */
export async function verifyToken(token: string, secret: string): Promise<string | null> {
  const p = await verifyTokenFull(token, secret)
  return p?.userId ?? null
}
