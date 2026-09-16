import { inject, ref, type InjectionKey, type Ref } from 'vue'

/**
 * 首屏补水就绪标志的注入键（main.ts 在挂载前 provide）。
 *
 * 挂载路径上不再等待云端全量数据拉取，未就绪期间由 App 显示骨架，
 * 因此弱网下立刻有加载反馈，也不会出现「数据未到却渲染成空态」的误导（骨架态 ≠ 空态）。
 */
export const APP_READY_KEY: InjectionKey<Ref<boolean>> = Symbol('app-ready')

/** 读取首屏补水是否就绪（未 provide 时视为已就绪，便于组件独立挂载） */
export function useAppReady(): Ref<boolean> {
  return inject(APP_READY_KEY, ref(true))
}
