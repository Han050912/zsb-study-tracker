/** 笔记域 */

/** 笔记 */
export interface Note {
  id: string
  subjectId: string
  title: string
  tags: string[]
  updatedAt: number
  /** Markdown 正文版本；正文存 IndexedDB + 云端独立分片，PDF 恒为 0 */
  bodyUpdatedAt: number
  /** 缺省为 Markdown 笔记；'pdf' 表示 PDF 原文笔记（以查看器渲染，不可编辑正文） */
  type?: 'pdf'
}
