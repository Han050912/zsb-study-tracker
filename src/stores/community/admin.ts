/**
 * community store 的 admin 域模块：管理员操作（adminPinPost/adminHidePost/adminHideComment/
 * adminFeaturePost/adminDailyPost）。
 * 仅 import services/api；不 import 其他 community 域模块的 actions（跨域调用一律走 this）。
 */
import type { CommunityStoreThis } from './this-type'
import { communityApi } from '../../api/community'

/** 显式签名（不含 this 参数）：断开 CommunityStoreThis 与字面量推断的类型循环，原理见 stores/app/sync.ts 顶部注释 */
type AdminActionsShape = {
  adminPinPost(id: string): Promise<boolean>
  adminHidePost(id: string): Promise<boolean>
  adminHideComment(id: string): Promise<boolean>
  adminFeaturePost(id: string): Promise<boolean>
  adminDailyPost(id: string): Promise<boolean>
}

export const adminActions: AdminActionsShape = {
  async adminPinPost(this: CommunityStoreThis, id: string): Promise<boolean> {
    const { isPinned } = await communityApi.adminPinPost(id)
    const p = this.posts.find((x) => x.id === id)
    if (p) p.isPinned = isPinned
    return isPinned
  },

  async adminHidePost(this: CommunityStoreThis, id: string): Promise<boolean> {
    const { isHidden } = await communityApi.adminHidePost(id)
    const p = this.posts.find((x) => x.id === id)
    if (p) p.isHidden = isHidden
    return isHidden
  },

  async adminHideComment(this: CommunityStoreThis, id: string): Promise<boolean> {
    const { isHidden } = await communityApi.adminHideComment(id)
    return isHidden
  },

  async adminFeaturePost(this: CommunityStoreThis, id: string): Promise<boolean> {
    const { isFeatured } = await communityApi.adminFeaturePost(id)
    const p = this.posts.find((x) => x.id === id)
    if (p) p.isFeatured = isFeatured
    return isFeatured
  },

  async adminDailyPost(this: CommunityStoreThis, id: string): Promise<boolean> {
    const { isDaily } = await communityApi.adminDailyPost(id)
    const p = this.posts.find((x) => x.id === id)
    if (p) p.isDaily = isDaily
    return isDaily
  }
}
