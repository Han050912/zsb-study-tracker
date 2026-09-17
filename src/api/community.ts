import { authFetch, API_BASE, handleUnauthorized, ApiError } from './client'
import { desktopAuthHeaders } from '../utils/session'
import { compressImage } from '../utils/imageCompress'

/** 单张图片上限 5MB，与 worker/src/api/uploads.ts 保持一致 */
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024
/** 单帖最多 9 张 */
export const IMAGE_MAX_PER_POST = 9
/** 单条评论最多 3 张 */
export const IMAGE_MAX_PER_COMMENT = 3
/** 单条私信最多 3 张 */
export const IMAGE_MAX_PER_MESSAGE = 3

/** 服务端返回的图片路径转绝对地址（图片为公开路由，<img> 直接引用） */
export const imageUrl = (path: string) => `${API_BASE}${path}`

/** 上传头像（裸二进制 256×256 裁剪图；服务端写入 user_settings.avatar 并返回新 URL） */
export async function uploadAvatar(blob: Blob): Promise<{ url: string }> {
  const res = await authFetch('/api/community/upload?variant=avatar', { method: 'POST', body: blob }, {}, 60_000)
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: '上传失败' }))
    throw Object.assign(new Error(err.message || `HTTP ${res.status}`), { status: res.status })
  }
  return res.json()
}

/** 上传结果 */
interface UploadResult {
  id: string
  url: string
  size: number
  contentType: string
}

/**
 * 上传社区图片（XMLHttpRequest 以获得上传进度回调；fetch 不支持 upload progress）。
 * onProgress 收到 0-1 的进度值；失败抛出带服务端提示的 Error。
 */
export function uploadImage(file: File, onProgress?: (ratio: number) => void): Promise<UploadResult> {
  return new Promise((resolve, reject) => {
    void (async () => {
      // 前端压缩：full（原图 WebP/GIF）+ thumb（640 缩略图 WebP）
      let full: Blob, thumb: Blob
      try {
        const c = await compressImage(file)
        full = c.full
        thumb = c.thumb
      } catch (e) {
        reject(e)
        return
      }

      const postBlob = (url: string, blob: Blob, onDone: (data: any) => void) => {
        const xhr = new XMLHttpRequest()
        xhr.open('POST', url)
        // Web 端会话在 HttpOnly Cookie（withCredentials），桌面端走 Authorization Bearer + 桌面令牌
        const authHeaders = desktopAuthHeaders()
        if (Object.keys(authHeaders).length) {
          for (const [k, v] of Object.entries(authHeaders)) xhr.setRequestHeader(k, v)
        } else {
          xhr.withCredentials = true
        }
        xhr.setRequestHeader('Content-Type', blob.type || 'application/octet-stream')
        // 大图弱网上传可能较慢，给 60s 硬超时（fetch 通道的默认 30s 对应不到 XHR）
        xhr.timeout = 60_000
        xhr.ontimeout = () => reject(new ApiError('上传超时，请重试', 408))
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) onProgress?.(Math.min(1, e.loaded / e.total))
        }
        xhr.onload = () => {
          let data: any = null
          try {
            data = JSON.parse(xhr.responseText)
          } catch {
            /* 非 JSON */
          }
          if (xhr.status >= 200 && xhr.status < 300) {
            onDone(data)
            return
          }
          if (xhr.status === 401) {
            let settled = false
            try {
              handleUnauthorized()
            } catch (e) {
              settled = true
              reject(e)
            }
            // handleUnauthorized 为 never（总会 throw），此行为兜底，确保 Promise 必然 settle
            if (!settled) reject(new ApiError('登录已过期，请重新登录', 401))
            return
          }
          reject(new ApiError(data?.message || `上传失败（HTTP ${xhr.status}）`, xhr.status))
        }
        xhr.onerror = () => reject(new Error('网络错误，上传失败'))
        xhr.send(blob)
      }

      // 1. 上传原图 → 拿 id
      postBlob(
        `${API_BASE}/api/community/upload?filename=${encodeURIComponent(file.name.slice(0, 100))}`,
        full,
        (res) => {
          if (!res?.id) {
            reject(new Error('上传返回异常'))
            return
          }
          // 2. 上传缩略图，关联到原图 id
          postBlob(`${API_BASE}/api/community/upload?variant=thumb&id=${encodeURIComponent(res.id)}`, thumb, () => {
            // 两段上传各自的 onprogress 未必以 1 收尾（小缩略图可能不派发 100% 事件），完成时显式归 1，
            // 保证调用方按 progress >= 1 判定「上传完成」的响应式状态能正确解除
            onProgress?.(1)
            resolve(res as UploadResult)
          })
        }
      )
    })().catch(reject)
  })
}
