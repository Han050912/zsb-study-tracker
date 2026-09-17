import { inject, ref, type InjectionKey } from 'vue'

/** 全局 toast 的签名（由 App.vue provide） */
export type ToastFn = (msg: string) => void

/** 注入键：统一 toast 的 provide/inject 契约，避免各处重复内联字面量与类型 */
export const TOAST_KEY: InjectionKey<ToastFn> = Symbol('toast')

/** 获取全局 toast；未被 provide 时退化为静默 no-op（与既有默认值行为一致） */
export function useToast(): ToastFn {
  return inject(TOAST_KEY, () => {})
}

/** 单条 toast：id 用于堆叠列表的 key 与定时器清理 */
export interface ToastItem {
  id: number
  message: string
}

/**
 * 创建 toast 队列（纯逻辑，与视图解耦便于测试）：
 * - 多条 toast 并存，按发起顺序堆叠展示，互不覆盖（旧实现是单条变量 + 共享定时器，后一条顶掉前一条）；
 * - 每条拥有独立定时器，到期仅移除自己；
 * - 单条移除时清理其定时器；dispose（组件卸载）时清理全部，不泄漏。
 */
export function createToastQueue(durationMs = 2000) {
  const toasts = ref<ToastItem[]>([])
  let nextId = 0
  const timers = new Map<number, ReturnType<typeof setTimeout>>()

  /** 移除单条并清理其定时器 */
  function remove(id: number) {
    const timer = timers.get(id)
    if (timer) {
      clearTimeout(timer)
      timers.delete(id)
    }
    toasts.value = toasts.value.filter((t) => t.id !== id)
  }

  function show(message: string) {
    const id = ++nextId
    toasts.value.push({ id, message })
    timers.set(
      id,
      setTimeout(() => remove(id), durationMs)
    )
  }

  /** 组件卸载：清理全部定时器与残留条目 */
  function dispose() {
    timers.forEach((timer) => clearTimeout(timer))
    timers.clear()
    toasts.value = []
  }

  return { toasts, show, remove, dispose }
}
