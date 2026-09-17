<script setup lang="ts">
import type { CommunityPost } from '../../types'
import { usePostStore } from '../../stores/community'
import LikeButton from './LikeButton.vue'
import DislikeButton from './DislikeButton.vue'
defineProps<{ post: CommunityPost }>()
defineEmits<{ like: []; dislike: [] }>()
const entities = usePostStore()
</script>
<template>
  <div class="flex items-center gap-4">
    <LikeButton
      :liked="post.likedByMe"
      :count="post.likesCount"
      :disabled="entities.pendingByPostId[post.id]"
      aria-label="点赞帖子"
      title="点赞"
      @toggle="$emit('like')"
    /><DislikeButton
      :disliked="post.dislikedByMe"
      :count="post.dislikesCount"
      :disabled="entities.pendingByPostId[post.id]"
      aria-label="不赞同帖子"
      title="不赞同"
      @toggle="$emit('dislike')"
    /><span class="text-xs text-slate-500"
      >{{ post.commentsCount }} {{ post.type === 'question' ? '个回答' : '条讨论' }}</span
    >
  </div>
</template>
