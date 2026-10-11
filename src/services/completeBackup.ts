import type { AppState } from '../types'
import { PDF_MAX_BYTES } from '../api/pdfs'

export type BackupData = AppState & { noteBodies?: Record<string, { content: string; updatedAt: number }> }
export interface BackupAttachment {
  kind: 'pdf' | 'error-image'
  id: string
  mediaType: string
  size: number
  sha256: string
  base64: string
}
export interface CompleteBackup {
  format: 'zsb-study-backup'
  version: 2
  createdAt: number
  data: BackupData
  attachments: BackupAttachment[]
}

const IMAGE_MAX_BYTES = 5 * 1024 * 1024
/** Bound decoding and JSON memory use before accepting a local backup file. */
export const BACKUP_MAX_FILE_BYTES = 192 * 1024 * 1024
const MAX_ATTACHMENT_BYTES = 128 * 1024 * 1024
const HASH_RE = /^[a-f0-9]{64}$/
const ID_RE = /^[a-z0-9]+$/

/** Export and import share the total UTF-8 file limit, including base64 and text. */
export function serializeCompleteBackup(backup: CompleteBackup, maxBytes = BACKUP_MAX_FILE_BYTES): string {
  const json = JSON.stringify(backup)
  if (new Blob([json]).size > maxBytes) throw new Error('完整备份超过 192MB 文件上限，请减少附件或文字后重试')
  return json
}

function fail(message: string): never {
  throw new Error(message)
}

function mimeOf(bytes: Uint8Array): string | null {
  const head = String.fromCharCode(...bytes.subarray(0, 12))
  if (head.startsWith('%PDF-')) return 'application/pdf'
  if (head.startsWith('\x89PNG\r\n\x1a\n')) return 'image/png'
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (head.startsWith('GIF87a') || head.startsWith('GIF89a')) return 'image/gif'
  if (head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP') return 'image/webp'
  return null
}

function encode(bytes: Uint8Array): string {
  const parts: string[] = []
  for (let start = 0; start < bytes.length; start += 32768) {
    parts.push(String.fromCharCode(...bytes.subarray(start, start + 32768)))
  }
  return btoa(parts.join(''))
}

function decode(base64: string, maxBytes: number): Uint8Array {
  if (!base64 || base64.length > Math.ceil(maxBytes / 3) * 4 || base64.length % 4 !== 0) {
    fail('备份附件为空或超过大小上限')
  }
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) fail('备份附件编码不正确')
  const binary = atob(base64)
  if (binary.length > maxBytes) fail('备份附件超过大小上限')
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  if (encode(bytes) !== base64) fail('备份附件编码不正确')
  return bytes
}

async function hash(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice().buffer)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** Runtime validation is deliberately independent of network and state mutations. */
export async function validateCompleteBackup(
  value: unknown,
  validData: (data: unknown) => boolean
): Promise<CompleteBackup> {
  const backup = value as CompleteBackup | null
  if (
    !backup ||
    backup.format !== 'zsb-study-backup' ||
    backup.version !== 2 ||
    !Number.isSafeInteger(backup.createdAt) ||
    backup.createdAt < 0 ||
    !validData(backup.data) ||
    !Array.isArray(backup.attachments)
  )
    fail('备份格式或版本不正确')
  const expected = new Map<string, 'pdf' | 'error-image'>()
  for (const note of backup.data.notes) {
    if (note.type === 'pdf') {
      if (!ID_RE.test(note.id)) fail('备份 PDF 标识不正确')
      expected.set(`pdf:${note.id}`, 'pdf')
    } else if (!Object.prototype.hasOwnProperty.call(backup.data.noteBodies ?? {}, note.id)) {
      fail(`备份缺少笔记「${note.title}」的正文`)
    }
  }
  for (const question of backup.data.errorQuestions) {
    if (!question.image) continue
    if (!/^r2:[a-f0-9]{64}$/.test(question.image)) fail('完整备份中存在未打包的错题图片')
    expected.set(`error-image:${question.image.slice(3)}`, 'error-image')
  }
  const seen = new Set<string>()
  let totalBytes = 0
  for (const attachment of backup.attachments) {
    if (!attachment || (attachment.kind !== 'pdf' && attachment.kind !== 'error-image')) fail('备份附件类型不正确')
    const key = `${attachment.kind}:${attachment.id}`
    if (!expected.has(key) || seen.has(key)) fail('备份附件引用缺失、重复或多余')
    seen.add(key)
    if (!Number.isSafeInteger(attachment.size) || attachment.size <= 0 || !HASH_RE.test(attachment.sha256)) {
      fail('备份附件大小或校验值不正确')
    }
    totalBytes += attachment.size
    if (totalBytes > MAX_ATTACHMENT_BYTES) fail('备份附件总大小超过 128MB 上限')
    if (typeof attachment.base64 !== 'string') fail('备份附件编码不正确')
    const bytes = decode(attachment.base64, attachment.kind === 'pdf' ? PDF_MAX_BYTES : IMAGE_MAX_BYTES)
    if (bytes.length !== attachment.size || (await hash(bytes)) !== attachment.sha256)
      fail('备份附件校验失败，文件可能已损坏')
    const mime = mimeOf(bytes)
    if (!mime || mime !== attachment.mediaType || (attachment.kind === 'pdf') !== (mime === 'application/pdf')) {
      fail('备份附件内容与文件类型不符')
    }
    if (attachment.kind === 'error-image' && attachment.id !== attachment.sha256) fail('备份图片引用与内容不符')
  }
  if (seen.size !== expected.size) fail('备份缺少 PDF 或错题图片，无法完整恢复')
  return backup
}

