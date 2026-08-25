<script setup lang="ts">
import { inject, onMounted } from 'vue'
import { useCommunityStore } from '../stores/community'
import type { CommunityNotification, NotificationType } from '../types'
import NotificationCommentItem from '../components/community/NotificationCommentItem.vue'
import NotificationLikeItem from '../components/community/NotificationLikeItem.vue'
import NotificationFollowItem from '../components/community/NotificationFollowItem.vue'
import NotificationPartnerItem from '../components/community/NotificationPartnerItem.vue'
import NotificationGenericItem from '../components/community/NotificationGenericItem.vue'

const store = useCommunityStore()
const toast = inject<(m: string) => void>('toast', () => {})

const FILTERS: { k: NotificationType | ''; l: string }[] = [
  { k: '', l: '全部' },
  { k: 'like', l: '点赞' },
  { k: 'comment', l: '评论' },
  { k: 'follow', l: '关注' },
  { k: 'achievement', l: '成就' },
  { k: 'partner', l: '搭子' },
  { k: 'system', l: '系统' }
]
function switchFilter(k: NotificationType | '') {
  store.setNotifyFilter(k).catch(e => toast(e?.message || '加载失败'))
}

onMounted(() => {
  store.fetchNotifications(true).catch(e => toast(e?.message || '加载失败'))
})

function markRead(n: CommunityNotification) {
  store.markRead(n).catch(() => {})
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
      <h1 class="page-title"> 通知中心</h1>
      <button v-if="store.unreadCount" class="btn-ghost !text-xs" @click="readAll">全部已读</button>
    </div>

    <div class="flex flex-wrap gap-2">
      <button v-for="f in FILTERS" :key="f.k" class="btn !text-xs !py-1 !px-3"
        :class="store.notifyFilter === f.k ? 'bg-primary-500 text-white' : 'bg-slate-100 dark:bg-slate-700'"
        @click="switchFilter(f.k)">{{ f.l }}</button>
    </div>

    <div v-if="!store.notifications.length" class="card text-center py-10 text-slate-400 text-sm">
      <div class="text-3xl mb-2"></div>
      <p>暂无通知</p>
    </div>

    <div class="card !p-0 divide-y divide-slate-200 dark:divide-slate-700 overflow-hidden">
      <template v-for="n in store.notifications" :key="n.id">
        <NotificationCommentItem v-if="n.type === 'comment'" :n="n" @read="markRead(n)" />
        <NotificationLikeItem v-else-if="n.type === 'like'" :n="n" @read="markRead(n)" />
        <NotificationFollowItem v-else-if="n.type === 'follow'" :n="n" @read="markRead(n)" />
        <NotificationPartnerItem v-else-if="n.type === 'partner'" :n="n" @read="markRead(n)" />
        <NotificationGenericItem v-else :n="n" @read="markRead(n)" />
      </template>
    </div>

    <div v-if="store.hasMoreNotify && store.notifications.length" class="text-center">
      <button class="btn-ghost !text-xs"
        @click="store.fetchNotifications().catch(e => toast(e?.message || '加载失败'))">加载更多</button>
    </div>
  </div>
</template>
