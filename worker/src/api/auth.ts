import { on } from '../router'
import { hashPassword, verifyPassword, signToken, verifyTokenFull } from '../auth'
import { first, run, uid, randomCode, HttpError } from '../db'
import { parseBody, registerSchema, loginSchema, timingSafeEqual } from '../schemas'
import { rateLimit } from '../middleware/rateLimit'
import { authCookieHeader, clearAuthCookieHeader, extractToken } from '../middleware/auth'
import { assertCleanAsync } from './sensitive'
import type { Env } from '../index'

const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

async function verifyTurnstile(token: string, secret: string): Promise<boolean> {
  const form = new URLSearchParams()
  form.set('secret', secret)
  form.set('response', token)
  // 不传 remoteip：由 Cloudflare 按 siteverify 请求来源 IP 自动匹配。
  // 手动传 remoteip 在用户 IP 变化（移动网络切换 / IPv6 隧道 / 代理）时反而会导致校验失败。
  const res = await fetch(TURNSTILE_VERIFY_URL, { method: 'POST', body: form })
  const data = (await res.json()) as { success: boolean; 'error-codes'?: string[] }
  if (!data.success) {
    console.error('[Turnstile] 验证失败', { 'error-codes': data['error-codes'], tokenPrefix: token.slice(0, 8) + '...', hasSecret: !!secret })
  }
  return data.success === true
}

async function requireTurnstile(request: Request, env: Env): Promise<void> {
  // 桌面端（Electron）通过服务端配置的共享令牌（env.DESKTOP_TOKEN）跳过 Turnstile。
  // 令牌不写死源码，由 Worker Secrets 与桌面端构建环境变量共同注入；未配置时 fail-closed 走人机验证。
  // 令牌比较采用恒定时间比较（SHA-256 后逐字节比对），防止时序侧信道逐字节猜测共享令牌。
  const desktopToken = request.headers.get('X-Desktop-Token')
  if (env.DESKTOP_TOKEN && desktopToken && await timingSafeEqual(desktopToken, env.DESKTOP_TOKEN)) return
  const token = request.headers.get('X-CF-Turnstile-Response')
  if (!token) throw new HttpError(400, '缺少人机验证令牌，请完成验证后重试')
  if (!env.TURNSTILE_SECRET) {
    console.error('[Turnstile] TURNSTILE_SECRET 未配置，无法验证人机验证令牌')
    throw new HttpError(500, '服务器配置错误，请联系管理员')
  }
  const ok = await verifyTurnstile(token, env.TURNSTILE_SECRET)
  if (!ok) throw new HttpError(403, '人机验证失败，请重新验证')
}

interface UserRow {
  id: string
  user_code: string
  username: string
  password_hash: string
  role: string
  created_at: number
}

function toUser(row: UserRow) {
  return { id: row.id, userCode: row.user_code, username: row.username, role: row.role || 'user', createdAt: row.created_at }
}

/** 生成唯一对外用户 ID：随机 8 位短码（32^8 空间，不可枚举），查重冲突重试，唯一性由 UNIQUE 索引兜底 */
async function nextUserCode(env: Env): Promise<string> {
  for (let i = 0; i < 10; i++) {
    const code = randomCode()
    if (!(await first(env, 'SELECT id FROM users WHERE user_code = ?', code))) return code
  }
  throw new HttpError(500, '生成用户ID失败，请重试')
}

export function registerAuthRoutes() {
  on('POST', '/api/auth/register', false, async (ctx) => {
    await requireTurnstile(ctx.request, ctx.env)
    rateLimit(ctx.request, 'register', 3, 60_000) // 每 IP 每分钟最多 3 次注册
    const { username, password } = await parseBody(ctx.request, registerSchema)
    await assertCleanAsync(username, ctx.env) // 敏感词校验留在 handler（用户名社区公开展示）
    if (await first(ctx.env, 'SELECT id FROM users WHERE username = ?', username)) {
      throw new HttpError(409, '该用户名已被注册')
    }
    const userCode = await nextUserCode(ctx.env)
    const row: UserRow = { id: uid(), user_code: userCode, username, password_hash: hashPassword(password), role: 'user', created_at: Date.now() }
    await run(ctx.env, 'INSERT INTO users (id, user_code, username, password_hash, created_at) VALUES (?, ?, ?, ?, ?)',
      row.id, row.user_code, row.username, row.password_hash, row.created_at)
    // 初始化用户设置与游戏化数据（昵称取登录用户名，其余默认值由表结构兜底）
    await run(ctx.env, 'INSERT INTO user_settings (user_id, user_name) VALUES (?, ?)', row.id, row.username)
    await run(ctx.env, 'INSERT INTO gamification (user_id) VALUES (?)', row.id)
    const token = await signToken(row.id, ctx.env.JWT_SECRET)
    return Response.json({ token, user: toUser(row) }, { status: 201, headers: { 'Set-Cookie': authCookieHeader(token, ctx.request) } })
  })

  on('POST', '/api/auth/login', false, async (ctx) => {
    await requireTurnstile(ctx.request, ctx.env)
    rateLimit(ctx.request, 'login', 10, 60_000) // 每 IP 每分钟最多 10 次登录尝试
    const { username, password } = await parseBody(ctx.request, loginSchema)
    // loginSchema 不做 trim：登录页已 trim，容忍历史空白
    const row = await first<UserRow>(ctx.env, 'SELECT * FROM users WHERE username = ?', username.trim())
    if (!row || !verifyPassword(password, row.password_hash)) {
      throw new HttpError(401, '用户名或密码错误')
    }
    const token = await signToken(row.id, ctx.env.JWT_SECRET)
    return Response.json({ token, user: toUser(row) }, { headers: { 'Set-Cookie': authCookieHeader(token, ctx.request) } })
  })

  on('GET', '/api/auth/me', true, async (ctx) => {
    const row = await first<UserRow>(ctx.env, 'SELECT * FROM users WHERE id = ?', ctx.userId)
    if (!row) throw new HttpError(401, '用户不存在')
    return Response.json({ user: toUser(row) })
  })

  // 登出：吊销当前 JWT（写入黑名单）+ 清除会话 Cookie
  on('POST', '/api/auth/logout', true, async (ctx) => {
    const ext = extractToken(ctx.request)
    if (ext) {
      const payload = await verifyTokenFull(ext.token, ctx.env.JWT_SECRET)
      if (payload?.jti) {
        // 顺带清理过期条目，避免黑名单无限增长
        await run(ctx.env, 'DELETE FROM jwt_blacklist WHERE expires_at < ?', Math.floor(Date.now() / 1000))
        await run(ctx.env, 'INSERT OR IGNORE INTO jwt_blacklist (jti, expires_at) VALUES (?, ?)', payload.jti, payload.exp)
      }
    }
    return Response.json({ ok: true }, { headers: { 'Set-Cookie': clearAuthCookieHeader(ctx.request) } })
  })
}