export interface BackupReadPorts {
  readPdf(id: string): Promise<Uint8Array>
  readImage(id: string): Promise<Blob>
  assertCurrent(): void
}

/** Text bodies are collected strictly by the caller before gathering the binary attachments. */
export async function createCompleteBackup(data: BackupData, ports: BackupReadPorts): Promise<CompleteBackup> {
  const copy = JSON.parse(JSON.stringify(data)) as BackupData
  const attachments: BackupAttachment[] = []
  const images = new Set<string>()
  let totalBytes = 0
  async function add(kind: BackupAttachment['kind'], id: string, bytes: Uint8Array): Promise<string> {
    const mime = mimeOf(bytes)
    const limit = kind === 'pdf' ? PDF_MAX_BYTES : IMAGE_MAX_BYTES
    if (!mime || !bytes.length || bytes.length > limit || (kind === 'pdf') !== (mime === 'application/pdf')) {
      fail('附件损坏或超过大小上限，已停止完整备份')
    }
    const sha256 = await hash(bytes)
    ports.assertCurrent()
    const actualId = kind === 'pdf' ? id : sha256
    if (kind === 'error-image' && images.has(actualId)) return actualId
    totalBytes += bytes.length
    if (totalBytes > MAX_ATTACHMENT_BYTES) fail('附件总大小超过 128MB，无法生成单个完整备份')
    attachments.push({ kind, id: actualId, mediaType: mime, size: bytes.length, sha256, base64: encode(bytes) })
    if (kind === 'error-image') images.add(actualId)
    return actualId
  }
  for (const note of copy.notes) {
    if (note.type !== 'pdf') continue
    ports.assertCurrent()
    await add('pdf', note.id, await ports.readPdf(note.id))
  }
  for (const question of copy.errorQuestions) {
    if (!question.image) continue
    ports.assertCurrent()
    if (question.image.startsWith('r2:')) {
      const id = question.image.slice(3)
      if (!HASH_RE.test(id)) fail('错题图片引用不正确，已停止完整备份')
      if (images.has(id)) continue
      const blob = await ports.readImage(id)
      const actualId = await add('error-image', id, new Uint8Array(await blob.arrayBuffer()))
      if (actualId !== id) fail('云端图片校验失败，已停止完整备份')
    } else {
      const match = /^data:image\/(?:png|jpeg|webp|gif);base64,([A-Za-z0-9+/=]+)$/.exec(question.image)
      if (!match) fail('错题图片不支持完整备份，请先重新上传图片')
      question.image = `r2:${await add('error-image', '', decode(match[1]!, IMAGE_MAX_BYTES))}`
    }
  }
  ports.assertCurrent()
  return { format: 'zsb-study-backup', version: 2, createdAt: Date.now(), data: copy, attachments }
}

