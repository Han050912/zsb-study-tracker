import katex from 'katex'

/** 轻量 Markdown + LaTeX 渲染（$...$ 行内，$$...$$ 块级） */
export function renderMarkdown(src: string): string {
  let html = src
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  // 块级公式
  html = html.replace(/\$\$([\s\S]+?)\$\$/g, (_, tex) => {
    try { return katex.renderToString(tex.trim(), { displayMode: true, throwOnError: false }) } catch { return tex }
  })
  // 行内公式
  html = html.replace(/\$([^$\n]+?)\$/g, (_, tex) => {
    try { return katex.renderToString(tex.trim(), { throwOnError: false }) } catch { return tex }
  })
  // 标题
  html = html.replace(/^### (.*)$/gm, '<h3 class="font-bold text-base mt-3 mb-1">$1</h3>')
  html = html.replace(/^## (.*)$/gm, '<h2 class="font-bold text-lg mt-3 mb-1">$1</h2>')
  html = html.replace(/^# (.*)$/gm, '<h1 class="font-bold text-xl mt-3 mb-1">$1</h1>')
  // 粗体/斜体/行内代码
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>')
  html = html.replace(/`([^`]+)`/g, '<code class="bg-slate-100 dark:bg-slate-700 px-1 rounded text-xs">$1</code>')
  // 列表
  html = html.replace(/^- (.*)$/gm, '<li class="ml-4 list-disc">$1</li>')
  // 换行
  html = html.replace(/\n/g, '<br>')
  return html
}
