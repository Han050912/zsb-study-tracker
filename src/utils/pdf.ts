import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

// pdf.js Worker 走 Vite 静态资源，兼容子路径部署与 Electron app:// 协议
GlobalWorkerOptions.workerSrc = workerUrl

export interface PdfTextResult {
  title: string
  content: string
  pages: number
}

/**
 * 提取 PDF 全文文本（用于导入为笔记）。
 * 按页拼接，利用 hasEOL 尽量保留原始换行结构；页与页之间空行分隔。
 */
export async function extractPdfText(file: File): Promise<PdfTextResult> {
  const buf = await file.arrayBuffer()
  const doc = await getDocument({ data: buf }).promise
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
  await doc.destroy()
  const content = pageTexts.filter(Boolean).join('\n\n')
  return {
    title: file.name.replace(/\.[^.]+$/, ''),
    content,
    pages: numPages
  }
}
