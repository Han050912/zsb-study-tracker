<script setup lang="ts">
import { inject, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useCommunityStore } from '../stores/community'
import { fromNow } from '../utils/date'
import type { CommunityNotification } from '../types'

const store = useCommunityStore()
const router = useRouter()
const toast = inject<(m: string) => void>('toast', () => {})

const TYPE_ICON: Record<CommunityNotification['type'], string> = {
  like: '❤️',
  comment: '💬',
  follow: '👤',
  achievement: '🏆',
  message: '✉️',
  system: '📢'
}

onMounted(() => {
  store.fetchNotifications(true).catch(e => toast(e?.message || '加载失败'))
})

/** 点击通知：标记已读并跳转（system 无跳转目标；message 进聊天页；其余进帖子详情） */
async function open(n: CommunityNotification) {
  store.markRead(n).catch(() => {})
  if (n.type === 'message' && n.actorId) router.push(`/community/messages/${n.actorId}`)
  else if (n.type !== 'system' && n.postId) router.push(`/community/post/${n.postId}`)
}

async function readAll() {
  try {
    await store.markAllRead()
    toast('已全部标记为已读')
  } catch (e: any) {
    toast(e?.message || '操作失败')
  }
}
</script>

<template>
  <div class="p-4 md:p-6 max-w-2xl mx-auto space-y-4">
    <div class="flex items-center justify-between">
      <h1 class="page-title">🔔 通知中心</h1>
      <button v-if="store.unreadCount" class="btn-ghost !text-xs" @click="readAll">全部已读</button>
    </div>

    <div v-if="!store.notifications.length" class="card text-center py-10 text-slate-400 text-sm">
      <div class="text-3xl mb-2">📭</div>
      <p>暂无通知</p>
    </div>

    <div class="card !p-0 divide-y divide-slate-50 dark:divide-slate-700/50 overflow-hidden">
      <button v-for="n in store.notifications" :key="n.id"
        class="w-full flex items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-700/40"
        @click="open(n)">
        <span class="text-lg leading-6">{{ TYPE_ICON[n.type] || '🔔' }}</span>
        <div class="flex-1 min-w-0">
          <p class="text-sm leading-relaxed">{{ n.content }}</p>
          <p class="text-[10px] text-slate-400 mt-0.5">{{ fromNow(n.createdAt) }}</p>
        </div>
        <span v-if="!n.isRead" class="w-2 h-2 rounded-full bg-rose-500 shrink-0 mt-2"></span>
      </button>
    </div>

    <div v-if="store.hasMoreNotify && store.notifications.length" class="text-center">
      <button class="btn-ghost !text-xs"
        @click="store.fetchNotifications().catch(e => toast(e?.message || '加载失败'))">加载更多</button>
    </div>
  </div>
</template>
