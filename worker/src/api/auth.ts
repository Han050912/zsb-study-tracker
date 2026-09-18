import { z } from 'zod'
import { on } from '../router'
import { hashPassword, verifyPassword, needsRehash, signToken, verifyTokenFull } from '../auth'
import { first, all, run, batch, uid, randomCode, HttpError } from '../db'
import { parseBody, registerSchema, loginSchema, passwordSchema, timingSafeEqual } from '../schemas'
import { rateLimit } from '../middleware/rateLimit'
import { authCookieHeader, clearAuthCookieHeader, extractToken, purgeRevokedCache } from '../middleware/auth'
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
    console.error('[Turnstile] 验证失败', {
      'error-codes': data['error-codes'],
      tokenPrefix: token.slice(0, 8) + '...',
      hasSecret: !!secret
    })
  }
  return data.success === true
}

async function requireTurnstile(request: Request, env: Env): Promise<void> {
  // 桌面端（Electron）通过服务端配置的共享令牌（env.DESKTOP_TOKEN）跳过 Turnstile。
  // 令牌不写死源码，由 Worker Secrets 与桌面端构建环境变量共同注入；未配置时 fail-closed 走人机验证。
  // 令牌比较采用恒定时间比较（SHA-256 后逐字节比对），防止时序侧信道逐字节猜测共享令牌。
  const desktopToken = request.headers.get('X-Desktop-Token')
  if (env.DESKTOP_TOKEN && desktopToken && (await timingSafeEqual(desktopToken, env.DESKTOP_TOKEN))) return
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
  return {
    id: row.id,
    userCode: row.user_code,
    username: row.username,
    role: row.role || 'user',
    createdAt: row.created_at
  }
}

/**
 * 登记本次签发的会话（jti ↔ user_id）。
 * 吊销只能按 jti 精确命中（middleware/auth.ts 查 jwt_blacklist），而其它设备的 jti 服务端无从得知，
 * 故在签发处留档：修改密码时据此把该用户全部 token 一次性写入黑名单，实现「改密即让其它会话下线」。
 */
