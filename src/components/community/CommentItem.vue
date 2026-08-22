<script setup lang="ts">
import { computed, ref } from 'vue'
import type { CommunityComment } from '../../types'
import { sessionUser, isAdmin } from '../../services/auth'
import { fromNow } from '../../utils/date'
import { imageUrl } from '../../api/community'
import UserAvatar from './UserAvatar.vue'
import LikeButton from './LikeButton.vue'
import DislikeButton from './DislikeButton.vue'

const props = withDefaults(defineProps<{
  comment: CommunityComment
  /** 是否展示「采纳」按钮（提问帖楼主可见，仅一级评论） */
  showAccept?: boolean
  /** 帖子作者 id（用于「楼主」标记） */
  postAuthorId?: string
  /** 是否正在被回复（持续高亮，锚定回复目标） */
  replying?: boolean
}>(), { showAccept: false, replying: false })
const emit = defineEmits<{ like: []; dislike: []; reply: []; remove: []; hide: []; report: []; accept: []; image: [index: number]; profile: [] }>()

const isMine = computed(() => props.comment.userId === sessionUser.value?.id)
/** 评论者为帖子作者（楼主） */
const isOp = computed(() => props.postAuthorId != null && props.comment.userId === props.postAuthorId)
const canDelete = computed(() => isMine.value || isAdmin.value)
const canHide = computed(() => isAdmin.value)

/** 点击评论触发回复：先播放一次强调闪烁，再通知父组件 */
const flashing = ref(false)
function onClickReply() {
  flashing.value = false
  requestAnimationFrame(() => { flashing.value = true })
  emit('reply')
}
</script>

<template>
  <div class="flex gap-2.5 rounded-lg cursor-pointer transition-colors"
    :class="[
      comment.isHidden ? 'opacity-50' : '',
      replying
        ? 'bg-primary-50/80 dark:bg-primary-900/20 -mx-2 px-2 py-2'
        : (comment.isAccepted ? 'bg-emerald-50/60 dark:bg-emerald-900/10 -mx-2 px-2 py-2 ring-1 ring-emerald-200 dark:ring-emerald-800' : ''),
      flashing ? 'reply-flash' : ''
    ]"
    @click="onClickReply">
    <UserAvatar :name="comment.userName" :avatar="comment.userAvatar" class="cursor-pointer" @click.stop="emit('profile')" />
    <div class="flex-1 min-w-0">
      <div class="flex items-center gap-2">
        <span class="text-xs font-semibold cursor-pointer hover:text-primary-500" @click.stop="emit('profile')">{{ comment.userName }}</span>
        <span v-if="comment.userVerified"
          class="w-3.5 h-3.5 rounded-full bg-sky-500 text-white text-[9px] flex items-center justify-center shrink-0"
          title="认证专家">✓</span>
        <span v-if="isMine" class="text-[10px] leading-none px-1 py-0.5 rounded border shrink-0 border-slate-300 text-slate-500 dark:border-slate-500 dark:text-slate-400 font-medium">我</span>
        <span v-else-if="isOp" class="text-[10px] leading-none px-1 py-0.5 rounded border shrink-0 border-primary-400 text-primary-500 dark:border-primary-400 dark:text-primary-400 font-medium">楼主</span>
        <span class="text-[10px] text-slate-400">{{ fromNow(comment.createdAt) }}</span>
        <span v-if="comment.isAccepted" class="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400 font-medium">✅ 最佳答案</span>
        <span v-if="comment.isHidden" class="text-[10px] px-1.5 py-0.5 rounded-full bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400">已隐藏</span>
        <span v-if="comment.isFlagged" class="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400">待审核</span>
      </div>
      <p class="text-sm whitespace-pre-wrap leading-relaxed break-words mt-0.5">{{ comment.content }}</p>
      <!-- 评论配图（最多 3 张，点击进灯箱） -->
      <div v-if="comment.imageUrls?.length" class="flex gap-2 mt-1.5">
        <img v-for="(u, i) in comment.imageUrls" :key="u" :src="imageUrl(u)" loading="lazy"
          class="w-20 h-20 rounded-lg object-cover cursor-zoom-in hover:opacity-90 transition-opacity bg-slate-100 dark:bg-slate-700"
          alt="评论配图" @click.stop="emit('image', i)" />
      </div>
      <div class="flex items-center gap-4 mt-1" @click.stop>
        <DislikeButton :disliked="comment.dislikedByMe" :count="comment.dislikesCount" @toggle="emit('dislike')" />
        <button class="text-xs text-slate-400 hover:text-primary-500" @click="onClickReply">回复</button>
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
    <!-- 抖音式：点赞垂直排列于内容右侧 -->
    <div class="shrink-0 flex items-start pt-0.5">
      <LikeButton vertical :liked="comment.likedByMe" :count="comment.likesCount" @toggle="emit('like')" />
    </div>
  </div>
</template>

<style scoped>
/* 点击评论回复时的强调闪烁：蓝色光晕由强到弱扩散 */
.reply-flash {
  animation: reply-flash 1.2s ease;
}
@keyframes reply-flash {
  0% { box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.4), inset 0 0 0 3px rgba(59, 130, 246, 0.12); }
  100% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0), inset 0 0 0 0 rgba(59, 130, 246, 0); }
}
</style>
