<script setup lang="ts">
/** 成就/系统通用通知 Item：图标区 + 主文案 + 时间，按 targetType 跳转（无 target 不跳转） */
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { Trophy, Bell } from '@lucide/vue'
import { fromNow } from '../../utils/date'
import type { CommunityNotification, NotificationTargetType } from '../../types'

const props = defineProps<{ n: CommunityNotification }>()
const emit = defineEmits<{ read: [] }>()
const router = useRouter()

const isAchievement = computed(() => props.n.type === 'achievement')
const icon = computed(() => (isAchievement.value ? Trophy : Bell))
const iconCls = computed(() => isAchievement.value
  ? 'bg-amber-50 dark:bg-amber-900/30 text-amber-500 dark:text-amber-400'
  : 'bg-sky-50 dark:bg-sky-900/30 text-sky-500 dark:text-sky-400')

const ROUTES: Record<NotificationTargetType, string> = {
  post: '/community/post', user: '/profile', message: '/messages', team: '/teams', circle: '/community/circles', partner: '/community/partners'
}
const STATIC: NotificationTargetType[] = ['partner']

function open() {
  emit('read')
  if (!props.n.targetType) return
  const base = ROUTES[props.n.targetType]
  if (!base) return
  if (STATIC.includes(props.n.targetType)) { router.push(base); return }
  if (!props.n.targetId) return
  router.push(`${base}/${props.n.targetId}`)
}
</script>

<template>
  <button class="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-700/40" @click="open">
    <div class="shrink-0 relative w-9 h-9 rounded-full flex items-center justify-center" :class="iconCls">
      <component :is="icon" :size="16" />
      <span v-if="!n.isRead" class="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-rose-500 border-2 border-white dark:border-slate-800"></span>
    </div>
    <div class="flex-1 min-w-0">
      <p class="text-sm text-slate-700 dark:text-slate-200 leading-relaxed">{{ n.content }}</p>
      <p class="text-[10px] text-slate-400 mt-1">{{ fromNow(n.createdAt) }}</p>
    </div>
  </button>
</template>
