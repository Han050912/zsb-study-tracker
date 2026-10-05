<script setup lang="ts">
import EmptyState from '../shared/components/EmptyState.vue'
import AsyncState from '../shared/components/AsyncState.vue'
import { onMounted, ref } from 'vue'
import { getErrorMessage } from '../utils/error'
import { useToast } from '../composables/useToast'
import { useNotificationStore } from '../stores/community'
import type { CommunityNotification, NotificationType } from '../types'
import NotificationCommentItem from '../components/community/NotificationCommentItem.vue'
import NotificationLikeItem from '../components/community/NotificationLikeItem.vue'
import NotificationFollowItem from '../components/community/NotificationFollowItem.vue'
import NotificationPartnerItem from '../components/community/NotificationPartnerItem.vue'
import NotificationGenericItem from '../components/community/NotificationGenericItem.vue'

const store = useNotificationStore()
const toast = useToast()

/** 列表加载中：首屏与切筛选期间显示骨架屏，避免先闪「暂无通知」空态 */
const loading = ref(false)
const loadError = ref('')
let loadTicket = 0

async function fetchList(reset: boolean) {
  const ticket = ++loadTicket
  loading.value = true
  loadError.value = ''
  try {
    await store.fetchNotifications(reset)
  } catch (e) {
    if (ticket === loadTicket) loadError.value = getErrorMessage(e, '通知未能加载，请检查网络后重试')
  } finally {
    if (ticket === loadTicket) loading.value = false
  }
}

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
  if (store.notifyFilter === k) return
  store.notifyFilter = k
  fetchList(true)
}

onMounted(() => {
  fetchList(true)
})

function markRead(n: CommunityNotification) {
  store.markRead(n).catch((e) => toast(getErrorMessage(e, '通知未能标为已读，请重试')))
}

async function readAll() {
  try {
    await store.markAllRead()
    toast('已全部标记为已读')
  } catch (e) {
    toast(getErrorMessage(e, '通知未能标为已读，请重试'))
  }
}
</script>

<template>
  <div class="study-page reading-page space-y-4">
    <div class="flex items-center justify-between">
      <h1 class="page-title">通知中心</h1>
      <button v-if="store.unreadCount" class="btn-ghost !text-xs" :disabled="store.readingAll" @click="readAll">
        {{ store.readingAll ? '处理中…' : '全部已读' }}
      </button>
    </div>

    <div class="flex flex-wrap gap-2">
      <button
        v-for="f in FILTERS"
        :key="f.k"
        class="btn !text-xs !py-1 !px-3"
        :class="store.notifyFilter === f.k ? 'bg-action text-on-action' : 'bg-slate-100 dark:bg-slate-700'"
        :aria-pressed="store.notifyFilter === f.k"
        @click="switchFilter(f.k)"
      >
        {{ f.l }}
      </button>
    </div>

    <!-- 加载中：骨架占位，与「暂无通知」空态明确区分 -->
    <div v-if="loading" class="card !p-0 divide-y divide-slate-200 dark:divide-slate-700 overflow-hidden">
      <div v-for="i in 4" :key="i" class="p-4 space-y-2">
        <div class="h-4 w-1/3 rounded bg-slate-200 dark:bg-slate-700 animate-pulse"></div>
        <div class="h-3 w-2/3 rounded bg-slate-200 dark:bg-slate-700 animate-pulse"></div>
      </div>
    </div>

    <AsyncState v-else-if="loadError" :error="loadError" @retry="fetchList(true)" />
    <EmptyState
      v-else-if="!store.notifications.length"
      class="card"
      title="还没有这类通知"
      description="新的互动和学习提醒会显示在这里。"
    />

    <div v-else class="card !p-0 divide-y divide-slate-200 dark:divide-slate-700 overflow-hidden">
      <template v-for="n in store.notifications" :key="n.id">
        <NotificationCommentItem v-if="n.type === 'comment'" :n="n" @read="markRead(n)" />
        <NotificationLikeItem v-else-if="n.type === 'like'" :n="n" @read="markRead(n)" />
        <NotificationFollowItem v-else-if="n.type === 'follow'" :n="n" @read="markRead(n)" />
        <NotificationPartnerItem v-else-if="n.type === 'partner'" :n="n" @read="markRead(n)" />
        <NotificationGenericItem v-else :n="n" @read="markRead(n)" />
      </template>
    </div>

    <div v-if="store.hasMoreNotify && store.notifications.length" class="text-center">
      <button class="btn-ghost !text-xs" :disabled="loading" @click="fetchList(false)">加载更多</button>
    </div>
  </div>
</template>
