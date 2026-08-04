import { on, body } from '../router'
import { hashPassword, verifyPassword, signToken } from '../auth'
import { first, run, uid, HttpError } from '../db'
import { rateLimit } from '../middleware/rateLimit'

interface UserRow {
  id: string
  username: string
  password_hash: string
  created_at: number
}

function toUser(row: UserRow) {
  return { id: row.id, username: row.username, createdAt: row.created_at }
}

function validateCredentials(username: unknown, password: unknown): { username: string; password: string } {
  const u = typeof username === 'string' ? username.trim() : ''
  const p = typeof password === 'string' ? password : ''
  if (u.length < 2) throw new HttpError(400, '用户名至少 2 个字符')
  if (u.length > 20) throw new HttpError(400, '用户名最多 20 个字符')
  if (p.length < 6) throw new HttpError(400, '密码至少 6 位')
  if (p.length > 128) throw new HttpError(400, '密码最多 128 位')
  return { username: u, password: p }
}

export function registerAuthRoutes() {
  on('POST', '/api/auth/register', false, async (ctx) => {
    rateLimit(ctx.request, 'register', 3, 60_000) // 每 IP 每分钟最多 3 次注册
    const b = await body<{ username?: unknown; password?: unknown }>(ctx.request)
    const { username, password } = validateCredentials(b.username, b.password)
    if (await first(ctx.env, 'SELECT id FROM users WHERE username = ?', username)) {
      throw new HttpError(409, '该用户名已被注册')
    }
    const row: UserRow = { id: uid(), username, password_hash: hashPassword(password), created_at: Date.now() }
    await run(ctx.env, 'INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)',
      row.id, row.username, row.password_hash, row.created_at)
    // 初始化用户设置与游戏化数据（默认值由表结构兜底）
    await run(ctx.env, 'INSERT INTO user_settings (user_id) VALUES (?)', row.id)
    await run(ctx.env, 'INSERT INTO gamification (user_id) VALUES (?)', row.id)
    const token = await signToken(row.id, ctx.env.JWT_SECRET)
    return Response.json({ token, user: toUser(row) }, { status: 201 })
  })

  on('POST', '/api/auth/login', false, async (ctx) => {
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