async function recordSession(env: Env, token: string, userId: string): Promise<void> {
  const payload = await verifyTokenFull(token, env.JWT_SECRET)
  if (!payload) return
  await run(
    env,
    'INSERT OR REPLACE INTO user_sessions (jti, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)',
    payload.jti,
    userId,
    payload.exp,
    Math.floor(Date.now() / 1000)
  )
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
    await rateLimit(ctx, 'register', 3) // 每 IP 每分钟最多 3 次注册
    await requireTurnstile(ctx.request, ctx.env)
    const { username, password } = await parseBody(ctx.request, registerSchema)
    await assertCleanAsync(username, ctx.env) // 敏感词校验留在 handler（用户名社区公开展示）
    if (await first(ctx.env, 'SELECT id FROM users WHERE username = ?', username)) {
      throw new HttpError(409, '该用户名已被注册')
    }
    const userCode = await nextUserCode(ctx.env)
    const row: UserRow = {
      id: uid(),
      user_code: userCode,
      username,
      password_hash: await hashPassword(password),
      role: 'user',
      created_at: Date.now()
    }
    // 三条写入合并为一次 batch：D1 保证全成功或全失败，避免半注册状态（顺序不变：users 第一）
    await batch(ctx.env, [
      ctx.env.DB.prepare(
        'INSERT INTO users (id, user_code, username, password_hash, created_at) VALUES (?, ?, ?, ?, ?)'
      ).bind(row.id, row.user_code, row.username, row.password_hash, row.created_at),
      // 初始化用户设置与游戏化数据（昵称取登录用户名，其余默认值由表结构兜底）
      ctx.env.DB.prepare('INSERT INTO user_settings (user_id, user_name) VALUES (?, ?)').bind(row.id, row.username),
      ctx.env.DB.prepare('INSERT INTO gamification (user_id) VALUES (?)').bind(row.id)
    ])
    const token = await signToken(row.id, ctx.env.JWT_SECRET, row.role || 'user')
    await recordSession(ctx.env, token, row.id)
    return Response.json(
      { token, user: toUser(row) },
      { status: 201, headers: { 'Set-Cookie': authCookieHeader(token, ctx.request) } }
    )
  })

  on('POST', '/api/auth/login', false, async (ctx) => {
    await rateLimit(ctx, 'login', 10) // 每 IP 每分钟最多 10 次登录尝试
    await requireTurnstile(ctx.request, ctx.env)
    const { username, password } = await parseBody(ctx.request, loginSchema)
    // loginSchema 不做 trim：登录页已 trim，容忍历史空白
    const row = await first<UserRow>(ctx.env, 'SELECT * FROM users WHERE username = ?', username.trim())
    if (!row || !(await verifyPassword(password, row.password_hash))) {
      throw new HttpError(401, '用户名或密码错误')
    }
    // 存量 bcrypt 哈希：登录成功后立即重写为 PBKDF2，账号逐个自愈（rehash-on-login）。
    // 密码本身未变，已签发 token 与 user_sessions 不受影响，无需吊销；
    // 写入失败不吞异常（如实报错，用户重试，下次登录会再尝试升级）。
    // CAS：WHERE 以本次读到的旧哈希为前置条件。若在 bcrypt 校验窗口内密码被
    // 改密/管理员重置并发改写，本次升级写 0 行、顺延到下次登录，避免用旧密码的哈希覆盖新哈希。
    if (needsRehash(row.password_hash)) {
      await run(
        ctx.env,
        'UPDATE users SET password_hash = ? WHERE id = ? AND password_hash = ?',
        await hashPassword(password),
        row.id,
        row.password_hash
      )
    }
    const token = await signToken(row.id, ctx.env.JWT_SECRET, row.role || 'user')
    await recordSession(ctx.env, token, row.id)
    return Response.json(
      { token, user: toUser(row) },
      { headers: { 'Set-Cookie': authCookieHeader(token, ctx.request) } }
    )
  })

  // 修改密码：校验当前密码 → 写入新哈希 → 吊销该用户全部已签发 token → 为本次会话换发新 token
  on('POST', '/api/auth/password', true, async (ctx) => {
    // 与登录同属「凭证校验」端点，沿用同一套限流 + 人机验证
    await rateLimit(ctx, 'change-password', 5) // 每 IP 每分钟最多 5 次改密尝试
    await requireTurnstile(ctx.request, ctx.env)
    const { oldPassword, newPassword } = await parseBody(
      ctx.request,
      z.object({
        oldPassword: z.string().min(1, '请输入当前密码'),
        // 复用注册的密码策略（schemas.ts passwordSchema），不在改密处另立一套口径
        newPassword: passwordSchema
      })
    )
    const row = await first<UserRow>(ctx.env, 'SELECT * FROM users WHERE id = ?', ctx.userId)
    if (!row) throw new HttpError(401, '用户不存在')
    // 旧密码错误返回 400 而非 401：client.ts 把 401 统一视为「会话过期」并全局登出，
    // 这里只是表单校验失败，不该把用户踢下线（CREDENTIAL_PATHS 在 client.ts，不在本次改动范围）
    if (!(await verifyPassword(oldPassword, row.password_hash))) throw new HttpError(400, '当前密码错误')

    const sessions = await all<{ jti: string; expires_at: number }>(
      ctx.env,
      'SELECT jti, expires_at FROM user_sessions WHERE user_id = ?',
      ctx.userId
    )
    // 改密 + 清空会话登记 + 旧 jti 全部入黑名单：同一 batch 原子完成
    await batch(ctx.env, [
      ctx.env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(
        await hashPassword(newPassword),
        ctx.userId
      ),
      ctx.env.DB.prepare('DELETE FROM user_sessions WHERE user_id = ?').bind(ctx.userId),
      ...sessions.map((s) =>
        ctx.env.DB.prepare('INSERT OR IGNORE INTO jwt_blacklist (jti, expires_at) VALUES (?, ?)').bind(
          s.jti,
          s.expires_at
        )
      )
    ])
    // 黑名单落库后清掉各 jti 的「未吊销」缓存（顺序不可颠倒，同 logout），下一请求即读到已吊销
    await Promise.all(sessions.map((s) => purgeRevokedCache(s.jti)))

    // 为本次会话换发新 token：执行改密的设备无需重新登录，其余设备的会话已全部失效
    const token = await signToken(ctx.userId, ctx.env.JWT_SECRET, row.role || 'user')
    await recordSession(ctx.env, token, ctx.userId)
    return Response.json({ ok: true, token }, { headers: { 'Set-Cookie': authCookieHeader(token, ctx.request) } })
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
        await run(
          ctx.env,
          'INSERT OR IGNORE INTO jwt_blacklist (jti, expires_at) VALUES (?, ?)',
          payload.jti,
          payload.exp
        )
        // 会话登记随登出移除：该 jti 已吊销，无需再被改密的整批吊销遍历到
        await run(ctx.env, 'DELETE FROM user_sessions WHERE jti = ?', payload.jti)
        // 黑名单落库后删除该 jti 的「未吊销」缓存条目（顺序不可颠倒：先落库再清缓存，
        // 否则并发请求可能在两步之间把「未吊销」重新写回缓存）；TTL 内不清理则已登出的 token 仍被放行
        await purgeRevokedCache(payload.jti)
      }
    }
    return Response.json({ ok: true }, { headers: { 'Set-Cookie': clearAuthCookieHeader(ctx.request) } })
  })
}

/** 清理过期黑名单条目与过期会话登记（每周 cron 调用，登出处理器不再内联清理） */
export async function cleanupExpiredTokens(env: Env): Promise<void> {
  const now = Math.floor(Date.now() / 1000)
  await batch(env, [
    env.DB.prepare('DELETE FROM jwt_blacklist WHERE expires_at < ?').bind(now),
    // 会话登记按 token 过期时间清理：token 已过期即无需保留其 jti（再吊销已无意义）
    env.DB.prepare('DELETE FROM user_sessions WHERE expires_at < ?').bind(now)
  ])
}
