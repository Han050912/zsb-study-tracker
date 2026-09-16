import { onScopeDispose, ref, watch } from 'vue'
import type { Ref } from 'vue'
import { renderMarkdown, hasMath, renderMarkdownWithMath } from '../utils/markdown'

/**
 * 预览渲染防抖窗口（ms）。取 200ms 的理由：
 * - 位于长文场景的经验区间 150~300ms 的中位，足以把「连续快速输入」的每一次按键
 *   合并成一次全量渲染（单次长文渲染耗时可达上百毫秒）；
 * - 同时低于 ~300ms 的可感知延迟门槛，打字间歇时预览相对文本态的滞后仍近似即时。
 */
const RENDER_DEBOUNCE_MS = 200

/** markdown 两阶段渲染：同步纯文本先出，含公式时 KaTeX 异步升级。返回响应式 html。
 *  seq 竞态守卫：source 快速变化时丢弃过期的异步渲染结果。
 *
 *  输入防抖：空闲后的首个变更立即渲染（保证首屏 / 切换笔记即时可见），其后的连续变更在
 *  同一防抖窗口内合并为一次渲染——长笔记分栏编辑时，文本态更新不再被全量 Markdown 重排阻塞。
 *
 *  pending（可选）：由消费方注入的布尔 ref；防抖等待或 KaTeX 异步升级进行中为 true，
 *  用于给出「渲染中」提示（不注入则不产生任何副作用）。 */
export function useMarkdownHtml(source: () => string, pending?: Ref<boolean>): Ref<string> {
  const html = ref('')
  let seq = 0
  let lastText: string | null = null
  let timer: ReturnType<typeof setTimeout> | null = null

  const setPending = (value: boolean) => {
    if (pending) pending.value = value
  }

  function render(text: string) {
    if (text === lastText) {
      setPending(false)
      return
    }
    lastText = text
    const s = ++seq
    setPending(true)
    html.value = renderMarkdown(text)
    if (hasMath(text)) {
      renderMarkdownWithMath(text)
        .then((r) => {
          if (s === seq) {
            html.value = r
            setPending(false)
          }
        })
        .catch(() => {
          /* KaTeX chunk 加载失败：保留纯文本占位，不阻塞内容展示 */
          if (s === seq) setPending(false)
        })
    } else {
      setPending(false)
    }
  }

  watch(
    source,
    (text) => {
      setPending(true)
      if (timer !== null) {
        // 处于连续输入中：仅重置尾部定时器，把这一轮变更合并为一次渲染
        clearTimeout(timer)
      } else {
        // 空闲后的首个变更：立即渲染，避免首屏 / 切换被防抖延迟
        render(text)
      }
      timer = setTimeout(() => {
        timer = null
        render(source())
      }, RENDER_DEBOUNCE_MS)
    },
    { immediate: true }
  )

  onScopeDispose(() => {
    if (timer !== null) clearTimeout(timer)
  })

  return html
}
