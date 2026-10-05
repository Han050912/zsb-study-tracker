import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdir, writeFile, unlink } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const compiled = await build({
  stdin: { contents: `export { materialFileBlob } from './src/utils/materialFile';`, resolveDir: process.cwd() },
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false
})
await mkdir('.cache/material-tests', { recursive: true })
const filename = resolve('.cache/material-tests', `${crypto.randomUUID()}.mjs`)
await writeFile(filename, compiled.outputFiles[0].text)
const { materialFileBlob } = await import(pathToFileURL(filename).href)
await unlink(filename)
const dataUrl = (type, bytes) => `data:${type};base64,${Buffer.from(bytes).toString('base64')}`

test('新旧 UTF-8 中文 TXT 的 Blob 响应声明 UTF-8，正文和原始字节不变', async () => {
  const content = '高数学习资料\r\n连续打卡 7 天，复习微积分。'
  const bytes = Buffer.from(content, 'utf8')
  const blob = materialFileBlob(dataUrl('text/plain', bytes), '中文资料.txt')
  const response = new Response(blob)
  assert.equal(response.headers.get('Content-Type'), 'text/plain;charset=utf-8')
  assert.equal(await response.clone().text(), content)
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes)
})

test('旧 TXT 附件缺少 MIME 或为通用二进制类型时，通过原文件名恢复文本类型', async () => {
  const bytes = Buffer.from('中文高数教材', 'utf8')
  for (const mime of ['', 'application/octet-stream']) {
    const blob = materialFileBlob(dataUrl(mime, bytes), '旧中文教材.TXT')
    assert.equal(blob.type, 'text/plain;charset=utf-8')
    assert.equal(await blob.text(), '中文高数教材')
  }
})

test('显式编码、非 UTF-8 文本和 UTF-8 BOM 原样保留，不进行字节转码', async () => {
  const gbk = Buffer.from([0xd6, 0xd0, 0xce, 0xc4])
  for (const mime of ['text/plain', 'text/plain;charset=gbk']) {
    const blob = materialFileBlob(dataUrl(mime, gbk), '中文.txt')
    assert.equal(blob.type, mime)
    assert.deepEqual(Buffer.from(await blob.arrayBuffer()), gbk)
  }
  const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('有 BOM 的中文', 'utf8')])
  const blob = materialFileBlob(dataUrl('text/plain', bom), '中文.txt')
  assert.equal(blob.type, 'text/plain;charset=utf-8')
  assert.deepEqual(Buffer.from(await blob.arrayBuffer()), bom)
  const declared = materialFileBlob(dataUrl('text/plain; charset=utf-8', Buffer.from('中文')), '中文.txt')
  assert.equal(declared.type, 'text/plain;charset=utf-8')
})

test('PDF 和其它二进制文件保持原 MIME 与内容，通用下载类型不会被当作 UTF-8 文本', async () => {
  for (const [mime, name, bytes] of [
    ['application/pdf', '教材.pdf', Buffer.from('%PDF-1.7\n中文文档')],
    ['application/octet-stream', '档案.bin', Buffer.from([0x00, 0xff, 0x81, 0x50])],
    ['application/octet-stream', '未识别.pdf', Buffer.from('ascii binary data')]
  ]) {
    const blob = materialFileBlob(dataUrl(mime, bytes), name)
    assert.equal(blob.type, mime)
    assert.deepEqual(Buffer.from(await blob.arrayBuffer()), bytes)
  }
})

test('畸形附件拒绝创建 Blob，正常 JSON 文本保留内容并声明 UTF-8', async () => {
  for (const invalid of ['data:text/plain;base64,%%%', 'data:text/plain,中文', 'not-data'])
    assert.throws(() => materialFileBlob(invalid))
  const content = JSON.stringify({ 科目: '高数' })
  const blob = materialFileBlob(dataUrl('application/json', Buffer.from(content)))
  assert.equal(blob.type, 'application/json;charset=utf-8')
  assert.equal(await blob.text(), content)
})
