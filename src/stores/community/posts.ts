/**
 * community store 的 posts 域模块：帖子发布/删除与赞踩、采纳（publishPost/removePost/
 * likePost/dislikePost/acceptAnswer）。
 * 仅 import services/api；不 import 其他 community 域模块的 actions（跨域调用一律走 this）。
 */
import type { CommunityStoreThis } from './this-type'
import { communityApi } from '../../api/community'
import { useAppStore } from '../app'
import type { CommunityPost, PostType } from '../../types'

/** 显式签名（不含 this 参数）：断开 CommunityStoreThis 与字面量推断的类型循环，原理见 stores/app/sync.ts 顶部注释 */
type PostsActionsShape = {
  publishPost(data: {
    type: PostType
    content: string
    tags: string[]
    imageUrls?: string[]
    circleId?: string
    topicRef?: string
    refType?: string
    refId?: string
  }): Promise<CommunityPost>
  removePost(id: string): Promise<void>
  likePost(id: string): Promise<boolean>
  dislikePost(id: string): Promise<{ disliked: boolean; likeRevoked?: boolean }>
  acceptAnswer(postId: string, commentId: string): Promise<{ acceptedAnswerId: string | null; isResolved: boolean }>
}

export const postsActions: PostsActionsShape = {
  /** 发帖成功返回新帖；仅当命中当前筛选时插入列表头部（精华/关注筛选下新帖必未加精、作者非关注对象，不插入；圈子帖不进广场） */
  async publishPost(
    this: CommunityStoreThis,
    data: {
      type: PostType
      content: string
      tags: string[]
      imageUrls?: string[]
      circleId?: string
      topicRef?: string
      refType?: string
      refId?: string
    }
  ) {
    const post = await communityApi.createPost(data)
    // 后端返回的头像可能因云端 user_settings 同步时序缺失，用前端当前头像兜底，确保刚发出的帖子立即显示当前头像（无需刷新）
    if (!post.userAvatar) {
      const avatar = useAppStore().settings.avatar
      if (avatar) post.userAvatar = avatar
    }
    if (
      this.sort === 'latest' &&
      this.category === '' &&
      !data.circleId &&
      !data.topicRef &&
      (!this.tag || post.tags.includes(this.tag))
    ) {
      this.posts.unshift(post)
    }
    await this.syncGamification()
    return post
  },

  async removePost(this: CommunityStoreThis, id: string) {
    await communityApi.deletePost(id)
    this.posts = this.posts.filter((p) => p.id !== id)
  },

  /** 帖子点赞 toggle，同步更新列表内计数；返回最新点赞态 */
  async likePost(this: CommunityStoreThis, id: string): Promise<boolean> {
    const { liked } = await communityApi.toggleLike('post', id)
    const p = this.posts.find((x) => x.id === id)
    if (p) {
      p.likedByMe = liked
      p.likesCount = Math.max(0, p.likesCount + (liked ? 1 : -1))
      // 后端点赞会反向取消踩（赞踩互斥），本地同步清除踩状态
      if (liked && p.dislikedByMe) {
        p.dislikedByMe = false
        p.dislikesCount = Math.max(0, p.dislikesCount - 1)
      }
    }
    await this.syncGamification()
    return liked
  },

  /** 帖子踩 toggle（与赞互斥），同步列表内计数；返回 { disliked, likeRevoked } */
  async dislikePost(this: CommunityStoreThis, id: string): Promise<{ disliked: boolean; likeRevoked?: boolean }> {
    const res = await communityApi.dislike('post', id)
    const p = this.posts.find((x) => x.id === id)
    if (p) {
      p.dislikedByMe = res.disliked
      p.dislikesCount = Math.max(0, p.dislikesCount + (res.disliked ? 1 : -1))
      if (res.likeRevoked) {
        p.likedByMe = false
        p.likesCount = Math.max(0, p.likesCount - 1)
      }
    }
    await this.syncGamification()
    return res
  },

  /** 采纳/取消采纳最佳答案；同步列表内帖子状态并刷新积分（提问者 +3/被采纳者 +10 由服务端发放） */
  async acceptAnswer(
    this: CommunityStoreThis,
    postId: string,
    commentId: string
  ): Promise<{ acceptedAnswerId: string | null; isResolved: boolean }> {
    const res = await communityApi.acceptAnswer(postId, commentId)
    const p = this.posts.find((x) => x.id === postId)
    if (p) {
      p.acceptedAnswerId = res.acceptedAnswerId ?? undefined
      p.isResolved = res.isResolved
    }
    await this.syncGamification()
    return res
  }
}
