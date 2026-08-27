import { useRoute, useRouter } from 'vue-router'
import { BACK_FALLBACK } from '../router/back'

/**
 * 统一返回逻辑（页面左上角「返回」按钮）。
 *
 * 1. 有站内历史（应用内导航进入）→ 原生 history.back 回退到真实来源页：
 *    从哪进入回哪，且彻底规避「前进式返回（push 到 from）」在父子二级页之间
 *    造成的返回死循环（如 circle-detail ↔ circles、follows ↔ profile）。
 * 2. 无站内历史（直接访问 / 刷新 / 深链进入）→ 兜底 replace 到 BACK_FALLBACK
 *    配置的父级；用 replace 而非 push，避免在历史栈累积冗余记录。
 */
export function useBack(fallback?: string) {
  const route = useRoute()
  const router = useRouter()

  function goBack() {
    const fb = fallback
      ?? (typeof route.name === 'string' ? BACK_FALLBACK[route.name] : undefined)
      ?? '/community'

    // 有可回退的站内历史时，优先浏览器式后退
    if (router.options.history.state.back) {
      router.back()
      return
    }

    // 无历史兜底：replace 到父级，不污染历史栈
    router.replace(fb)
  }

  return { goBack }
}
