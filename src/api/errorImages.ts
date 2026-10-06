import { ApiError, authFetch } from './client'
import { getSessionVersion } from '../utils/session'

/**
 * 错题图片对象存储客户端：
 * - error_questions.image 仅存 'r2:<sha256>' 引用，字节存 R2（私有数据，走认证通道读取）
 * - id 由服务端对落盘字节计算（内容寻址）→ 重复上传/重复迁移覆盖同一对象，天然幂等
 */

/** 错题图片引用前缀 */
export const ERROR_IMAGE_PREFIX = 'r2:'

function errorImageRefOf(image: string): string {
  return image.slice(ERROR_IMAGE_PREFIX.length)
}

/** 上传错题图片字节（幂等：相同内容 → 服务端算出的同一 id），返回服务端计算的 id */
export async function uploadErrorImage(bytes: ArrayBuffer): Promise<string> {
  const version = getSessionVersion()
  const res = await authFetch(
    '/api/error-images',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: bytes
    },
    {},
    60_000
  )
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: '' }))
    throw Object.assign(new Error(err.message || `图片上传失败（HTTP ${res.status}）`), { status: res.status })
  }
  const data = (await res.json()) as { id?: string }
  if (version !== getSessionVersion()) throw new ApiError('登录状态已改变，请重试', 409)
  if (!data?.id) throw new Error('图片上传响应缺少 id')
  return data.id
}

/** 按内容 id 拉取错题图片字节 */
async function fetchErrorImage(id: string): Promise<Blob> {
  const version = getSessionVersion()
  const res = await authFetch(`/api/error-images/${id}`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: '' }))
    throw Object.assign(new Error(err.message || `图片加载失败（HTTP ${res.status}）`), { status: res.status })
  }
  const blob = await res.blob()
  if (version !== getSessionVersion()) throw new ApiError('登录状态已改变，请重试', 409)
  return blob
}

/** 会话级 blob URL 缓存（同一 id 只拉一次，跨组件复用） */
const urlCache = new Map<string, string>()
let cacheGeneration = 0
/** 进行中的请求（同一 id 并发挂载只发一次） */
const inflight = new Map<string, Promise<string>>()

/** 把 'r2:<id>' 引用解析为可直接渲染的 blob URL */
export async function resolveErrorImageUrl(image: string): Promise<string> {
  const id = errorImageRefOf(image)
  const cached = urlCache.get(id)
  if (cached) return cached
  const pending = inflight.get(id)
  if (pending) return pending
  const generation = cacheGeneration
  const task = fetchErrorImage(id)
    .then((blob) => {
      // authFetch 已返回响应头后，blob 读取仍可能跨越切号；旧字节不得进入新会话缓存。
      if (generation !== cacheGeneration) throw new Error('登录状态已改变，请重新加载图片')
      const url = URL.createObjectURL(blob)
      urlCache.set(id, url)
      return url
    })
    .finally(() => {
      if (inflight.get(id) === task) inflight.delete(id)
    })
  inflight.set(id, task)
  return task
}

/** 换账号 / 会话结束时清空缓存：blob URL 一并 revoke，防止跨账号复用遗留的已授权图片 */
export function clearErrorImageCache(): void {
  cacheGeneration++
  for (const url of urlCache.values()) URL.revokeObjectURL(url)
  urlCache.clear()
  inflight.clear()
}

/** base64 dataURL → 字节（存量数据迁移用）；非 dataURL（无逗号分隔）直接抛错，避免静默产出错误字节 */
export function dataUrlToBytes(dataUrl: string): ArrayBuffer {
  const comma = dataUrl.indexOf(',')
  if (comma < 0) throw new Error('非法的图片 dataURL')
  const base64 = dataUrl.slice(comma + 1)
  const bin = atob(base64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes.buffer
}
