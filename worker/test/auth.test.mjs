/**
 * worker/src/auth.ts 纯函数单测（node --test，无需 wrangler dev / D1）。
 * PBKDF2 / HS256 JWT 均走 Web Crypto 与 jose，Node 环境可直接运行。
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { hashPassword, verifyPassword, needsRehash, signToken, verifyTokenFull, JWT_TTL_SECONDS } from '../src/auth.ts'

test('hashPassword/verifyPassword: PBKDF2 回环，同密码校验通过', async () => {
  const hash = await hashPassword('MyP@ssw0rd')
  // 格式 pbkdf2$<iterations>$<salt_b64>$<hash_b64>
  const parts = hash.split('$')
  assert.equal(parts.length, 4)
  assert.equal(parts[0], 'pbkdf2')
  assert.equal(Number(parts[1]), 100_000)
  assert.equal(await verifyPassword('MyP@ssw0rd', hash), true)
})

test('verifyPassword: 错误密码返回 false', async () => {
  const hash = await hashPassword('MyP@ssw0rd')
  assert.equal(await verifyPassword('myp@ssw0rd', hash), false)
  assert.equal(await verifyPassword('', hash), false)
})

test('hashPassword: 盐随机，同密码两次哈希不同', async () => {
  const a = await hashPassword('same-pw')
  const b = await hashPassword('same-pw')
  assert.notEqual(a, b)
  assert.equal(await verifyPassword('same-pw', a), true)
  assert.equal(await verifyPassword('same-pw', b), true)
})

test('verifyPassword: 畸形 pbkdf2 哈希返回 false（不抛异常）', async () => {
  assert.equal(await verifyPassword('pw', 'pbkdf2$abc$x$y'), false) // 迭代数非整数
  assert.equal(await verifyPassword('pw', 'pbkdf2$0$x$y'), false) // 迭代数为 0
  assert.equal(await verifyPassword('pw', 'pbkdf2$-5$x$y'), false)
  assert.equal(await verifyPassword('pw', 'pbkdf2$20000000$x$y'), false) // 超过 1000 万上限
  assert.equal(await verifyPassword('pw', 'pbkdf2$100000$$y'), false) // 缺盐
  assert.equal(await verifyPassword('pw', 'pbkdf2$100000$x$'), false) // 缺哈希
})

test('verifyPassword: 存量 bcrypt 哈希走兼容路径', async () => {
  const bcrypt = (await import('bcryptjs')).default
  const hash = bcrypt.hashSync('legacy-pw', 10)
  assert.equal(await verifyPassword('legacy-pw', hash), true)
  assert.equal(await verifyPassword('wrong-pw', hash), false)
  // 无法识别的哈希格式落入 bcrypt 比较，返回 false 而不抛异常
  assert.equal(await verifyPassword('pw', 'garbage'), false)
})

test('needsRehash: 仅非 pbkdf2$ 前缀的哈希需要升级', async () => {
  const bcrypt = (await import('bcryptjs')).default
  // PBKDF2 哈希（字面量与 hashPassword 实产）无需升级
  assert.equal(needsRehash('pbkdf2$100000$c2FsdA==$aGFzaA=='), false)
  assert.equal(needsRehash(await hashPassword('any-pw')), false)
  // 存量 bcrypt 哈希、无法识别的格式、空串一律视为需要升级（能否放行仍由 verifyPassword 决定）
  assert.equal(needsRehash(bcrypt.hashSync('legacy-pw', 10)), true)
  assert.equal(needsRehash('garbage'), true)
  assert.equal(needsRehash(''), true)
})

test('signToken/verifyTokenFull: 回环返回完整载荷', async () => {
  const token = await signToken('user-1', 'test-secret')
  const payload = await verifyTokenFull(token, 'test-secret')
  assert.equal(payload.userId, 'user-1')
  assert.equal(typeof payload.jti, 'string')
  assert.ok(payload.jti.length > 0)
  // 过期时间约为当前时间 + JWT_TTL_SECONDS（3 天），允许 60 秒误差
  const now = Math.floor(Date.now() / 1000)
  assert.ok(Math.abs(payload.exp - (now + JWT_TTL_SECONDS)) < 60)
  // 未传 role 时载荷不含 role（旧客户端兼容）
  assert.equal(payload.role, undefined)
})

test('signToken/verifyTokenFull: role claim 仅字符串被带出', async () => {
  const token = await signToken('admin-1', 'test-secret', 'admin')
  const payload = await verifyTokenFull(token, 'test-secret')
  assert.equal(payload.userId, 'admin-1')
  assert.equal(payload.role, 'admin')
})

test('verifyTokenFull: 错误密钥返回 null', async () => {
  const token = await signToken('user-1', 'test-secret')
  assert.equal(await verifyTokenFull(token, 'wrong-secret'), null)
})

test('verifyTokenFull: 篡改载荷返回 null', async () => {
  const token = await signToken('user-1', 'test-secret')
  const [header, , sig] = token.split('.')
  // 换上一个合法 base64url 编码但内容不同的 payload，签名必然失效
  const forged = `${header}.${Buffer.from(JSON.stringify({ sub: 'admin', jti: 'x', exp: 9999999999 })).toString('base64url')}.${sig}`
  assert.equal(await verifyTokenFull(forged, 'test-secret'), null)
  assert.equal(await verifyTokenFull('not.a.jwt', 'test-secret'), null)
})
