<script setup lang="ts">
/** 帖子点赞通知 Item：头像 + 昵称/标签 / 「赞了你的帖子」+时间 / 右侧帖子缩略图，无额外按钮 */
import { useRouter } from 'vue-router'
import UserAvatar from './UserAvatar.vue'
import RelationTag from './RelationTag.vue'
import { imageUrl } from '../../api/community'
import { fromNow } from '../../utils/date'
import type { CommunityNotification } from '../../types'

const props = defineProps<{ n: CommunityNotification }>()
const emit = defineEmits<{ read: [] }>()
const router = useRouter()

function openProfile() {
  emit('read')
  if (props.n.actorId) router.push(`/profile/${props.n.actorId}`)
}

function openPost() {
  emit('read')
  if (props.n.postId) router.push(`/community/post/${props.n.postId}`)
}
</script>

<template>
  <div class="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-700/40">
    <button class="shrink-0 relative" @click="openProfile">
      <UserAvatar :name="n.actorName || '?'" :avatar="n.actorAvatar" />
      <span v-if="!n.isRead" class="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-rose-500 border-2 border-white dark:border-slate-800"></span>
    </button>
    <button class="flex-1 min-w-0 text-left" @click="openPost">
      <div class="flex items-center gap-1.5">
        <span class="text-sm font-semibold truncate">{{ n.actorName || '匿名用户' }}</span>
        <RelationTag :relation="n.relation" />
      </div>
      <p class="text-sm text-slate-600 dark:text-slate-300 mt-1">
        赞了你的{{ n.commentId ? '评论' : '帖子' }} <span class="text-xs text-slate-400 ml-1">{{ fromNow(n.createdAt) }}</span>
      </p>
    </button>
    <button v-if="n.postThumb" class="shrink-0 w-14 h-14 rounded-lg overflow-hidden bg-slate-100 dark:bg-slate-700" @click="openPost">
      <img :src="imageUrl(n.postThumb)" alt="帖子" class="w-full h-full object-cover" loading="lazy">
    </button>
  </div>
</template>
