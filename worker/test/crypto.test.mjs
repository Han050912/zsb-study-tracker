/**
 * worker/src/crypto.ts 纯函数单测（node --test，无需 wrangler dev / D1）。
 * env 仅需 { ENCRYPT_SECRET?, JWT_SECRET } 纯对象，Web Crypto 由 Node 原生提供。
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { encryptSecret, decryptSecret } from '../src/crypto.ts'

const env = { JWT_SECRET: 'test-jwt-secret', ENCRYPT_SECRET: 'test-encrypt-secret' }

/** decryptSecret 解密失败路径会 console.error 记日志，断言失败语义时静默以免污染测试输出 */
async function quietDecrypt(e, ct) {
  const orig = console.error
  console.error = () => {}
  try {
    return await decryptSecret(e, ct)
  } finally {
    console.error = orig
  }
}

test('encryptSecret/decryptSecret: 加密回环还原明文（含中文）', async () => {
  const plaintext = '墨墨开放API-Token_abc123'
  const ct = await encryptSecret(env, plaintext)
  assert.match(ct, /^enc:/)
  assert.equal(ct.split(':').length, 3)
  assert.equal(await decryptSecret(env, ct), plaintext)
})

test('encryptSecret: IV 随机，同明文两次密文不同', async () => {
  const a = await encryptSecret(env, 'same')
  const b = await encryptSecret(env, 'same')
  assert.notEqual(a, b)
})

test('decryptSecret: ENCRYPT_SECRET 缺席时回退 JWT_SECRET 派生密钥', async () => {
  const legacyEnv = { JWT_SECRET: 'test-jwt-secret' }
  const ct = await encryptSecret(legacyEnv, 'legacy-data')
  assert.equal(await decryptSecret(legacyEnv, ct), 'legacy-data')
})

test('decryptSecret: legacy 密文（JWT_SECRET 派生）在新密钥环境下仍可解密', async () => {
  // 历史数据由 JWT_SECRET 派生密钥加密；配置 ENCRYPT_SECRET 后新密文用新密钥，
  // 旧密文走 catch 里的 legacy 回退解密
  const ct = await encryptSecret({ JWT_SECRET: 'test-jwt-secret' }, 'old-token')
  assert.equal(await quietDecrypt(env, ct), 'old-token')
})

test('decryptSecret: 密钥不匹配返回 null（不抛异常）', async () => {
  const ct = await encryptSecret(env, 'secret')
  const wrongEnv = { JWT_SECRET: 'other-jwt', ENCRYPT_SECRET: 'other-encrypt' }
  assert.equal(await quietDecrypt(wrongEnv, ct), null)
})

test('decryptSecret: 密文被篡改返回 null（GCM 认证失败）', async () => {
  const ct = await encryptSecret(env, 'secret')
  const parts = ct.split(':')
  // 翻转密文主体最后一个字符
  const body = parts[2]
  parts[2] = body.slice(0, -1) + (body.endsWith('A') ? 'B' : 'A')
  assert.equal(await quietDecrypt(env, parts.join(':')), null)
})

test('decryptSecret: 格式非法的密文返回 null', async () => {
  const legacyEnv = { JWT_SECRET: 'test-jwt-secret' } // 无 ENCRYPT_SECRET，回退路径短路返回，不打错误日志
  assert.equal(await decryptSecret(legacyEnv, 'not-encrypted'), null)
  assert.equal(await decryptSecret(legacyEnv, 'enc:only-two:'), null)
  assert.equal(await decryptSecret(legacyEnv, ''), null)
})
