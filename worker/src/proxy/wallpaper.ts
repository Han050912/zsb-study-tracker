import { on } from '../router'
import { HttpError } from '../db'
import { rateLimit } from '../middleware/rateLimit'

/**
 * 哲风壁纸（haowallpaper.com）静态壁纸代理。
 * - 列表接口 data 参数与响应均为 AES-128-CBC + Base64（密钥硬编码在该站前端 JS 中）
 * - 仅取 wpType:1 静态壁纸，随机页 + 随机条目
 * - 302 跳转到该站 previewFileImg 预览图（约 1100px WebP，gzip 传输，CDN 缓存 30 天）
 */

const LIST_API = 'https://haowallpaper.com/link/pc/wallpaper/wallpaperList'
const IMG_BASE = 'https://haowallpaper.com/link/common/file/previewFileImg/'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const KEY_BYTES = encoder.encode('68zhehao2O776519')
const IV_BYTES = encoder.encode('aa176b7519e84710')

let keyPromise: Promise<CryptoKey> | null = null
function getKey(): Promise<CryptoKey> {
  keyPromise ??= crypto.subtle.importKey('raw', KEY_BYTES, { name: 'AES-CBC' }, false, ['encrypt', 'decrypt'])
  return keyPromise
}

function toBase64(buf: ArrayBuffer): string {
  let s = ''
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b)
  return btoa(s)
}

async function encryptText(text: string): Promise<string> {
  const ct = await crypto.subtle.encrypt({ name: 'AES-CBC', iv: IV_BYTES }, await getKey(), encoder.encode(text))
  return toBase64(ct)
}

async function decryptText(b64: string): Promise<string> {
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
  const pt = await crypto.subtle.decrypt({ name: 'AES-CBC', iv: IV_BYTES }, await getKey(), bytes)
  // 站点明文尾部可能带 \0 填充
  return decoder.decode(pt).replace(/\0.*$/g, '')
}

interface ListItem { fileId?: string; type?: number; rw?: string; rh?: string }

/** 拉取一页静态壁纸列表，优先返回高清横图（原图宽 ≥1920 的 fileId 数组） */
async function fetchFileIds(page: number): Promise<string[]> {
  const data = await encryptText(JSON.stringify({ page, sortType: 3, rows: 12, isFavorites: false, wpType: 1 }))
  const res = await fetch(`${LIST_API}?data=${encodeURIComponent(data)}`, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new HttpError(502, `壁纸列表请求失败（HTTP ${res.status}）`)
  const json = await res.json() as { data?: string }
  if (!json.data) return []
  const plain = JSON.parse(await decryptText(json.data)) as { list?: ListItem[] }
  // 只保留静态图片类型（type=1）
  const statics = (plain.list || []).filter(i => i.type === 1 && i.fileId)
  // 优先高清横图（适配桌面全屏背景；预览图由原图缩放生成，原图越清晰预览越好）
  const hd = statics.filter(i => Number(i.rw) >= 1920 && Number(i.rw) > Number(i.rh))
  return (hd.length ? hd : statics).map(i => i.fileId!)
}

/** 服务端取图并转发。该站对跨域 Referer 防盗链（浏览器直连返回 403），必须经 Worker 取图。 */
async function fetchImage(fileId: string): Promise<Response> {
  const res = await fetch(`${IMG_BASE}${fileId}`, {
    headers: { 'User-Agent': UA, Referer: 'https://www.haowallpaper.com/' }
  })
  if (!res.ok) throw new HttpError(502, `壁纸图片请求失败（HTTP ${res.status}）`)
  const buf = await res.arrayBuffer()
  // Worker fetch 已透明解压 gzip；内容实为 WebP（RIFF....WEBP 魔数），按魔数修正 Content-Type
  const b = new Uint8Array(buf)
  const isWebP = b.length > 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  return new Response(buf, {
    headers: {
      'Content-Type': isWebP ? 'image/webp' : (res.headers.get('Content-Type') || 'image/jpeg'),
      'Cache-Control': 'public, max-age=300'
    }
  })
}

export function registerWallpaperRoutes() {
  // 随机静态壁纸：Worker 取图转发（公开路由，IP 限流防滥用）
  on('GET', '/api/proxy/wallpaper', false, async (ctx) => {
    rateLimit(ctx.request, 'wallpaper', 30, 60_000)
    // 站点当前约 3000+ 页；页码越界返回空列表时回退第 1 页
    for (const page of [1 + Math.floor(Math.random() * 3000), 1]) {
      const ids = await fetchFileIds(page)
      if (ids.length) {
        const fileId = ids[Math.floor(Math.random() * ids.length)]
        return fetchImage(fileId)
      }
    }
    throw new HttpError(502, '未获取到可用壁纸')
  })
}
