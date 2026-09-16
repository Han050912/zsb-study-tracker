import { authFetch } from './client'

export interface RemoteNoteBody {
  id: string
  content: string
  updatedAt: number
}

export interface PutNoteBodyResult {
  applied: boolean
  updatedAt: number
  clamped: boolean
}

async function jsonOrError<T>(response: Response, action: string): Promise<T> {
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    throw Object.assign(new Error(data?.message || `${action}失败（HTTP ${response.status}）`), {
      status: response.status
    })
  }
  return data as T
}

export async function putNoteBody(id: string, content: string, updatedAt: number): Promise<PutNoteBodyResult> {
  const response = await authFetch(`/api/note-bodies/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Updated-At': String(updatedAt)
    },
    body: content
  })
  return jsonOrError(response, '保存笔记正文')
}

/** 读取服务端权威的单篇正文上限（字节）：前端校验与服务端上限同源 */
export async function fetchNoteBodyLimit(): Promise<number> {
  const response = await authFetch('/api/note-bodies/limit')
  return (await jsonOrError<{ maxBytes: number }>(response, '读取笔记正文上限')).maxBytes
}

export async function pullNoteBodies(ids: string[]): Promise<RemoteNoteBody[]> {
  const response = await authFetch('/api/note-bodies/pull', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids })
  })
  return (await jsonOrError<{ bodies: RemoteNoteBody[] }>(response, '加载笔记正文')).bodies
}
