<script setup lang="ts">
import { inject, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useCommunityStore } from '../stores/community'
import { communityApi } from '../api/community'
import { isAdmin, isLoggedIn, requireLogin } from '../services/auth'
import { COMMUNITY_TAGS } from '../data/defaults'
import type { CommunityPost, HotTopic } from '../types'
import PostCard from '../components/community/PostCard.vue'
import PostComposer from '../components/community/PostComposer.vue'
import TagBadge from '../components/community/TagBadge.vue'
import LeaderboardBoard from '../components/community/LeaderboardBoard.vue'
import ProgressBoard from '../components/community/ProgressBoard.vue'
import WeeklyReportCard from '../components/community/WeeklyReportCard.vue'
import ReportDialog from '../components/community/ReportDialog.vue'
import UserProfileModal from '../components/community/UserProfileModal.vue'

const store = useCommunityStore()
const router = useRouter()
const toast = inject<(m: string) => void>('toast', () => {})

const showComposer = ref(false)
const boardTab = ref<'checkin' | 'progress'>('checkin')
const hotTopics = ref<HotTopic[]>([])

onMounted(() => {
  store.fetchFeed(true).catch(e => toast(e?.message || '加载失败'))
  if (isLoggedIn.value) store.fetchUnreadCount().catch(() => {})
  loadDaily()
  loadHotTopics()
})

// ---- 无限滚动：哨兵元素进入视口时加载下一页 ----
const sentinel = ref<HTMLElement | null>(null)
const observer = new IntersectionObserver(entries => {
  if (entries.some(e => e.isIntersecting)) store.fetchFeed().catch(() => {})
}, { rootMargin: '200px' })
onMounted(() => { if (sentinel.value) observer.observe(sentinel.value) })
onUnmounted(() => observer.disconnect())

async function like(id: string) {
  if (requireLogin(router)) return
  try { await store.likePost(id) } catch (e: any) { toast(e?.message || '操作失败') }
}

function filterTag(tag: string) {
  store.setTag(tag).catch(e => toast(e?.message || '加载失败'))
}

function goRequireLogin(path: string) {
  if (requireLogin(router)) return
  router.push(path)
}

function openComposer() {
  if (requireLogin(router)) return
  showComposer.value = true
}

/** 「提问」类型筛选（再点一次取消） */
function toggleQuestionFilter() {
  store.setTypeFilter(store.typeFilter === 'question' ? '' : 'question')
    .catch(e => toast(e?.message || '加载失败'))
}

/** 「精华」筛选（再点一次取消；与类型筛选互斥） */
function toggleFeaturedFilter() {
  store.setFeatured(!store.featured).catch(e => toast(e?.message || '加载失败'))
}

/** 「关注」筛选（再点一次取消；与类型/精华筛选互斥） */
function toggleFollowFilter() {
  if (requireLogin(router)) return
  store.setFollowFilter(!store.followFilter).catch(e => toast(e?.message || '加载失败'))
}

// ---- 标签横向滑动提示（超出可视区可滑动查看，右侧渐变 + 文字提示） ----
const tagScrollRef = ref<HTMLElement | null>(null)
const tagHasMore = ref(false)   // 存在未展示完的标签
const tagAtEnd = ref(false)     // 已滑动到最右
const tagTouched = ref(false)   // 用户已滑动过（之后不再显示文字提示）

function updateTagScroll() {
  const el = tagScrollRef.value
  if (!el) return
  tagHasMore.value = el.scrollWidth > el.clientWidth + 4
  tagAtEnd.value = el.scrollWidth - el.clientWidth - el.scrollLeft <= 4
}
function onTagScroll() {
  tagTouched.value = true
  updateTagScroll()
}
onMounted(() => {
  updateTagScroll()
  window.addEventListener('resize', updateTagScroll)
})
onUnmounted(() => window.removeEventListener('resize', updateTagScroll))

// ---- 每日一题 ----
const dailyPost = ref<CommunityPost | null>(null)
async function loadDaily() {
  try {
    const res = await communityApi.daily()
    dailyPost.value = res.post
  } catch { dailyPost.value = null }
}

