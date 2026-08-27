<script setup lang="ts">
/** 新关注通知 Item：头像 + 昵称/标签 / 「时间 关注了你」 / 打招呼按钮 + 右箭头 */
import { useRouter } from 'vue-router'
import { ChevronRight, MessageCircle } from '@lucide/vue'
import UserAvatar from './UserAvatar.vue'
import RelationTag from './RelationTag.vue'
import { fromNow } from '../../utils/date'
import type { CommunityNotification } from '../../types'

const props = defineProps<{ n: CommunityNotification }>()
const emit = defineEmits<{ read: [] }>()
const router = useRouter()

function openProfile() {
  emit('read')
  if (props.n.actorId) router.push(`/profile/${props.n.actorId}`)
}

function greet() {
  emit('read')
  if (!props.n.actorId) return
  router.push({ path: `/messages/${props.n.actorId}`, query: { greet: '1' } })
}
</script>

<template>
  <div class="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-700/40 cursor-pointer" @click="openProfile">
    <button class="shrink-0 relative" @click.stop="openProfile">
      <UserAvatar :name="n.actorName || '?'" :avatar="n.actorAvatar" />
      <span v-if="!n.isRead" class="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-rose-500 border-2 border-white dark:border-slate-800"></span>
    </button>
    <div class="flex-1 min-w-0">
      <div class="flex items-center gap-1.5">
        <span class="text-sm font-semibold truncate">{{ n.actorName || '匿名用户' }}</span>
        <RelationTag :relation="n.relation" />
      </div>
      <p class="text-xs text-slate-400 mt-1">{{ fromNow(n.createdAt) }} 关注了你</p>
    </div>
    <div class="flex items-center gap-2 shrink-0">
      <button class="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-full font-medium bg-primary-500 text-white hover:bg-primary-600 transition-colors"
        @click.stop="greet">
        <MessageCircle :size="12" />打招呼
      </button>
      <ChevronRight :size="16" class="text-slate-400" />
    </div>
  </div>
</template>
