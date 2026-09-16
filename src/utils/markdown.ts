import MarkdownIt from 'markdown-it'

/**
 * Markdown 渲染引擎（markdown-it，对齐 Typora 解析标准）：
 * - 支持标题/列表（有序+无序+任务列表）/引用/代码块/表格/删除线/链接/图片/分割线
 * - 叠加 LaTeX 公式（$...$ 行内，$$...$$ 块级，KaTeX 渲染）
 * - html:false 原始 HTML 一律转义，配合 v-html 输出天然防 XSS
 *
 * 性能：KaTeX（JS + CSS，约 376KB）不静态引入，仅 renderMarkdownWithMath 首次调用时
 * 动态 import 进异步 chunk；renderMarkdown 同步路径零 katex 依赖，
 * 无公式内容输出与历史版本逐字节一致。
 */
const md: InstanceType<typeof MarkdownIt> = new MarkdownIt({
  html: false,
  linkify: true, // 自动识别 URL 为链接
  breaks: true, // 单换行即 <br>，对齐 Typora 的默认换行行为
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

type Katex = (typeof import('katex'))['default']

function renderKatex(katex: Katex, tex: string, display: boolean): string {
  try {
    return katex.renderToString(tex.trim(), { displayMode: display, throwOnError: false })
  } catch {
    // 极端情况下 KaTeX 抛错时，返回转义后的原文，防止未转义用户输入注入 HTML（XSS）
    return md.utils.escapeHtml(tex)
  }
}

// 公式占位符前缀：实际占位符为 `@@ZSBMATH<本次渲染随机盐><序号>@@`，
// markdown-it（html:false）不会转换其中的任何字符（@、字母、数字原样透传）。
const PH_PREFIX = '@@ZSBMATH'

/** 生成一个「完整占位符形态」不可能出现在原始正文中的随机盐（P2-11）：
 *  若用户正文（含代码块）恰好含有形如 @@ZSBMATH<盐><序号>@@ 的串则换盐重试。
 *  由于占位符中的每个字符在 markdown-it 输出中原样透传、不会被拼接改造，
 *  「输出中出现的占位符必然源自本函数插入的 token」由该验证保证，
 *  还原步骤绝不会命中或吞掉用户正文，从根源上杜绝占位符与正文冲突。 */
function pickPlaceholderSalt(src: string): string {
  for (;;) {
    const salt = Math.random().toString(36).slice(2, 10)
    if (!new RegExp(`${PH_PREFIX}${salt}\\d+@@`).test(src)) return salt
  }
}

const BLOCK_MATH_RE = /\$\$([\s\S]+?)\$\$/g
const INLINE_MATH_RE = /\$([^$\n]+?)\$/g

/** 定界符 $ 是否被反斜杠转义（如 `\$5` 表示字面美元符号，不是公式） */
function isEscapedDollar(src: string, matchOffset: number): boolean {
  return matchOffset > 0 && src[matchOffset - 1] === '\\'
}

/**
 * 是否含 LaTeX 公式标记（$$...$$ 或 $...$；\$ 转义除外）。
 * 与下方抽取正则同规则，保证 hasMath 为真时 renderMarkdownWithMath 必有公式可渲染。
 */
export function hasMath(src: string): boolean {
  if (!src) return false
  const unescaped = src.replace(/\\\$/g, '')
  return /\$\$[\s\S]+?\$\$/.test(unescaped) || /\$[^$\n]+?\$/.test(unescaped)
}

/**
 * 渲染主流程（与历史版本行为一致）：
 * 1. 先抽取公式为占位符 token，避免 markdown-it 处理公式内部特殊字符（_ * ~ 等）；
 *    占位符含每次渲染唯一的随机盐，且已验证与原始正文不相交（见 pickPlaceholderSalt）
 * 2. markdown-it 主体渲染
 * 3. GFM 任务列表（markdown-it 核心不含此语法，后处理注入复选框）
 * 4. 还原公式 token（在 md.render 之后注入，不会被转义；仅命中本次渲染插入的 token）
 * renderMath 决定数学段的最终形态：同步路径为代码样式占位，异步路径为 KaTeX HTML。
 */
function renderInternal(src: string, renderMath: (tex: string, display: boolean) => string): string {
  const phPrefix = PH_PREFIX + pickPlaceholderSalt(src)
  const restoreRe = new RegExp(`${phPrefix}(\\d+)@@`, 'g')

  const maths: string[] = []
  const pushMath = (tex: string, display: boolean) => {
    maths.push(renderMath(tex, display))
    return `${phPrefix}${maths.length - 1}@@`
  }
  let text = src.replace(BLOCK_MATH_RE, (m: string, tex: string, offset: number, s: string) =>
    isEscapedDollar(s, offset) ? m : pushMath(tex, true)
  )
  text = text.replace(INLINE_MATH_RE, (m: string, tex: string, offset: number, s: string) =>
    isEscapedDollar(s, offset) ? m : pushMath(tex, false)
  )

  let html = md.render(text)

  html = html.replace(/<li>\[ \]/g, '<li class="task-list-item"><input type="checkbox" disabled />')
  html = html.replace(/<li>\[[xX]\]/g, '<li class="task-list-item"><input type="checkbox" disabled checked />')

  html = html.replace(restoreRe, (_m: string, i: string) => maths[Number(i)] ?? '')
  return html
}

/**
 * 同步渲染（不加载 KaTeX）：无公式内容输出与历史版本逐字节一致；
 * 含公式时数学段先以代码样式占位（tex 原文经 escapeHtml 转义，无 XSS 风险），
 * 由消费方随后调用 renderMarkdownWithMath 异步升级为 KaTeX 渲染。
 */
export function renderMarkdown(src: string): string {
  if (!src) return ''
  return renderInternal(src, (tex, display) =>
    display
      ? `<pre class="md-math-pending"><code>${md.utils.escapeHtml(tex)}</code></pre>`
      : `<code class="md-math-pending">${md.utils.escapeHtml(tex)}</code>`
  )
}

let katexPromise: Promise<Katex> | null = null

/** 首次公式渲染时动态加载 KaTeX（JS 与 CSS 均归入异步 chunk，不进首屏）；后续调用复用缓存 */
function loadKatex(): Promise<Katex> {
  if (!katexPromise) {
    // 加载失败（如网络抖动）时清空缓存，允许下次渲染重试，避免会话内公式永久停在占位样式
    katexPromise = Promise.all([import('katex'), import('katex/dist/katex.min.css')])
      .then(([m]) => m.default)
      .catch((e) => {
        katexPromise = null
        throw e
      })
  }
  return katexPromise
}

/**
 * 含公式的完整渲染：动态加载 KaTeX 后按本次渲染的唯一随机盐占位符渲染（P2-11）；
 * 无公式时直接返回 renderMarkdown 的同步结果。
 */
export async function renderMarkdownWithMath(src: string): Promise<string> {
  if (!src || !hasMath(src)) return renderMarkdown(src)
  const katex = await loadKatex()
  return renderInternal(src, (tex, display) => renderKatex(katex, tex, display))
}
