<script setup lang="ts">
import { computed, ref } from 'vue'
import type { CommunityComment } from '../../types'
import { sessionUser, isAdmin } from '../../services/auth'
import { fromNow } from '../../utils/date'
import { imageUrl } from '../../api/community'
import UserAvatar from './UserAvatar.vue'
import LikeButton from './LikeButton.vue'
import DislikeButton from './DislikeButton.vue'

const props = withDefaults(
  defineProps<{
    comment: CommunityComment
    /** 是否展示「采纳」按钮（提问帖楼主可见，仅一级评论） */
    showAccept?: boolean
    /** 帖子作者 id（用于「楼主」标记） */
    postAuthorId?: string
    /** 是否正在被回复（持续高亮，锚定回复目标） */
    replying?: boolean
    /** 通知跳转锚定该评论时的一次性高亮闪烁 */
    highlight?: boolean
  }>(),
  { showAccept: false, replying: false, highlight: false }
)
const emit = defineEmits<{
  like: []
  dislike: []
  reply: []
  remove: []
  hide: []
  report: []
  accept: []
  image: [index: number]
  profile: []
}>()

const isMine = computed(() => props.comment.userId === sessionUser.value?.id)
/** 评论者为帖子作者（楼主） */
const isOp = computed(() => props.postAuthorId != null && props.comment.userId === props.postAuthorId)
const canDelete = computed(() => isMine.value || isAdmin.value)
const canHide = computed(() => isAdmin.value)

/** 点击评论触发回复：先播放一次强调闪烁，再通知父组件 */
const flashing = ref(false)
function onClickReply() {
  flashing.value = false
  requestAnimationFrame(() => {
    flashing.value = true
  })
  emit('reply')
}
</script>

<template>
  <div
    class="flex gap-2.5 rounded-lg cursor-pointer transition-colors"
    :class="[
      comment.isHidden ? 'opacity-50' : '',
      replying
        ? 'bg-primary-50/80 dark:bg-primary-900/20 -mx-2 px-2 py-2'
        : comment.isAccepted
          ? 'bg-action-soft dark:bg-action-soft -mx-2 px-2 py-2 ring-1 ring-action'
          : '',
      flashing || highlight ? 'reply-flash' : ''
    ]"
    @click="onClickReply"
  >
    <button class="self-start" :aria-label="`查看${comment.userName}的资料`" @click.stop="emit('profile')">
      <UserAvatar :name="comment.userName" :avatar="comment.userAvatar" />
    </button>
    <div class="flex-1 min-w-0">
      <div class="flex items-center gap-2">
        <button class="text-xs font-semibold hover:text-action" @click.stop="emit('profile')">
          {{ comment.userName }}
        </button>
        <span
          v-if="comment.userVerified"
          class="w-3.5 h-3.5 rounded-full bg-action text-on-action text-[9px] flex items-center justify-center shrink-0"
          title="认证专家"
          >✓</span
        >
        <span
          v-if="isMine"
          class="text-xs leading-none px-1 py-0.5 rounded border shrink-0 border-slate-300 text-slate-500 dark:border-slate-500 dark:text-slate-400 font-medium"
          >我</span
        >
        <span
          v-else-if="isOp"
          class="text-xs leading-none px-1 py-0.5 rounded border shrink-0 border-primary-400 text-action dark:border-primary-400 dark:text-action font-medium"
          >楼主</span
        >
        <span class="text-xs text-slate-400">{{ fromNow(comment.createdAt) }}</span>
        <span
          v-if="comment.isAccepted"
          class="text-xs px-1.5 py-0.5 rounded-full bg-action-soft dark:bg-action-soft text-action dark:text-action font-medium"
          >最佳答案</span
        >
        <span
          v-if="comment.isHidden"
          class="text-xs px-1.5 py-0.5 rounded-full bg-correction-soft dark:bg-correction-soft text-correction dark:text-correction"
          >已隐藏</span
        >
        <span
          v-if="comment.isFlagged"
          class="text-xs px-1.5 py-0.5 rounded-full bg-action-soft dark:bg-action-soft text-action dark:text-action"
          >待审核</span
        >
      </div>
      <p class="text-sm whitespace-pre-wrap leading-relaxed break-words mt-0.5">{{ comment.content }}</p>
      <!-- 评论配图（最多 3 张，点击进灯箱） -->
      <div v-if="comment.imageUrls?.length" class="flex gap-2 mt-1.5">
        <img
          v-for="(u, i) in comment.imageUrls"
          :key="u"
          :src="imageUrl(u)"
          loading="lazy"
          class="w-20 h-20 rounded-lg object-cover cursor-zoom-in hover:opacity-90 transition-opacity bg-slate-100 dark:bg-slate-700"
          alt="评论配图"
          role="button"
          tabindex="0"
          :aria-label="`放大第 ${i + 1} 张评论配图`"
          @click.stop="emit('image', i)"
          @keydown.enter.stop="emit('image', i)"
          @keydown.space.prevent.stop="emit('image', i)"
        />
      </div>
      <div class="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1" @click.stop>
        <DislikeButton :disliked="comment.dislikedByMe" :count="comment.dislikesCount" @toggle="emit('dislike')" />
        <button class="text-xs text-slate-400 hover:text-action" @click="onClickReply">回复</button>
        <button
          v-if="showAccept"
          class="text-xs font-medium"
          :class="comment.isAccepted ? 'text-action hover:text-action' : 'text-slate-400 hover:text-action'"
          @click="emit('accept')"
        >
          {{ comment.isAccepted ? '取消采纳' : '采纳' }}
        </button>
        <button v-if="!isMine" class="text-xs text-slate-400 hover:text-action" @click="emit('report')">举报</button>
        <button v-if="canHide" class="text-xs text-slate-400 hover:text-correction" @click="emit('hide')">
          {{ comment.isHidden ? '取消隐藏' : '隐藏' }}
        </button>
        <button v-if="canDelete" class="text-xs text-slate-400 hover:text-correction" @click="emit('remove')">
          删除
        </button>
      </div>
    </div>
    <!-- 抖音式：点赞垂直排列于内容右侧 -->
    <div class="shrink-0 flex items-start pt-0.5">
      <LikeButton vertical :liked="comment.likedByMe" :count="comment.likesCount" @toggle="emit('like')" />
    </div>
  </div>
</template>

<style scoped>
/* 从通知定位评论时显示稳定边界，避免光晕扩散干扰阅读。 */
.reply-flash {
  outline: 1px solid var(--action);
  outline-offset: 4px;
}
</style>
