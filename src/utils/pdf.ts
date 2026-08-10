import { getDocument as _getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs'
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
import type { PDFDocumentLoadingTask } from 'pdfjs-dist/types/src/display/api'

// pdf.js Worker 走 Vite 静态资源，兼容子路径部署与 Electron app:// 协议
GlobalWorkerOptions.workerSrc = workerUrl

/** 兼容性包装：关闭流式/自动抓取，强制全缓冲解析，提高对不同 PDF 生成器的兼容性 */
export function getDocument(src: Parameters<typeof _getDocument>[0]): PDFDocumentLoadingTask {
  return _getDocument({ ...src, disableAutoFetch: true, disableStream: true })
}

/**
 * 将 pdf.js 异常归类为用户可读的提示。
 * 使用 e.name（BaseException 构造时显式赋值，生产压缩后不变）而非 e.constructor.name（压缩会被 mangled）。
 */
export function classifyPdfError(e: unknown): string {
  if (!(e instanceof Error)) return 'PDF 解析失败'
  const { name } = e
  if (name === 'PasswordException') return 'PDF 受密码保护，请在外部解除密码后重试'
  if (name === 'InvalidPDFException') return 'PDF 格式不兼容（非标准结构），建议用其它工具重新导出'
  if (name === 'MissingPDFException') return 'PDF 数据为空，请检查文件'
  return `PDF 解析错误: ${e.message}`
}
