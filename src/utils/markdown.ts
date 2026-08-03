import MarkdownIt from 'markdown-it'
import katex from 'katex'

/**
 * Markdown 渲染引擎（markdown-it，对齐 Typora 解析标准）：
 * - 支持标题/列表（有序+无序+任务列表）/引用/代码块/表格/删除线/链接/图片/分割线
 * - 叠加 LaTeX 公式（$...$ 行内，$$...$$ 块级，KaTeX 渲染）
 * - html:false 原始 HTML 一律转义，配合 v-html 输出天然防 XSS
 */
const md: MarkdownIt = new MarkdownIt({
  html: false,
  linkify: true, // 自动识别 URL 为链接
  breaks: true,  // 单换行即 <br>，对齐 Typora 的默认换行行为
  typographer: false
})

// 所有链接在新标签页打开，防 noopener 风险
const defaultLinkOpen =
  md.renderer.rules.link_open ||
  ((tokens: any[], idx: number, options: any, _env: any, self: any) => self.renderToken(tokens, idx, options))
md.renderer.rules.link_open = (tokens: any[], idx: number, options: any, env: any, self: any) => {
  tokens[idx].attrSet('target', '_blank')
  tokens[idx].attrSet('rel', 'noopener noreferrer')
  return defaultLinkOpen(tokens, idx, options, env, self)
}

function renderKatex(tex: string, display: boolean): string {
  try {
    return katex.renderToString(tex.trim(), { displayMode: display, throwOnError: false })
  } catch {
    return tex
  }
}

// 公式占位符：纯文本标记，markdown-it 不会对其做任何转换
const PH = '@@ZSBMATH'

export function renderMarkdown(src: string): string {
  if (!src) return ''

  // 1. 先抽取公式为占位符，避免 markdown-it 处理公式内部特殊字符（_ * ~ 等）
  const maths: string[] = []
  const pushMath = (tex: string, display: boolean) => {
    maths.push(renderKatex(tex, display))
    return `${PH}${maths.length - 1}@@`
  }
  let text = src.replace(/\$\$([\s\S]+?)\$\$/g, (_m, tex: string) => pushMath(tex, true))
  text = text.replace(/\$([^$\n]+?)\$/g, (_m, tex: string) => pushMath(tex, false))

  // 2. markdown-it 主体渲染
  let html = md.render(text)

  // 3. GFM 任务列表（markdown-it 核心不含此语法，后处理注入复选框）
  html = html.replace(/<li>\[ \]/g, '<li class="task-list-item"><input type="checkbox" disabled />')
  html = html.replace(/<li>\[[xX]\]/g, '<li class="task-list-item"><input type="checkbox" disabled checked />')

  // 4. 还原公式为 KaTeX HTML（在 md.render 之后注入，不会被转义）
  html = html.replace(/@@ZSBMATH(\d+)@@/g, (_m, i: string) => maths[Number(i)] ?? '')
  return html
}
