import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

// 编译并运行真实本地规则和 assertClean，词库/归一化/自动机均不 mock。
const compiled = await build({
  entryPoints: [fileURLToPath(new URL('../src/api/sensitive.ts', import.meta.url))],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false
})
const { moderate, assertCleanLocal, assertCleanAsync } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`
)

test('短英文词不会误伤英文单词、缩写和合法用户名', async () => {
  for (const text of [
    'USB',
    'USB-C cable',
    'Smith',
    'Small',
    'studya_muqsb234',
    'recsync_a_muqsb234',
    'muqsm20261002',
    'since',
    'sync',
    'canvas'
  ]) {
    assert.deepEqual(moderate(text), { hard: false, soft: false }, text)
    assert.deepEqual(assertCleanLocal(text), { flagged: false }, text)
    assert.deepEqual(await assertCleanAsync(text, {}), { flagged: false }, text)
  }
})

test('独立缩写、中文相邻与英文上下文仍被硬拦截', async () => {
  for (const text of ['sb', 'SB', 'sm', 'SM', '你sb', 'sb中文', '你sm中文', 'before sb after', 'before sm after']) {
    assert.equal(moderate(text).hard, true, text)
    assert.throws(
      () => assertCleanLocal(text),
      (error) => error.status === 400,
      text
    )
    await assert.rejects(assertCleanAsync(text, {}, { allowSoft: true }), (error) => error.status === 400, text)
  }
})

test('空白、连字符、零宽与全角变形仍被硬拦截', async () => {
  for (const text of [
    's b',
    's-m',
    's\tb',
    's\u200bb',
    's\u200dm',
    'ｓｂ',
    'Ｓ－Ｍ',
    'before s b after',
    'before s-m after',
    '你s\u200bb真'
  ]) {
    assert.equal(moderate(text).hard, true, text)
    assert.throws(
      () => assertCleanLocal(text),
      (error) => error.status === 400,
      text
    )
    await assert.rejects(assertCleanAsync(text, {}), (error) => error.status === 400, text)
  }
})

test('普通辱骂、广告与其归一化拦截策略保持生效', async () => {
  for (const text of ['你是傻逼', '提供代考服务', '加 微 信 买答案', '加威信买答案']) {
    assert.equal(moderate(text).hard, true, text)
    assert.throws(
      () => assertCleanLocal(text),
      (error) => error.status === 400,
      text
    )
    await assert.rejects(assertCleanAsync(text, {}), (error) => error.status === 400, text)
  }
})
