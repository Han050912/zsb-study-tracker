import { inject, provide, ref, type InjectionKey } from 'vue'

/** 全局确认弹窗的签名（由 App.vue provide）；resolve(true)=确定，resolve(false)=取消 */
export type ConfirmFn = (message: string, options?: { danger?: boolean }) => Promise<boolean>

/** 注入键：统一 confirm 的 provide/inject 契约，与 TOAST_KEY 同模式 */
export const CONFIRM_KEY: InjectionKey<ConfirmFn> = Symbol('confirm')

/** 获取全局确认函数；未被 provide 时兜底回退原生 confirm（理论上只在 App 树外发生，保持行为不中断） */
export function useConfirm(): ConfirmFn {
  return inject(CONFIRM_KEY, (message) => Promise.resolve(window.confirm(message)))
}

/** App 根组件专用：创建确认弹窗状态与函数并向全树 provide（App 自身亦直接使用 confirmFn） */
export function useConfirmProvider() {
  const confirmState = ref<{ message: string; danger: boolean; resolve: (ok: boolean) => void } | null>(null)
  const confirmFn: ConfirmFn = (message, options) =>
    new Promise<boolean>((resolve) => {
      // 连续调用时新请求覆盖旧状态：旧 Promise 必须 resolve(false) 防悬挂
      confirmState.value?.resolve(false)
      confirmState.value = { message, danger: !!options?.danger, resolve }
    })
  provide(CONFIRM_KEY, confirmFn)
  function resolveConfirm(ok: boolean) {
    confirmState.value?.resolve(ok)
    confirmState.value = null
  }
  return { confirmState, confirmFn, resolveConfirm }
}
