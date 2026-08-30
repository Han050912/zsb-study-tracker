import type { PDFDocumentLoadingTask } from 'pdfjs-dist/types/src/display/api'
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'

type PdfjsModule = typeof import('pdfjs-dist/legacy/build/pdf.mjs')

let pdfjsPromise: Promise<PdfjsModule> | null = null

/** 模块级单例：首次查看 PDF 时加载 pdf.js；worker 走 Vite 静态资源 URL（app:// 协议兼容不变） */
function ensurePdfjs(): Promise<PdfjsModule> {
  pdfjsPromise ??= import('pdfjs-dist/legacy/build/pdf.mjs').then(m => {
    m.GlobalWorkerOptions.workerSrc = workerUrl
    return m
  }).catch(e => {
    pdfjsPromise = null   // 失败不缓存，下次可重试（与 useChart 的 echarts 处理同口径）
    throw e
  })
  return pdfjsPromise
}

/** 兼容性包装：关闭流式/自动抓取，强制全缓冲解析（异步版——pdf.js 按需加载） */
export async function getDocument(src: { data: Uint8Array }): Promise<PDFDocumentLoadingTask> {
  const pdfjs = await ensurePdfjs()
  return pdfjs.getDocument({ ...src, disableAutoFetch: true, disableStream: true })
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
