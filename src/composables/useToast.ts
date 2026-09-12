import { inject, type InjectionKey } from 'vue'

/** 全局 toast 的签名（由 App.vue provide） */
export type ToastFn = (msg: string) => void

/** 注入键：统一 toast 的 provide/inject 契约，避免各处重复内联字面量与类型 */
export const TOAST_KEY: InjectionKey<ToastFn> = Symbol('toast')

/** 获取全局 toast；未被 provide 时退化为静默 no-op（与既有默认值行为一致） */
export function useToast(): ToastFn {
  return inject(TOAST_KEY, () => {})
}