export interface BackupRestorePorts {
  newPdfId(): string
  uploadPdf(id: string, file: File): Promise<void>
  uploadImage(bytes: ArrayBuffer): Promise<string>
  deletePdf(id: string): Promise<void>
  assertCurrent(): void
  progress?(message: string): void
  /** Injectable clock for tests; production waits in short, account-checked intervals. */
  wait?(milliseconds: number): Promise<void>
}

type ImageRestorePorts = Pick<BackupRestorePorts, 'uploadImage' | 'assertCurrent' | 'progress' | 'wait'>

async function uploadBackupImage(
  bytes: ArrayBuffer,
  ports: ImageRestorePorts,
  completed: number,
  total: number
): Promise<string> {
  const wait =
    ports.wait ??
    (async (milliseconds: number) => {
      for (let remaining = milliseconds; remaining > 0; remaining -= 1000) {
        await new Promise((resolve) => setTimeout(resolve, Math.min(remaining, 1000)))
        ports.assertCurrent()
      }
    })
  for (let retries = 0; ; retries++) {
    ports.assertCurrent()
    try {
      return await ports.uploadImage(bytes)
    } catch (error) {
      if ((error as { status?: number } | null)?.status !== 429 || retries >= 2) throw error
      // Retry only this attachment, retaining the progress of successful uploads.
      ports.progress?.(`已恢复 ${completed}/${total} 个附件，上传限流中，约 1 分钟后自动继续…`)
      await wait(61_000)
      ports.assertCurrent()
    }
  }
}

/** Repair a blocked restore using the original validated file, without replacing current data. */
export async function repairBackupImages(
  backup: CompleteBackup,
  imageIds: ReadonlyMap<string, string>,
  ports: ImageRestorePorts
): Promise<void> {
  const images = backup.attachments.filter(
    (attachment) => attachment.kind === 'error-image' && imageIds.has(attachment.id)
  )
  if (images.length !== imageIds.size) fail('待恢复图片不在该文件中，请选择上次恢复使用的完整备份')
  for (const [index, attachment] of images.entries()) {
    const bytes = decode(attachment.base64, IMAGE_MAX_BYTES)
    const id = await uploadBackupImage(bytes.slice().buffer, ports, index, images.length)
    ports.assertCurrent()
    if (id !== imageIds.get(attachment.id)) fail('图片恢复响应与备份不符，已停止恢复')
    ports.progress?.(`正在补回待恢复图片：${index + 1}/${images.length}`)
  }
}

/** All bytes must pass validateCompleteBackup before this function can upload any files. */
export async function prepareBackupRestore(backup: CompleteBackup, ports: BackupRestorePorts): Promise<BackupData> {
  const data = JSON.parse(JSON.stringify(backup.data)) as BackupData
  const preparedPdfs: string[] = []
  let completed = 0
  try {
    for (const attachment of backup.attachments) {
      ports.assertCurrent()
      const bytes = decode(attachment.base64, attachment.kind === 'pdf' ? PDF_MAX_BYTES : IMAGE_MAX_BYTES)
      if (attachment.kind === 'pdf') {
        // Fresh ids make failed preparation incapable of overwriting an existing document.
        const id = ports.newPdfId()
        preparedPdfs.push(id)
        await ports.uploadPdf(id, new File([bytes.slice().buffer], `${id}.pdf`, { type: 'application/pdf' }))
        ports.assertCurrent()
        data.notes.find((note) => note.id === attachment.id)!.id = id
      } else {
        const id = await uploadBackupImage(bytes.slice().buffer, ports, completed, backup.attachments.length)
        ports.assertCurrent()
        if (!HASH_RE.test(id)) fail('图片恢复响应不正确')
        for (const question of data.errorQuestions) {
          if (question.image === `r2:${attachment.id}`) question.image = `r2:${id}`
        }
      }
      completed++
      ports.progress?.(`正在恢复附件：${completed}/${backup.attachments.length}`)
    }
    ports.assertCurrent()
    return data
  } catch (error) {
    for (const id of preparedPdfs) {
      try {
        ports.assertCurrent()
        await ports.deletePdf(id)
      } catch {
        /* Never clean up through a different account; old data remains untouched. */
      }
    }
    throw error
  }
}