// ---- 热门话题运营位 ----
async function loadHotTopics() {
  try {
    const res = await communityApi.hotTopics()
    hotTopics.value = res.topics
  } catch { /* 静默降级 */ }
}

// ---- 举报 ----
const showReport = ref(false)
const reportPostId = ref('')
function openReport(postId: string) {
  if (requireLogin(router)) return
  reportPostId.value = postId
  showReport.value = true
}

// ---- 用户资料卡 ----
const showProfile = ref(false)
const profileUserId = ref('')
function openProfile(userId: string) {
  if (requireLogin(router)) return
  profileUserId.value = userId
  showProfile.value = true
}

// ---- 管理员操作 ----
async function togglePin(id: string) {
  try {
    const pinned = await store.adminPinPost(id)
    toast(pinned ? '已置顶' : '已取消置顶')
  } catch (e: any) { toast(e?.message || '操作失败') }
}

async function toggleFeature(id: string) {
  try {
    const featured = await store.adminFeaturePost(id)
    toast(featured ? '已加精 🌟' : '已取消加精')
  } catch (e: any) { toast(e?.message || '操作失败') }
}

async function toggleDaily(id: string) {
  try {
    const daily = await store.adminDailyPost(id)
    await loadDaily() // 顶部卡片同步刷新
    toast(daily ? '已设为每日一题 📅' : '已取消每日一题')
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
      <div class="flex items-center gap-2">
        <button class="btn-ghost !text-xs" @click="goRequireLogin('/community/messages')">✉️ 私信</button>
        <button class="btn-ghost !text-xs" @click="goRequireLogin('/community/circles')">🫧 圈子</button>
        <button class="btn-primary" @click="openComposer">✏️ 发帖</button>
      </div>
    </div>

    <!-- 上周学习周报（无数据时自动隐藏） -->
    <WeeklyReportCard />

    <!-- 热门话题运营位：点击按 tag 筛选帖子流 -->
    <div v-if="hotTopics.length" class="card !py-2.5">
      <div class="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
        <span class="text-xs font-semibold text-slate-500 dark:text-slate-400 shrink-0 pl-1">🔥 本周热门</span>
        <TagBadge v-for="t in hotTopics" :key="t.tag" :tag="t.text"
          :active="store.tag === t.tag" @click="filterTag(store.tag === t.tag ? '' : t.tag)" />
      </div>
    </div>

    <!-- 榜单：打卡榜 / 进步榜 -->
    <div class="card !py-3">
      <div class="flex bg-slate-100 dark:bg-slate-700 rounded-lg p-0.5 text-xs w-fit mb-3">
        <button class="px-3 py-1.5 rounded-md transition-colors"
          :class="boardTab === 'checkin' ? 'bg-white dark:bg-slate-800 font-semibold shadow-sm' : 'text-slate-500 dark:text-slate-400'"
          @click="boardTab = 'checkin'">打卡榜</button>
        <button class="px-3 py-1.5 rounded-md transition-colors"
          :class="boardTab === 'progress' ? 'bg-white dark:bg-slate-800 font-semibold shadow-sm' : 'text-slate-500 dark:text-slate-400'"
          @click="boardTab = 'progress'">进步榜</button>
      </div>
      <LeaderboardBoard v-show="boardTab === 'checkin'" />
      <ProgressBoard v-show="boardTab === 'progress'" />
    </div>

    <!-- 每日一题：管理员设置的最新一题，点击进入详情参与解答 -->
    <button v-if="dailyPost" class="card !p-4 text-left w-full flex items-center gap-3 border-l-4 !border-l-primary-400"
      @click="router.push(`/community/post/${dailyPost.id}`)">
      <span class="text-xl shrink-0">📅</span>
      <div class="flex-1 min-w-0">
        <div class="text-xs font-semibold text-primary-500">每日一题</div>
        <div class="text-sm truncate mt-0.5">{{ dailyPost.content }}</div>
      </div>
      <span class="text-[10px] text-slate-400 shrink-0">{{ dailyPost.userName }} · 💬{{ dailyPost.commentsCount }}</span>
    </button>

    <!-- 排序 + 标签筛选 -->
    <div class="flex flex-col gap-2">
      <!-- 排序/筛选按钮组：独占一行 -->
      <div class="flex bg-slate-100 dark:bg-slate-700 rounded-lg p-0.5 text-xs w-fit">
        <button class="px-3 py-1.5 rounded-md transition-colors"
          :class="store.sort === 'latest' ? 'bg-white dark:bg-slate-800 font-semibold shadow-sm' : 'text-slate-500 dark:text-slate-400'"
          @click="store.setSort('latest')">最新</button>
        <button class="px-3 py-1.5 rounded-md transition-colors"
          :class="store.sort === 'hot' ? 'bg-white dark:bg-slate-800 font-semibold shadow-sm' : 'text-slate-500 dark:text-slate-400'"
          @click="store.setSort('hot')">热门</button>
        <button class="px-3 py-1.5 rounded-md transition-colors"
          :class="store.typeFilter === 'question' ? 'bg-white dark:bg-slate-800 font-semibold shadow-sm' : 'text-slate-500 dark:text-slate-400'"
          @click="toggleQuestionFilter">❓ 提问</button>
        <button class="px-3 py-1.5 rounded-md transition-colors"
          :class="store.featured ? 'bg-white dark:bg-slate-800 font-semibold shadow-sm' : 'text-slate-500 dark:text-slate-400'"
          @click="toggleFeaturedFilter">🌟 精华</button>
        <button class="px-3 py-1.5 rounded-md transition-colors"
          :class="store.followFilter ? 'bg-white dark:bg-slate-800 font-semibold shadow-sm' : 'text-slate-500 dark:text-slate-400'"
          @click="toggleFollowFilter">👥 关注</button>
      </div>

      <!-- 预设话题标签：横向单行排列，超出可视区可滑动查看 -->
      <div class="relative">
        <div ref="tagScrollRef" class="flex gap-1.5 overflow-x-auto py-1 no-scrollbar scroll-smooth"
          @scroll.passive="onTagScroll">
          <TagBadge tag="全部" :active="!store.tag" @click="filterTag('')" />
          <TagBadge v-for="t in COMMUNITY_TAGS" :key="t" :tag="t" :active="store.tag === t" @click="filterTag(store.tag === t ? '' : t)" />
        </div>
        <!-- 右侧渐变遮罩：暗示还有更多标签 -->
        <div v-if="tagHasMore && !tagAtEnd"
          class="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-slate-50 dark:from-slate-900 to-transparent"></div>
        <!-- 滑动提示：仅未滑动过时显示，明确告知可滑动查看 -->
        <transition name="fade">
          <div v-if="tagHasMore && !tagAtEnd && !tagTouched"
            class="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5 rounded-full bg-white/90 dark:bg-slate-800/90 px-1.5 py-0.5 text-[10px] text-slate-500 dark:text-slate-400 shadow-sm">
            <span>滑动查看</span>
            <span aria-hidden="true">›</span>
          </div>
        </transition>
      </div>
    </div>

    <!-- 帖子列表 -->
    <div class="space-y-3">
      <PostCard v-for="p in store.posts" :key="p.id" :post="p"
        @like="like(p.id)"
        @tag="filterTag"
        @open="router.push(`/community/post/${p.id}`)"
        @pin="togglePin(p.id)"
        @feature="toggleFeature(p.id)"
        @daily="toggleDaily(p.id)"
        @profile="openProfile(p.userId)"
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
    <UserProfileModal v-model:show="showProfile" :user-id="profileUserId" />
  </div>
</template>

<style scoped>
/* 隐藏横向滚动条，保留滑动能力（以渐变遮罩替代视觉提示） */
.no-scrollbar { scrollbar-width: none; -ms-overflow-style: none; }
.no-scrollbar::-webkit-scrollbar { display: none; }
.fade-enter-active, .fade-leave-active { transition: opacity 0.2s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
