<script setup lang="ts">
import { computed } from 'vue'
import type { CommunityComment } from '../../types'
import { sessionUser, isAdmin } from '../../services/auth'
import { fromNow } from '../../utils/date'
import { imageUrl } from '../../api/community'
import UserAvatar from './UserAvatar.vue'
import LikeButton from './LikeButton.vue'

const props = withDefaults(defineProps<{
  comment: CommunityComment
  /** 是否展示「采纳」按钮（提问帖楼主可见，仅一级评论） */
  showAccept?: boolean
}>(), { showAccept: false })
const emit = defineEmits<{ like: []; reply: []; remove: []; hide: []; report: []; accept: []; image: [index: number]; profile: [] }>()

const isMine = computed(() => props.comment.userId === sessionUser.value?.id)
const canDelete = computed(() => isMine.value || isAdmin.value)
const canHide = computed(() => isAdmin.value)
</script>

<template>
  <div class="flex gap-2.5 rounded-lg"
    :class="[comment.isHidden ? 'opacity-50' : '', comment.isAccepted ? 'bg-emerald-50/60 dark:bg-emerald-900/10 -mx-2 px-2 py-2 ring-1 ring-emerald-200 dark:ring-emerald-800' : '']">
    <UserAvatar :name="comment.userName" class="cursor-pointer" @click="emit('profile')" />
    <div class="flex-1 min-w-0">
      <div class="flex items-center gap-2">
        <span class="text-xs font-semibold cursor-pointer hover:text-primary-500" @click="emit('profile')">{{ comment.userName }}</span>
        <span v-if="comment.userVerified"
          class="w-3.5 h-3.5 rounded-full bg-sky-500 text-white text-[9px] flex items-center justify-center shrink-0"
          title="认证专家">✓</span>
        <span class="text-[10px] text-slate-400">{{ fromNow(comment.createdAt) }}</span>
        <span v-if="comment.isAccepted" class="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400 font-medium">✅ 最佳答案</span>
        <span v-if="comment.isHidden" class="text-[10px] px-1.5 py-0.5 rounded-full bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400">已隐藏</span>
      </div>
      <p class="text-sm whitespace-pre-wrap leading-relaxed break-words mt-0.5">{{ comment.content }}</p>
      <!-- 评论配图（最多 3 张，点击进灯箱） -->
      <div v-if="comment.imageUrls?.length" class="flex gap-2 mt-1.5">
        <img v-for="(u, i) in comment.imageUrls" :key="u" :src="imageUrl(u)" loading="lazy"
          class="w-20 h-20 rounded-lg object-cover cursor-zoom-in hover:opacity-90 transition-opacity bg-slate-100 dark:bg-slate-700"
          alt="评论配图" @click="emit('image', i)" />
      </div>
      <div class="flex items-center gap-4 mt-1">
        <LikeButton :liked="comment.likedByMe" :count="comment.likesCount" @toggle="emit('like')" />
        <button class="text-xs text-slate-400 hover:text-primary-500" @click="emit('reply')">回复</button>
        <button v-if="showAccept" class="text-xs font-medium"
          :class="comment.isAccepted ? 'text-emerald-500 hover:text-orange-500' : 'text-slate-400 hover:text-emerald-500'"
          @click="emit('accept')">{{ comment.isAccepted ? '取消采纳' : '采纳' }}</button>
        <button v-if="!isMine" class="text-xs text-slate-400 hover:text-orange-500" @click="emit('report')">举报</button>
        <button v-if="canHide" class="text-xs text-slate-400 hover:text-red-500" @click="emit('hide')">
          {{ comment.isHidden ? '取消隐藏' : '隐藏' }}
        </button>
        <button v-if="canDelete" class="text-xs text-slate-400 hover:text-red-500" @click="emit('remove')">删除</button>
      </div>
    </div>
  </div>
</template>
