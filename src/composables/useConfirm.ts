import { inject, type InjectionKey } from 'vue'

/** 全局确认弹窗的签名（由 App.vue provide）；resolve(true)=确定，resolve(false)=取消 */
export type ConfirmFn = (message: string, options?: { danger?: boolean }) => Promise<boolean>

/** 注入键：统一 confirm 的 provide/inject 契约，与 TOAST_KEY 同模式 */
export const CONFIRM_KEY: InjectionKey<ConfirmFn> = Symbol('confirm')

/** 获取全局确认函数；未被 provide 时兜底回退原生 confirm（理论上只在 App 树外发生，保持行为不中断） */
export function useConfirm(): ConfirmFn {
  return inject(CONFIRM_KEY, (message) => Promise.resolve(window.confirm(message)))
}
