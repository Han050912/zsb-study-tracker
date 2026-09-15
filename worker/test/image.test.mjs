/**
 * worker/src/image.ts 纯函数单测（node --test，无 Env/D1 依赖）。
 * 魔数识别（sniff）+ 隐私元数据剥离（stripMetadata）：上传链路的隐私安全关键路径。
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { sniff, stripMetadata, IMAGE_MAX_BYTES } from '../src/image.ts'

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/** 构造 PNG 块：长度(4 BE) + 类型(4) + 数据 + CRC(4)（stripPng 不校验 CRC，填 0） */
function pngChunk(type, data = []) {
  const len = data.length
  return [
    (len >>> 24) & 0xff,
    (len >>> 16) & 0xff,
    (len >>> 8) & 0xff,
    len & 0xff,
    ...[...type].map((c) => c.charCodeAt(0)),
    ...data,
    0,
    0,
    0,
    0
  ]
}

test('sniff: 按魔数识别 PNG/JPEG/GIF/WebP', () => {
  assert.deepEqual(sniff(new Uint8Array([...PNG_SIG, 0, 0])), { mime: 'image/png', ext: 'png' })
  assert.deepEqual(sniff(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), { mime: 'image/jpeg', ext: 'jpg' })
  assert.deepEqual(sniff(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])), { mime: 'image/gif', ext: 'gif' })
  assert.deepEqual(sniff(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])), {
    mime: 'image/webp',
    ext: 'webp'
  })
})

test('sniff: 过短或未知格式返回 null', () => {
  assert.equal(sniff(new Uint8Array([])), null)
  assert.equal(sniff(new Uint8Array([0x89])), null)
  assert.equal(sniff(new Uint8Array([0x00, 0x01, 0x02, 0x03])), null)
  // RIFF 但非 WEBP
  assert.equal(sniff(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x41, 0x56, 0x49, 0x20])), null)
})

test('stripMetadata: PNG 剔除 tEXt 块，保留 IDAT/IEND', () => {
  const png = new Uint8Array([
    ...PNG_SIG,
    ...pngChunk('tEXt', [1, 2, 3]), // 文本元数据，应被剔除
    ...pngChunk('eXIf', [4, 5]), // EXIF 块，应被剔除
    ...pngChunk('IDAT', [9, 9]),
    ...pngChunk('IEND')
  ])
  const expected = new Uint8Array([...PNG_SIG, ...pngChunk('IDAT', [9, 9]), ...pngChunk('IEND')])
  assert.deepEqual(stripMetadata(png, { mime: 'image/png', ext: 'png' }), expected)
  // 剥离后仍是合法 PNG（魔数可再识别）
  assert.equal(sniff(stripMetadata(png, { mime: 'image/png', ext: 'png' })).ext, 'png')
})

test('stripMetadata: JPEG 剔除 APP1(EXIF) 与 COM 段，保留 SOI 与 SOS 后数据', () => {
  const jpeg = new Uint8Array([
    0xff,
    0xd8, // SOI
    0xff,
    0xe1,
    0x00,
    0x08,
    0x45,
    0x78,
    0x69,
    0x66,
    0x00,
    0x00, // APP1 "Exif\0\0"（len=8 含长度自身）
    0xff,
    0xfe,
    0x00,
    0x05,
    0x61,
    0x62,
    0x63, // COM "abc"（len=5）
    0xff,
    0xda,
    0x11,
    0x22,
    0x33 // SOS 及压缩数据原样照搬
  ])
  const expected = new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0x11, 0x22, 0x33])
  assert.deepEqual(stripMetadata(jpeg, { mime: 'image/jpeg', ext: 'jpg' }), expected)
})

test('stripMetadata: WebP 剔除 EXIF 块并重建 RIFF 总长度', () => {
  // EXIF 块（size=4，总长 12）应被剔除；VP8L 块（size=2，总长 10）保留
  const vp8lChunk = [0x56, 0x50, 0x38, 0x4c, 0x02, 0x00, 0x00, 0x00, 0x09, 0x08] // 'VP8L' + size 2 + data
  const webp = new Uint8Array([
    0x52,
    0x49,
    0x46,
    0x46,
    26,
    0,
    0,
    0, // 'RIFF' + 总长度 26（4 + 12 + 10）
    0x57,
    0x45,
    0x42,
    0x50, // 'WEBP'
    0x45,
    0x58,
    0x49,
    0x46,
    0x04,
    0x00,
    0x00,
    0x00,
    0x01,
    0x02,
    0x03,
    0x04, // 'EXIF' + size 4 + data
    ...vp8lChunk
  ])
  const expected = new Uint8Array([
    0x52,
    0x49,
    0x46,
    0x46,
    14,
    0,
    0,
    0, // 重建后总长度 14（4 + 10）
    0x57,
    0x45,
    0x42,
    0x50,
    ...vp8lChunk
  ])
  assert.deepEqual(stripMetadata(webp, { mime: 'image/webp', ext: 'webp' }), expected)
})

test('stripMetadata: GIF 无 EXIF 概念，原样透传', () => {
  const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00])
  assert.equal(stripMetadata(gif, { mime: 'image/gif', ext: 'gif' }), gif)
})

test('stripMetadata: 畸形数据返回 null（由调用方按 400 拒绝）', () => {
  // PNG 块长度越界
  const badPng = new Uint8Array([...PNG_SIG, 0x00, 0x00, 0x01, 0x00, 0x49, 0x44, 0x41, 0x54, 0x01])
  assert.equal(stripMetadata(badPng, { mime: 'image/png', ext: 'png' }), null)
  // JPEG 段长度越界
  const badJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x7f, 0xff, 0x00])
  assert.equal(stripMetadata(badJpeg, { mime: 'image/jpeg', ext: 'jpg' }), null)
})

test('IMAGE_MAX_BYTES: 单张上限 5MB（与前端校验口径一致）', () => {
  assert.equal(IMAGE_MAX_BYTES, 5 * 1024 * 1024)
})
