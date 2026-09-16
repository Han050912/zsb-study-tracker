import type { useCommunityStore } from './index'

/** options 式拆分后各域 actions 分组对象的 this 类型（type-only 循环导入，运行时擦除） */
export type CommunityStoreThis = ReturnType<typeof useCommunityStore>
