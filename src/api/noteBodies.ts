import { ApiError, authFetch } from './client'
import { getSessionVersion } from '../utils/session'

interface RemoteNoteBody {
  id: string
  content: string
  updatedAt: number
}

interface PutNoteBodyResult {
  applied: boolean
  updatedAt: number
  clamped: boolean
}

async function jsonOrError<T>(response: Response, action: string, version: number): Promise<T> {
  const data = await response.json().catch(() => null)
  if (version !== getSessionVersion()) throw new ApiError('登录状态已改变，请重试', 409)
  if (!response.ok) {
    throw Object.assign(new Error(data?.message || `${action}失败（HTTP ${response.status}）`), {
      status: response.status
    })
  }
  return data as T
}

export async function putNoteBody(id: string, content: string, updatedAt: number): Promise<PutNoteBodyResult> {
  const version = getSessionVersion()
  const response = await authFetch(`/api/note-bodies/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Updated-At': String(updatedAt)
    },
    body: content
  })
  return jsonOrError(response, '保存笔记正文', version)
}

/** 读取服务端权威的单篇正文上限（字节）：前端校验与服务端上限同源 */
export async function fetchNoteBodyLimit(): Promise<number> {
  const version = getSessionVersion()
  const response = await authFetch('/api/note-bodies/limit')
  return (await jsonOrError<{ maxBytes: number }>(response, '读取笔记正文上限', version)).maxBytes
}

export async function pullNoteBodies(ids: string[]): Promise<RemoteNoteBody[]> {
  const version = getSessionVersion()
  const response = await authFetch('/api/note-bodies/pull', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids })
  })
  return (await jsonOrError<{ bodies: RemoteNoteBody[] }>(response, '加载笔记正文', version)).bodies
}
