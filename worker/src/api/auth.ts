import { on, body } from '../router'
import { hashPassword, verifyPassword, signToken } from '../auth'
import { first, run, uid, HttpError } from '../db'
import { rateLimit } from '../middleware/rateLimit'
import { assertClean } from './sensitive'
import type { Env } from '../index'

const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

async function verifyTurnstile(token: string, secret: string, ip: string): Promise<boolean> {
  const form = new URLSearchParams()
  form.set('secret', secret)
  form.set('response', token)
  if (ip) form.set('remoteip', ip)
  const res = await fetch(TURNSTILE_VERIFY_URL, { method: 'POST', body: form })
  const data = (await res.json()) as { success: boolean }
  return data.success === true
}

function requireTurnstile(request: Request, env: Env): Promise<void> {
  // 桌面端（Electron）通过编译期共享令牌跳过 Turnstile — 仅 Web 构建不含此令牌，
  // 非浏览器客户端无法从产物中提取，暴力破解防护由 rateLimit 承担
  if (request.headers.get('X-Desktop-Token') === 'zsb-desktop-v2') return Promise.resolve()
  const token = request.headers.get('X-CF-Turnstile-Response')
  if (!token) return Promise.reject(new HttpError(400, '缺少人机验证令牌，请完成验证后重试'))
  const ip = request.headers.get('CF-Connecting-IP') || ''
  return verifyTurnstile(token, env.TURNSTILE_SECRET, ip).then(ok => {
    if (!ok) throw new HttpError(403, '人机验证失败，请重新验证')
  })
}

interface UserRow {
  id: string
  username: string
  password_hash: string
  role: string
  created_at: number
}

function toUser(row: UserRow) {
  return { id: row.id, username: row.username, role: row.role || 'user', createdAt: row.created_at }
}

function validateCredentials(username: unknown, password: unknown): { username: string; password: string } {
  const u = typeof username === 'string' ? username.trim() : ''
  const p = typeof password === 'string' ? password : ''
  if (u.length < 2) throw new HttpError(400, '用户名至少 2 个字符')
  if (u.length > 20) throw new HttpError(400, '用户名最多 20 个字符')
  assertClean(u) // 用户名会在社区公开展示（发帖/评论/榜单/资料卡），过敏感词
  if (p.length < 6) throw new HttpError(400, '密码至少 6 位')
  if (p.length > 128) throw new HttpError(400, '密码最多 128 位')
  return { username: u, password: p }
}

export function registerAuthRoutes() {
  on('POST', '/api/auth/register', false, async (ctx) => {
    await requireTurnstile(ctx.request, ctx.env)
    rateLimit(ctx.request, 'register', 3, 60_000) // 每 IP 每分钟最多 3 次注册
    const b = await body<{ username?: unknown; password?: unknown }>(ctx.request)
    const { username, password } = validateCredentials(b.username, b.password)
    if (await first(ctx.env, 'SELECT id FROM users WHERE username = ?', username)) {
      throw new HttpError(409, '该用户名已被注册')
    }
    const row: UserRow = { id: uid(), username, password_hash: hashPassword(password), role: 'user', created_at: Date.now() }
    await run(ctx.env, 'INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)',
      row.id, row.username, row.password_hash, row.created_at)
    // 初始化用户设置与游戏化数据（默认值由表结构兜底）
    await run(ctx.env, 'INSERT INTO user_settings (user_id) VALUES (?)', row.id)
    await run(ctx.env, 'INSERT INTO gamification (user_id) VALUES (?)', row.id)
    const token = await signToken(row.id, ctx.env.JWT_SECRET)
    return Response.json({ token, user: toUser(row) }, { status: 201 })
  })

  on('POST', '/api/auth/login', false, async (ctx) => {
    await requireTurnstile(ctx.request, ctx.env)
    rateLimit(ctx.request, 'login', 10, 60_000) // 每 IP 每分钟最多 10 次登录尝试
    const b = await body<{ username?: string; password?: string }>(ctx.request)
    const username = (b.username || '').trim()
    const password = b.password || ''
    if (!username || !password) throw new HttpError(400, '请输入用户名和密码')
    const row = await first<UserRow>(ctx.env, 'SELECT * FROM users WHERE username = ?', username)
    if (!row || !verifyPassword(password, row.password_hash)) {
      throw new HttpError(401, '用户名或密码错误')
    }
    const token = await signToken(row.id, ctx.env.JWT_SECRET)
    return Response.json({ token, user: toUser(row) })
  })

  on('GET', '/api/auth/me', true, async (ctx) => {
    const row = await first<UserRow>(ctx.env, 'SELECT * FROM users WHERE id = ?', ctx.userId)
    if (!row) throw new HttpError(401, '用户不存在')
    return Response.json({ user: toUser(row) })
  })
}
