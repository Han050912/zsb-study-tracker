<script setup lang="ts">
/** 搭子通知 Item（提醒/分享/番茄邀请/计划/复盘）：提醒人头像 + 文案 + 时间；点头像跳对方主页，点整行跳搭子页 */
import { useRouter } from 'vue-router'
import UserAvatar from './UserAvatar.vue'
import { fromNow } from '../../utils/date'
import type { CommunityNotification } from '../../types'

const props = defineProps<{ n: CommunityNotification }>()
const emit = defineEmits<{ read: [] }>()
const router = useRouter()

function openProfile() {
  emit('read')
  if (props.n.actorId) router.push(`/profile/${props.n.actorId}`)
}

function openPartners() {
  emit('read')
  router.push('/community/partners')
}
</script>

<template>
  <div class="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-700/40 cursor-pointer" @click="openPartners">
    <button class="shrink-0 relative" @click.stop="openProfile">
      <UserAvatar :name="n.actorName || '搭'" :avatar="n.actorAvatar" />
      <span v-if="!n.isRead" class="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-rose-500 border-2 border-white dark:border-slate-800"></span>
    </button>
    <div class="flex-1 min-w-0">
      <p class="text-sm text-slate-700 dark:text-slate-200 leading-relaxed break-words">{{ n.content }}</p>
      <p class="text-[10px] text-slate-400 mt-1">{{ fromNow(n.createdAt) }}</p>
    </div>
  </div>
</template>
