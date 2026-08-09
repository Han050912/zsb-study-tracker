<script setup lang="ts">
import { inject, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useCommunityStore } from '../stores/community'
import { COMMUNITY_TAGS } from '../data/defaults'
import PostCard from '../components/community/PostCard.vue'
import PostComposer from '../components/community/PostComposer.vue'
import TagBadge from '../components/community/TagBadge.vue'

const store = useCommunityStore()
const router = useRouter()
const toast = inject<(m: string) => void>('toast', () => {})

const showComposer = ref(false)

onMounted(() => {
  store.fetchFeed(true).catch(e => toast(e?.message || '加载失败'))
  store.fetchUnreadCount().catch(() => {})
})

// ---- 无限滚动：哨兵元素进入视口时加载下一页 ----
const sentinel = ref<HTMLElement | null>(null)
const observer = new IntersectionObserver(entries => {
  if (entries.some(e => e.isIntersecting)) store.fetchFeed().catch(() => {})
}, { rootMargin: '200px' })
onMounted(() => { if (sentinel.value) observer.observe(sentinel.value) })
onUnmounted(() => observer.disconnect())

async function like(id: string) {
  try { await store.likePost(id) } catch (e: any) { toast(e?.message || '操作失败') }
}

function filterTag(tag: string) {
  store.setTag(tag).catch(e => toast(e?.message || '加载失败'))
}
</script>

<template>
  <div class="p-4 md:p-6 max-w-2xl mx-auto space-y-4">
    <div class="flex items-center justify-between">
      <h1 class="page-title">💬 社区广场</h1>
      <button class="btn-primary" @click="showComposer = true">✏️ 发帖</button>
    </div>

    <!-- 排序 + 标签筛选 -->
    <div class="flex items-center gap-2">
      <div class="flex bg-slate-100 dark:bg-slate-700 rounded-lg p-0.5 text-xs">
        <button class="px-3 py-1.5 rounded-md transition-colors"
          :class="store.sort === 'latest' ? 'bg-white dark:bg-slate-800 font-semibold shadow-sm' : 'text-slate-500 dark:text-slate-400'"
          @click="store.setSort('latest')">最新</button>
        <button class="px-3 py-1.5 rounded-md transition-colors"
          :class="store.sort === 'hot' ? 'bg-white dark:bg-slate-800 font-semibold shadow-sm' : 'text-slate-500 dark:text-slate-400'"
          @click="store.setSort('hot')">热门</button>
      </div>
      <div class="flex gap-1.5 overflow-x-auto flex-1 py-1">
        <TagBadge tag="全部" :active="!store.tag" @click="filterTag('')" />
        <TagBadge v-for="t in COMMUNITY_TAGS" :key="t" :tag="t" :active="store.tag === t" @click="filterTag(store.tag === t ? '' : t)" />
      </div>
    </div>

    <!-- 帖子列表 -->
    <div class="space-y-3">
      <PostCard v-for="p in store.posts" :key="p.id" :post="p"
        @like="like(p.id)"
        @tag="filterTag"
        @open="router.push(`/community/post/${p.id}`)" />
    </div>

    <div v-if="!store.posts.length && !store.feedLoading" class="card text-center py-10 text-slate-400 text-sm">
      <div class="text-3xl mb-2">🌱</div>
      <p>还没有动态，来发第一帖吧！</p>
    </div>

    <!-- 无限滚动哨兵 -->
    <div ref="sentinel" class="h-1"></div>
    <div v-if="store.feedLoading" class="text-center text-xs text-slate-400 py-2">加载中…</div>
    <div v-else-if="!store.hasMore && store.posts.length" class="text-center text-xs text-slate-400 py-2">没有更多了</div>

    <PostComposer v-model:show="showComposer" type="share" />
  </div>
</template>
