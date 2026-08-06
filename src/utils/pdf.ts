import { getDocument as _getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs'
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
import type { PDFDocumentLoadingTask } from 'pdfjs-dist/types/src/display/api'

// pdf.js Worker 走 Vite 静态资源，兼容子路径部署与 Electron app:// 协议
GlobalWorkerOptions.workerSrc = workerUrl

/** 兼容性包装：关闭流式/自动抓取，强制全缓冲解析，提高对不同 PDF 生成器的兼容性 */
export function getDocument(src: Parameters<typeof _getDocument>[0]): PDFDocumentLoadingTask {
  return _getDocument({ ...src, disableAutoFetch: true, disableStream: true })
}

export interface PdfTextResult {
  title: string
  content: string
  pages: number
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

/**
 * 提取 PDF 全文文本（用于导入为笔记）。
 * 按页拼接，利用 hasEOL 尽量保留原始换行结构；页与页之间空行分隔。
 */
export async function extractPdfText(file: File): Promise<PdfTextResult> {
  const buf = await file.arrayBuffer()
  const loadingTask = getDocument({ data: buf })
  const doc = await loadingTask.promise
  const numPages = doc.numPages
  const pageTexts: string[] = []
  for (let p = 1; p <= numPages; p++) {
    const page = await doc.getPage(p)
    const tc = await page.getTextContent()
    let text = ''
    for (const item of tc.items) {
      if ('str' in item) {
        text += item.str
        // hasEOL 标记行尾，还原换行；否则补空格防止词粘连
        text += item.hasEOL ? '\n' : ' '
      }
    }
    pageTexts.push(text.trim())
    page.cleanup()
  }
  await loadingTask.destroy()
  const content = pageTexts.filter(Boolean).join('\n\n')
  return {
    title: file.name.replace(/\.[^.]+$/, ''),
    content,
    pages: numPages
  }
}
