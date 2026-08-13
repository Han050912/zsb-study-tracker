<script setup lang="ts">
import { inject, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useCommunityStore } from '../stores/community'
import { isAdmin } from '../services/auth'
import { COMMUNITY_TAGS } from '../data/defaults'
import PostCard from '../components/community/PostCard.vue'
import PostComposer from '../components/community/PostComposer.vue'
import TagBadge from '../components/community/TagBadge.vue'
import LeaderboardBoard from '../components/community/LeaderboardBoard.vue'
import ReportDialog from '../components/community/ReportDialog.vue'

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

/** 「提问」类型筛选（再点一次取消） */
function toggleQuestionFilter() {
  store.setTypeFilter(store.typeFilter === 'question' ? '' : 'question')
    .catch(e => toast(e?.message || '加载失败'))
}

// ---- 举报 ----
const showReport = ref(false)
const reportPostId = ref('')
function openReport(postId: string) {
  reportPostId.value = postId
  showReport.value = true
}

// ---- 管理员操作 ----
async function togglePin(id: string) {
  try {
    const pinned = await store.adminPinPost(id)
    toast(pinned ? '已置顶' : '已取消置顶')
  } catch (e: any) { toast(e?.message || '操作失败') }
}

async function toggleHide(id: string) {
  try {
    const hidden = await store.adminHidePost(id)
    toast(hidden ? '已隐藏' : '已取消隐藏')
  } catch (e: any) { toast(e?.message || '操作失败') }
}

async function removePost(id: string) {
  if (!window.confirm('确认删除这篇帖子？评论和点赞将一并删除。')) return
  try {
    await store.removePost(id)
    toast('帖子已删除')
  } catch (e: any) { toast(e?.message || '删除失败') }
}
</script>

<template>
  <div class="p-4 md:p-6 max-w-2xl mx-auto space-y-4">
    <div class="flex items-center justify-between">
      <h1 class="page-title">💬 社区广场</h1>
      <button class="btn-primary" @click="showComposer = true">✏️ 发帖</button>
    </div>

    <!-- 每日打卡榜 -->
    <LeaderboardBoard />

    <!-- 排序 + 标签筛选 -->
    <div class="flex items-center gap-2">
      <div class="flex bg-slate-100 dark:bg-slate-700 rounded-lg p-0.5 text-xs">
        <button class="px-3 py-1.5 rounded-md transition-colors"
          :class="store.sort === 'latest' ? 'bg-white dark:bg-slate-800 font-semibold shadow-sm' : 'text-slate-500 dark:text-slate-400'"
          @click="store.setSort('latest')">最新</button>
        <button class="px-3 py-1.5 rounded-md transition-colors"
          :class="store.sort === 'hot' ? 'bg-white dark:bg-slate-800 font-semibold shadow-sm' : 'text-slate-500 dark:text-slate-400'"
          @click="store.setSort('hot')">热门</button>
        <button class="px-3 py-1.5 rounded-md transition-colors"
          :class="store.typeFilter === 'question' ? 'bg-white dark:bg-slate-800 font-semibold shadow-sm' : 'text-slate-500 dark:text-slate-400'"
          @click="toggleQuestionFilter">❓ 提问</button>
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
        @open="router.push(`/community/post/${p.id}`)"
        @pin="togglePin(p.id)"
        @hide="toggleHide(p.id)"
        @report="openReport(p.id)">
        <template v-if="isAdmin" #actions>
          <button class="text-xs text-slate-400 hover:text-red-500" @click.stop="removePost(p.id)">删除</button>
        </template>
      </PostCard>
    </div>

    <div v-if="!store.posts.length && !store.feedLoading" class="card text-center py-10 text-slate-400 text-sm">
      <div class="text-3xl mb-2">🌱</div>
      <p>还没有动态，来发第一帖吧！</p>
    </div>

    <!-- 无限滚动哨兵 -->
    <div ref="sentinel" class="h-1"></div>
    <div v-if="store.feedLoading" class="text-center text-xs text-slate-400 py-2">加载中…</div>
    <div v-else-if="!store.hasMore && store.posts.length" class="text-center text-xs text-slate-400 py-2">没有更多了</div>

    <PostComposer v-model:show="showComposer" type="share" allow-type-switch />
    <ReportDialog v-model:show="showReport" target-type="post" :target-id="reportPostId" />
  </div>
</template>
