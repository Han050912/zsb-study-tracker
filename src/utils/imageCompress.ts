/**
 * 社区图片前端压缩：生成原图(full)与缩略图(thumb)两份 WebP。
 * - PNG/JPEG/WebP → full 转 WebP 0.82（原尺寸），thumb 转 WebP 0.82（640px 16:9 中心裁剪）
 * - GIF → full 保留原文件（动画不转），thumb 取首帧转 WebP
 */

function loadImage(file: File | Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => { URL.revokeObjectURL(url); resolve(img) }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片解码失败')) }
    img.src = url
  })
}

function canvasToWebp(canvas: HTMLCanvasElement, quality = 0.82): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('图片压缩失败'))), 'image/webp', quality)
  })
}

/** 缩略图：640×360（16:9），源图中心裁剪 */
async function makeThumb(img: HTMLImageElement): Promise<Blob> {
  const TW = 640, TH = 360
  const w = img.naturalWidth, h = img.naturalHeight
  if (!w || !h) throw new Error('图片尺寸无效')
  let sx = 0, sy = 0, sw = w, sh = h
  if (w / h > TW / TH) { sw = h * (TW / TH); sx = (w - sw) / 2 }
  else { sh = w / (TW / TH); sy = (h - sh) / 2 }
  const c = document.createElement('canvas')
  c.width = TW
  c.height = TH
  const ctx = c.getContext('2d')
  if (!ctx) throw new Error('Canvas 不可用')
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, TW, TH)
  return canvasToWebp(c)
}

export interface CompressedImage {
  full: Blob
  thumb: Blob
}

export async function compressImage(file: File): Promise<CompressedImage> {
  const isGif = file.type === 'image/gif'
  const img = await loadImage(file)
  const thumb = await makeThumb(img)
  if (isGif) return { full: file, thumb }
  const c = document.createElement('canvas')
  c.width = img.naturalWidth
  c.height = img.naturalHeight
  const ctx = c.getContext('2d')
  if (!ctx) throw new Error('Canvas 不可用')
  ctx.drawImage(img, 0, 0)
  const full = await canvasToWebp(c)
  return { full, thumb }
}
