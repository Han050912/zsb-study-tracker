<script setup lang="ts">
/** 评论互动通知 Item：头像 + 昵称/标签 / 评论内容 / 操作栏(回复+赞) / 右侧帖子缩略图 + 时间 */
import { inject } from 'vue'
import { useRouter } from 'vue-router'
import UserAvatar from './UserAvatar.vue'
import RelationTag from './RelationTag.vue'
import { imageUrl } from '../../api/community'
import { fromNow } from '../../utils/date'
import { useCommunityStore } from '../../stores/community'
import type { CommunityNotification } from '../../types'

const props = defineProps<{ n: CommunityNotification }>()
const emit = defineEmits<{ read: [] }>()
const router = useRouter()
const store = useCommunityStore()
const toast = inject<(m: string) => void>('toast', () => {})

function openProfile() {
  emit('read')
  if (props.n.actorId) router.push(`/profile/${props.n.actorId}`)
}

function openPost() {
  emit('read')
  if (props.n.postId) router.push(`/community/post/${props.n.postId}`)
}

function replyComment() {
  emit('read')
  if (!props.n.postId) return
  router.push({ path: `/community/post/${props.n.postId}`, query: { comment: props.n.commentId, reply: '1' } })
}

async function like() {
  if (!props.n.commentId) return
  const prevLiked = props.n.commentLikedByMe
  const prevCount = props.n.commentLikesCount ?? 0
  props.n.commentLikedByMe = !prevLiked
  props.n.commentLikesCount = Math.max(0, prevCount + (prevLiked ? -1 : 1))
  try {
    const { liked } = await store.likeComment(props.n.commentId)
    props.n.commentLikedByMe = liked
  } catch (e: any) {
    props.n.commentLikedByMe = prevLiked
    props.n.commentLikesCount = prevCount
    toast(e?.message || '操作失败')
  }
}
</script>

<template>
  <div class="w-full flex items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-700/40">
    <button class="shrink-0 relative" @click="openProfile">
      <UserAvatar :name="n.actorName || '?'" :avatar="n.actorAvatar" />
      <span v-if="!n.isRead" class="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-rose-500 border-2 border-white dark:border-slate-800"></span>
    </button>
    <div class="flex-1 min-w-0">
      <div class="flex items-center gap-1.5">
        <span class="text-sm font-semibold truncate cursor-pointer hover:text-primary-500" @click="openProfile">{{ n.actorName || '匿名用户' }}</span>
        <RelationTag :relation="n.relation" />
      </div>
      <p v-if="n.commentContent" class="text-sm text-slate-600 dark:text-slate-300 mt-1 leading-relaxed break-words">{{ n.commentContent }}</p>
      <div class="flex items-center justify-between mt-1.5">
        <div class="flex items-center gap-3">
          <button class="text-xs text-slate-500 hover:text-primary-500 font-medium" @click="replyComment">回复评论</button>
          <button class="text-xs font-medium transition-colors"
            :class="n.commentLikedByMe ? 'text-rose-500' : 'text-slate-500 hover:text-rose-500'"
            @click="like">
            {{ n.commentLikedByMe ? '已赞' : '赞' }}{{ n.commentLikesCount ? ` ${n.commentLikesCount}` : '' }}
          </button>
        </div>
        <span class="text-[10px] text-slate-400 shrink-0">{{ fromNow(n.createdAt) }}</span>
      </div>
    </div>
    <button v-if="n.postThumb" class="shrink-0 w-14 h-14 rounded-lg overflow-hidden bg-slate-100 dark:bg-slate-700" @click="openPost">
      <img :src="imageUrl(n.postThumb)" alt="帖子" class="w-full h-full object-cover" loading="lazy">
    </button>
  </div>
</template>
