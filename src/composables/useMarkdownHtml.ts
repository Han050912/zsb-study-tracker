import { ref, watchEffect } from 'vue'
import type { Ref } from 'vue'
import { renderMarkdown, hasMath, renderMarkdownWithMath } from '../utils/markdown'

/** markdown 两阶段渲染：同步纯文本先出，含公式时 KaTeX 异步升级。返回响应式 html。
 *  seq 竞态守卫：source 快速变化时丢弃过期的异步渲染结果。 */
export function useMarkdownHtml(source: () => string): Ref<string> {
  const html = ref('')
  let seq = 0
  watchEffect(() => {
    const text = source()
    const s = ++seq
    html.value = renderMarkdown(text)
    if (hasMath(text)) {
      renderMarkdownWithMath(text)
        .then((r) => {
          if (s === seq) html.value = r
        })
        .catch(() => {
          /* KaTeX chunk 加载失败：保留纯文本占位，不阻塞内容展示 */
        })
    }
  })
  return html
}
