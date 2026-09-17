/**
 * 图片二进制处理共享模块：魔数识别 + 隐私元数据剥离。
 * 社区图片上传（api/uploads.ts）与错题图片（api/errorImages.ts）共用，避免两份实现漂移。
 */

/** 单张图片上限 5MB（与前端校验口径一致） */
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024

/** 按文件头识别出的真实格式 */
export type ImageKind = { mime: string; ext: 'png' | 'jpg' | 'gif' | 'webp' }

function ascii(b: Uint8Array, off: number, len: number): string {
  return String.fromCharCode(...b.subarray(off, off + len))
}

/** 按文件头识别真实格式；不支持返回 null */
export function sniff(b: Uint8Array): ImageKind | null {
  if (b.length >= 8 && b[0] === 0x89 && ascii(b, 1, 3) === 'PNG') return { mime: 'image/png', ext: 'png' }
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' }
  if (b.length >= 6 && ascii(b, 0, 4) === 'GIF8') return { mime: 'image/gif', ext: 'gif' }
  if (b.length >= 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP')
    return { mime: 'image/webp', ext: 'webp' }
  return null
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((s, p) => s + p.byteLength, 0)
  const out = new Uint8Array(total)
  let off = 0
  for (const p of parts) {
    out.set(p, off)
    off += p.byteLength
  }
  return out
}

/** JPEG：剔除 APP1(EXIF) 与 COM 段，其余段（含 APP0 JFIF）保留 */
function stripJpeg(b: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [b.subarray(0, 2)] // SOI
  let i = 2
  while (i + 2 <= b.length) {
    if (b[i] !== 0xff) throw new Error('malformed jpeg')
    const marker = b[i + 1]
    if (marker === 0xff) {
      i++
      continue
    } // 填充字节
    if (marker === 0xda) {
      parts.push(b.subarray(i))
      return concat(parts)
    } // SOS：压缩数据原样照搬
    if (marker === 0xd9) {
      parts.push(b.subarray(i, i + 2))
      return concat(parts)
    } // EOI：正常结束
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      parts.push(b.subarray(i, i + 2))
      i += 2
      continue // 无长度段标记（SOI/RSTn/TEM）
    }
    if (i + 4 > b.length) throw new Error('malformed jpeg')
    const len = (b[i + 2] << 8) | b[i + 3]
    if (len < 2 || i + 2 + len > b.length) throw new Error('malformed jpeg')
    if (marker !== 0xe1 && marker !== 0xfe) parts.push(b.subarray(i, i + 2 + len))
    i += 2 + len
  }
  throw new Error('malformed jpeg')
}

/** PNG：剔除 eXIf 与文本块（tEXt/zTXt/iTXt），其余块（含各自 CRC）原样保留 */
function stripPng(b: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [b.subarray(0, 8)] // 签名
  let i = 8
  while (i + 8 <= b.length) {
    const len = ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0
    const type = ascii(b, i + 4, 4)
    const end = i + 12 + len
    if (end > b.length) throw new Error('malformed png')
    if (type !== 'eXIf' && type !== 'tEXt' && type !== 'zTXt' && type !== 'iTXt') parts.push(b.subarray(i, end))
    i = end
    if (type === 'IEND') return concat(parts)
  }
  throw new Error('malformed png')
}

/** WebP：剔除 EXIF/XMP 块并清 VP8X 对应标志位（0x08=EXIF, 0x04=XMP），重建 RIFF 总长度 */
function stripWebp(b: Uint8Array): Uint8Array {
  const kept: Uint8Array[] = []
  let i = 12 // 跳过 'RIFF' + size + 'WEBP'
  while (i + 8 <= b.length) {
    const type = ascii(b, i, 4)
    const size = (b[i + 4] | (b[i + 5] << 8) | (b[i + 6] << 16) | (b[i + 7] << 24)) >>> 0
    const total = 8 + size + (size & 1) // 块数据按偶数字节对齐
    if (i + total > b.length) throw new Error('malformed webp')
    if (type === 'EXIF' || type === 'XMP ') {
      i += total
      continue
    }
    let chunk = b.subarray(i, i + total)
    if (type === 'VP8X' && size >= 1) {
      chunk = chunk.slice()
      chunk[8] &= ~(0x08 | 0x04) // 清标志，避免阅读器寻找已被剔除的块
    }
    kept.push(chunk)
    i += total
  }
  const payload = concat([new Uint8Array([0x57, 0x45, 0x42, 0x50]), ...kept]) // 'WEBP'
  const head = new Uint8Array(8)
  head.set([0x52, 0x49, 0x46, 0x46]) // 'RIFF'
  const view = new DataView(head.buffer)
  view.setUint32(4, payload.byteLength, true)
  return concat([head, payload])
}

/**
 * 按识别出的格式剥离隐私元数据（JPEG EXIF/COM、PNG eXIf/文本块、WebP EXIF/XMP）。
 * GIF 无 EXIF 概念直接透传；解析失败返回 null，由调用方以 400 拒绝。
 */
export function stripMetadata(b: Uint8Array, kind: ImageKind): Uint8Array | null {
  try {
    if (kind.ext === 'jpg') return stripJpeg(b)
    if (kind.ext === 'png') return stripPng(b)
    if (kind.ext === 'webp') return stripWebp(b)
    return b
  } catch {
    return null
  }
}
