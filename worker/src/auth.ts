import bcrypt from 'bcryptjs'
import { SignJWT, jwtVerify } from 'jose'

const BCRYPT_COST = 10
const JWT_TTL_SECONDS = 7 * 24 * 3600 // 7 天

export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, BCRYPT_COST)
}

export function verifyPassword(password: string, hash: string): boolean {
  return bcrypt.compareSync(password, hash)
}

function secretKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret)
}

/** 签发 HS256 JWT，payload 含 user_id（sub），7 天过期 */
export async function signToken(userId: string, secret: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + JWT_TTL_SECONDS)
    .sign(secretKey(secret))
}

/** 验证 JWT 并返回 user_id；无效/过期返回 null */
export async function verifyToken(token: string, secret: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(secret))
    return payload.sub ?? null
  } catch {
    return null
  }
}
