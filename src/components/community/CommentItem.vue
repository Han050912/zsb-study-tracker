<script setup lang="ts">
import { computed } from 'vue'
import type { CommunityComment } from '../../types'
import { sessionUser, isAdmin } from '../../services/auth'
import { fromNow } from '../../utils/date'
import UserAvatar from './UserAvatar.vue'
import LikeButton from './LikeButton.vue'

const props = defineProps<{ comment: CommunityComment }>()
const emit = defineEmits<{ like: []; reply: []; remove: []; hide: []; report: [] }>()

const isMine = computed(() => props.comment.userId === sessionUser.value?.id)
const canDelete = computed(() => isMine.value || isAdmin.value)
const canHide = computed(() => isAdmin.value)
</script>

<template>
  <div class="flex gap-2.5" :class="comment.isHidden ? 'opacity-50' : ''">
    <UserAvatar :name="comment.userName" />
    <div class="flex-1 min-w-0">
      <div class="flex items-center gap-2">
        <span class="text-xs font-semibold">{{ comment.userName }}</span>
        <span class="text-[10px] text-slate-400">{{ fromNow(comment.createdAt) }}</span>
        <span v-if="comment.isHidden" class="text-[10px] px-1.5 py-0.5 rounded-full bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400">已隐藏</span>
      </div>
      <p class="text-sm whitespace-pre-wrap leading-relaxed break-words mt-0.5">{{ comment.content }}</p>
      <div class="flex items-center gap-4 mt-1">
        <LikeButton :liked="comment.likedByMe" :count="comment.likesCount" @toggle="emit('like')" />
        <button class="text-xs text-slate-400 hover:text-primary-500" @click="emit('reply')">回复</button>
        <button v-if="!isMine" class="text-xs text-slate-400 hover:text-orange-500" @click="emit('report')">举报</button>
        <button v-if="canHide" class="text-xs text-slate-400 hover:text-red-500" @click="emit('hide')">
          {{ comment.isHidden ? '取消隐藏' : '隐藏' }}
        </button>
        <button v-if="canDelete" class="text-xs text-slate-400 hover:text-red-500" @click="emit('remove')">删除</button>
      </div>
    </div>
  </div>
</template>
