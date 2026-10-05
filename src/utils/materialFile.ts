/** 保留附件字节；UTF-8 文本显式声明编码，避免浏览器按系统默认编码打开。 */
export function materialFileBlob(dataUrl: string, fileName?: string): Blob {
  const comma = dataUrl.indexOf(',')
  if (!dataUrl.startsWith('data:') || comma < 0) throw new Error('附件格式无效')
  const metadata = dataUrl
    .slice(5, comma)
    .split(';')
    .map((part) => part.trim())
  if (!metadata.some((part) => part.toLowerCase() === 'base64')) throw new Error('附件编码格式无效')
  let mime = metadata[0]?.trim().toLowerCase() || 'application/octet-stream'
  const parameters = metadata.slice(1).filter((part) => part && part.toLowerCase() !== 'base64')
  const binary = atob(dataUrl.slice(comma + 1))
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))

  // 某些浏览器上传 TXT 时 File.type 为空；旧附件同样按原文件名补全类型。
  if (mime === 'application/octet-stream' && /\.txt$/i.test(fileName ?? '')) mime = 'text/plain'
  const isText =
    mime.startsWith('text/') || ['application/json', 'application/xml', 'application/javascript'].includes(mime)
  const hasCharset = parameters.some((part) => /^charset\s*=/i.test(part))
  if (isText && !hasCharset) {
    try {
      // 不转码 GBK/UTF-16 等非 UTF-8 文件，也不改变原文件中的 BOM 或换行。
      new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      parameters.push('charset=utf-8')
    } catch {
      // 无法确认 UTF-8 时保留未声明编码的原类型，交由浏览器按文件内容处理。
    }
  }
  return new Blob([bytes], { type: [mime, ...parameters].join(';') })
}
