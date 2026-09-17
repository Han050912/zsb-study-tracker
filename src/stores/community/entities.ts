import { defineStore } from 'pinia'
import { gamificationApi } from '../../api/gamification'
import { postsApi } from '../../api/community/posts'
import { useAppStore } from '../app'
import { sessionUser } from '../../services/auth'
import type { CommunityPost, CommunityComment, PostType } from '../../types'
import { commentsActions } from './comments'
import { adminActions } from './admin'

export const usePostStore = defineStore('community-posts', {
  state: () => ({
    postsById: {} as Record<string, CommunityPost>,
    commentsById: {} as Record<string, CommunityComment>,
    commentIdsByPost: {} as Record<string, string[]>,
    pendingByPostId: {} as Record<string, boolean>,
    generation: 0
  }),
  actions: {
    assertCurrent(generation: number) {
      if (generation !== this.generation) throw new Error('登录状态已改变，请重试')
    },
    resetState() {
      this.generation++
      this.postsById = {}
      this.commentsById = {}
      this.commentIdsByPost = {}
      this.pendingByPostId = {}
    },
    upsert(posts: CommunityPost[]) {
      for (const post of posts) {
        const existing = this.postsById[post.id]
        const vote =
          existing && this.pendingByPostId[post.id]
            ? {
                likedByMe: existing.likedByMe,
                dislikedByMe: existing.dislikedByMe,
                likesCount: existing.likesCount,
                dislikesCount: existing.dislikesCount
              }
            : {}
        if (existing) Object.assign(existing, post, vote)
        else this.postsById[post.id] = post
      }
    },
    setComments(postId: string, comments: CommunityComment[], append = false) {
      for (const c of comments) this.commentsById[c.id] = c
      this.commentIdsByPost[postId] = [
        ...new Set([...(append ? (this.commentIdsByPost[postId] ?? []) : []), ...comments.map((c) => c.id)])
      ]
    },
    async syncGamification() {
      const owner = sessionUser.value?.id
      try {
        const g = await gamificationApi.get()
        if (owner && owner === sessionUser.value?.id) useAppStore().$patch({ gamification: g })
      } catch (e) {
        console.error('同步积分失败', e)
      }
    },
    async publishPost(data: {
      type: PostType
      content: string
      tags: string[]
      imageUrls?: string[]
      circleId?: string
      topicRef?: string
      refType?: string
      refId?: string
    }) {
      const generation = this.generation
      const post = await postsApi.createPost(data)
      this.assertCurrent(generation)
      post.userAvatar ||= useAppStore().settings.avatar
      this.upsert([post])
      void this.syncGamification()
      return post
    },
    async removePost(id: string) {
      const generation = this.generation
      await postsApi.deletePost(id)
      if (generation === this.generation) delete this.postsById[id]
    },
    async vote(id: string, kind: 'like' | 'dislike') {
      const post = this.postsById[id]
      if (!post || this.pendingByPostId[id]) return
      const generation = this.generation
      const before = {
        likedByMe: post.likedByMe,
        dislikedByMe: post.dislikedByMe,
        likesCount: post.likesCount,
        dislikesCount: post.dislikesCount
      }
      const apply = (liked: boolean, disliked: boolean) =>
        Object.assign(post, {
          likedByMe: liked,
          dislikedByMe: disliked,
          likesCount: Math.max(0, before.likesCount + Number(liked) - Number(!!before.likedByMe)),
          dislikesCount: Math.max(0, before.dislikesCount + Number(disliked) - Number(!!before.dislikedByMe))
        })
      this.pendingByPostId[id] = true
      apply(kind === 'like' ? !before.likedByMe : false, kind === 'dislike' ? !before.dislikedByMe : false)
      try {
        if (kind === 'like') {
          const { liked } = await postsApi.toggleLike('post', id)
          if (generation !== this.generation) return
          apply(liked, liked ? false : !!before.dislikedByMe)
        } else {
          const { disliked } = await postsApi.dislike('post', id)
          if (generation !== this.generation) return
          apply(disliked ? false : !!before.likedByMe, disliked)
        }
        void this.syncGamification()
      } catch (e) {
        if (generation === this.generation) Object.assign(post, before)
        throw e
      } finally {
        if (generation === this.generation) delete this.pendingByPostId[id]
      }
    },
    async likePost(id: string): Promise<boolean> {
      await this.vote(id, 'like')
      return !!this.postsById[id]?.likedByMe
    },
    async dislikePost(id: string) {
      await this.vote(id, 'dislike')
      return { disliked: !!this.postsById[id]?.dislikedByMe }
    },
    async acceptAnswer(postId: string, commentId: string) {
      const generation = this.generation
      const res = await postsApi.acceptAnswer(postId, commentId)
      this.assertCurrent(generation)
      const post = this.postsById[postId]
      if (post) Object.assign(post, { acceptedAnswerId: res.acceptedAnswerId ?? undefined, isResolved: res.isResolved })
      for (const id of this.commentIdsByPost[postId] ?? [])
        this.commentsById[id].isAccepted = id === res.acceptedAnswerId
      void this.syncGamification()
      return res
    },
    ...commentsActions,
    ...adminActions
  }
})
