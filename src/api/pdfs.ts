import { authFetch } from './client'

/**
 * PDF 原文云端存储（Worker + D1 分片）：
 * - 导入时二进制直传 /api/pdfs/:id，笔记 content 仅存 'd1:<id>' 引用，
 *   避免 base64 膨胀与全量同步反复搬运大文件
 * - 阅读时按引用回源拉取字节，交给 pdf.js 渲染
 */

/** 单文件上限 30MB，与 Worker 端 worker/src/api/pdfs.ts 保持一致 */
export const PDF_MAX_BYTES = 30 * 1024 * 1024
export const PDF_MAX_MB = PDF_MAX_BYTES / 1024 / 1024

/** PDF 笔记 content 的引用前缀 */
export const PDF_REF_PREFIX = 'd1:'

export const pdfRefOf = (content: string) => content.slice(PDF_REF_PREFIX.length)

async function ensureOk(res: Response, action: string): Promise<void> {
  if (res.ok) return
  const err = await res.json().catch(() => ({ message: '' }))
  throw Object.assign(new Error(err.message || `${action}失败（HTTP ${res.status}）`), { status: res.status })
}

/** 上传 PDF 原文（覆盖同 id 对象）。超限时抛出带服务端提示的 Error */
export async function uploadPdf(id: string, file: File): Promise<void> {
  const res = await authFetch(`/api/pdfs/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/pdf' },
    body: file
  })
  await ensureOk(res, '上传')
}

/** 按引用 id 拉取 PDF 字节 */
export async function fetchPdf(id: string): Promise<Uint8Array> {
  const res = await authFetch(`/api/pdfs/${id}`)
  await ensureOk(res, '加载 PDF')
  return new Uint8Array(await res.arrayBuffer())
}

/** 删除云端 PDF 原文（笔记删除时联动；失败静默——同步接口会兜底清理孤儿对象） */
export async function deletePdf(id: string): Promise<void> {
  const res = await authFetch(`/api/pdfs/${id}`, { method: 'DELETE' })
  if (!res.ok) console.warn(`删除云端 PDF ${id} 失败（HTTP ${res.status}），将由同步清理兜底`)
}
