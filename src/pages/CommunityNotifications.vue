<script setup lang="ts">
import { inject, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useCommunityStore } from '../stores/community'
import { fromNow } from '../utils/date'
import type { CommunityNotification, NotificationTargetType, NotificationType } from '../types'

const store = useCommunityStore()
const router = useRouter()
const toast = inject<(m: string) => void>('toast', () => {})

const FILTERS: { k: NotificationType | ''; l: string }[] = [
  { k: '', l: '全部' },
  { k: 'like', l: '点赞' },
  { k: 'comment', l: '评论' },
  { k: 'follow', l: '关注' },
  { k: 'achievement', l: '成就' },
  { k: 'message', l: '私信' },
  { k: 'system', l: '系统' }
]
function switchFilter(k: NotificationType | '') {
  store.setNotifyFilter(k).catch(e => toast(e?.message || '加载失败'))
}

onMounted(() => {
  store.fetchNotifications(true).catch(e => toast(e?.message || '加载失败'))
})

/** 通知跳转目标 → 路由前缀 */
const NOTIFY_TARGET_ROUTES: Record<NotificationTargetType, string> = {
  post: '/community/post',
  user: '/profile',
  message: '/community/messages',
  team: '/teams',
  circle: '/community/circles',
  partner: '/community/partners'
}

/** 固定路径目标：页面不接收 id 参数，跳转时无需拼接 targetId */
const STATIC_TARGETS: NotificationTargetType[] = ['partner']

/** 点击通知：标记已读并跳转到对应目标页面（无目标则不跳转） */
async function open(n: CommunityNotification) {
  store.markRead(n).catch(() => {})
  if (!n.targetType) return
  const base = NOTIFY_TARGET_ROUTES[n.targetType]
  if (!base) return
  // 固定路径目标（如学习搭子页）直接跳转，不拼接 targetId
  if (STATIC_TARGETS.includes(n.targetType)) { router.push(base); return }
  if (!n.targetId) return
  // 评论/回复/点赞评论类通知携带 commentId：帖子详情页据此滚动并高亮定位到该条评论
  const query = n.commentId && n.targetType === 'post' ? { comment: n.commentId } : undefined
  router.push({ path: `${base}/${n.targetId}`, query })
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
      <button v-for="n in store.notifications" :key="n.id"
        class="w-full flex items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-700/40"
        @click="open(n)">
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
