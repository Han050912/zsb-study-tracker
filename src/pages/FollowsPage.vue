<script setup lang="ts">
/** 粉丝/关注/互关关系列表页：路由 /follows/:id?tab=fans|following|mutual；游标分页 + 切 tab 令牌防竞态 */
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { communityApi } from '../api/community'
import UserRelationItem from '../components/profile/UserRelationItem.vue'
import { useBack } from '../composables/useBack'
import { sessionUser } from '../services/auth'
import type { FollowListItem } from '../types'

const route = useRoute()
const router = useRouter()
const { goBack } = useBack()
const userId = route.params.id as string
const isSelf = computed(() => userId === sessionUser.value?.id)
const tab = ref<'fans' | 'following' | 'mutual'>(
  ['fans', 'following', 'mutual'].includes(route.query.tab as string) ? route.query.tab as 'fans' | 'following' | 'mutual' : 'fans')
const ownerName = ref('')

const items = ref<FollowListItem[]>([])
const cursor = ref<string | null>(null)
const loading = ref(false)
const loadError = ref(false)

const FETCHERS = {
  fans: communityApi.followers,
  following: communityApi.following,
  mutual: communityApi.mutualFollows
} as const
const TABS = ['fans', 'following', 'mutual'] as const
const TITLES = { fans: '粉丝', following: '关注', mutual: '互关' } as const
const EMPTY_TEXTS = { fans: '还没有粉丝，去社区逛逛吧', following: '还没有关注任何人', mutual: '还没有互关好友' } as const

let loadTicket = 0 // 切 tab 竞态防护（与 UserWorksTabs 同口径）
async function loadMore() {
  if (loading.value) return
  loading.value = true
  loadError.value = false
  const ticket = ++loadTicket
  const t = tab.value
  try {
    const res = await FETCHERS[t](userId, cursor.value)
    if (ticket !== loadTicket || t !== tab.value) return
    items.value.push(...res.items)
    cursor.value = res.nextCursor
  } catch {
    if (ticket === loadTicket && t === tab.value) loadError.value = true
  } finally {
    if (ticket === loadTicket) loading.value = false
  }
}

function switchTab(t: 'fans' | 'following' | 'mutual') {
  if (t === tab.value) return
  tab.value = t
  router.replace({ query: { tab: t } }) // tab 与 URL 同步，可分享
  items.value = []; cursor.value = null; loadError.value = false
  loadTicket++
  loading.value = false
  loadMore()
}

onMounted(async () => {
  loadMore()
  try { ownerName.value = (await communityApi.profile(userId)).userName } catch { /* 标题降级为 我的/TA 的 */ }
})

/** 受控 FollowButton 契约：回写 item 并重算 relation */
function onFollowChange(uid: string, following: boolean) {
  const it = items.value.find(i => i.userId === uid)
  if (!it) return
  it.followedByMe = following
  it.relation = it.userId === sessionUser.value?.id ? 'none'
    : it.followedByMe && it.followsMe ? 'mutual'
    : it.followedByMe ? 'following' : it.followsMe ? 'follower' : 'none'
}
</script>

<template>
  <div class="p-4 md:p-6 max-w-2xl mx-auto space-y-4">
    <!-- 顶部导航行 -->
    <div class="flex items-center gap-2">
      <button class="btn-ghost !px-2" @click="goBack">← 返回</button>
      <h2 class="text-lg font-bold">{{ isSelf ? '我的' : (ownerName || 'TA 的') }}{{ TITLES[tab] }}</h2>
    </div>

    <!-- Tab 头 -->
    <div class="flex gap-6 px-2">
      <button v-for="t in TABS" :key="t" class="pb-1.5 text-sm font-medium transition-colors"
        :class="tab === t ? 'border-b-2 border-primary-500 text-primary-600 dark:text-primary-400' : 'text-slate-400'"
        @click="switchTab(t)">{{ TITLES[t] }}</button>
    </div>

    <!-- 列表区 -->
    <div class="card !p-2">
      <UserRelationItem v-for="it in items" :key="it.userId" :item="it" @follow-change="onFollowChange" />

      <!-- 加载中 -->
      <div v-if="loading" class="text-center text-xs text-slate-400 py-10">加载中…</div>
      <!-- 错误态 -->
      <div v-else-if="loadError" class="text-center text-xs text-slate-400 py-10">
        加载失败
        <button class="btn-ghost !text-xs ml-1" @click="loadMore">重试</button>
      </div>
      <!-- 空态（items 空且非 loading 且 cursor===null） -->
      <div v-else-if="!items.length && cursor === null" class="text-center text-xs text-slate-400 py-10">{{ EMPTY_TEXTS[tab] }}</div>

      <!-- 加载更多 -->
      <button v-if="cursor && !loading" class="btn-ghost w-full !text-xs" @click="loadMore">加载更多</button>
      <!-- 到底提示 -->
      <div v-else-if="cursor === null && items.length" class="text-center text-[10px] text-slate-300 py-2">没有更多了</div>
    </div>
  </div>
</template>
