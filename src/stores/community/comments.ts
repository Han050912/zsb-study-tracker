/**
 * community store 的 comments 域模块：评论赞踩、发表与删除（likeComment/dislikeComment/
 * postComment/removeComment）。
 * 仅 import services/api；不 import 其他 community 域模块的 actions（跨域调用一律走 this）。
 */
import type { CommunityStoreThis } from './this-type'
import { postsApi } from '../../api/community/posts'
import { useAppStore } from '../app'
import type { CommunityComment } from '../../types'

/** 显式签名（不含 this 参数）：断开 CommunityStoreThis 与字面量推断的类型循环，原理见 stores/app/sync.ts 顶部注释 */
type CommentsActionsShape = {
  likeComment(id: string): Promise<boolean>
  dislikeComment(id: string): Promise<{ disliked: boolean; likeRevoked?: boolean }>
  postComment(postId: string, content: string, parentId?: string, imageUrls?: string[]): Promise<CommunityComment>
  removeComment(id: string, postId: string, removed: number): Promise<void>
}

export const commentsActions: CommentsActionsShape = {
  /** 评论点赞 toggle（详情页自行更新评论树计数） */
  async likeComment(this: CommunityStoreThis, id: string): Promise<boolean> {
    const generation = this.generation
    const { liked } = await postsApi.toggleLike('comment', id)
    this.assertCurrent(generation)
    void this.syncGamification()
    return liked
  },

  /** 评论踩 toggle（与赞互斥）；返回 { disliked, likeRevoked }，详情页自行更新评论树计数 */
  async dislikeComment(this: CommunityStoreThis, id: string): Promise<{ disliked: boolean; likeRevoked?: boolean }> {
    const generation = this.generation
    const res = await postsApi.dislike('comment', id)
    this.assertCurrent(generation)
    void this.syncGamification()
    return res
  },

  /** 发表评论，返回新评论；同步列表内帖子评论数 */
  async postComment(
    this: CommunityStoreThis,
    postId: string,
    content: string,
    parentId?: string,
    imageUrls?: string[]
  ): Promise<CommunityComment> {
    const generation = this.generation
    const c = await postsApi.addComment(postId, { content, parentId, imageUrls })
    this.assertCurrent(generation)
    // 后端返回的头像可能因云端 user_settings 同步时序缺失，用前端当前头像兜底，避免新评论短暂显示默认头像
    if (!c.userAvatar) {
      const avatar = useAppStore().settings.avatar
      if (avatar) c.userAvatar = avatar
    }
    const p = this.postsById[postId]
    if (p) p.commentsCount++
    void this.syncGamification()
    return c
  },

  /** 删除评论；removed 为级联删除的总条数（含二级回复），用于回退计数 */
  async removeComment(this: CommunityStoreThis, id: string, postId: string, removed: number) {
    const generation = this.generation
    const res = await postsApi.deleteComment(id)
    this.assertCurrent(generation)
    const p = this.postsById[postId]
    if (p) p.commentsCount = Math.max(0, p.commentsCount - (res.removed ?? removed))
  }
}
