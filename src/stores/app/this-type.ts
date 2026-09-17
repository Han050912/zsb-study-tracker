import type { useAppStore } from '../app'

/** options 式拆分后各域 actions 分组对象的 this 类型（type-only 循环导入，运行时擦除） */
export type AppStoreThis = ReturnType<typeof useAppStore>
