<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Search, Plus, ArrowUpRight } from '@lucide/vue'
import { postsApi } from '../api/community/posts'
import { isAdmin, isLoggedIn, requireLogin } from '../services/auth'
import { COMMUNITY_TAGS } from '../data/defaults'
import { useFeedQuery } from '../features/community/composables/useFeedQuery'
import { usePostActions } from '../features/community/composables/usePostActions'
import type { CommunityPost } from '../types'
import PostCard from '../components/community/PostCard.vue'
import AppTabs from '../shared/components/AppTabs.vue'
import AsyncState from '../shared/components/AsyncState.vue'
import Modal from '../components/Modal.vue'

const PostComposer = defineAsyncComponent(() => import('../components/community/PostComposer.vue'))
const CommunityRail = defineAsyncComponent(() => import('../components/community/CommunityRail.vue'))
const ReportDialog = defineAsyncComponent(() => import('../components/community/ReportDialog.vue'))
const UserProfileModal = defineAsyncComponent(() => import('../components/community/UserProfileModal.vue'))
const CommunitySearch = defineAsyncComponent(() => import('../components/community/CommunitySearch.vue'))
const Circles = defineAsyncComponent(() => import('./Circles.vue'))
const router = useRouter(),
  { feed, view, setQuery } = useFeedQuery()
const { action, showProfile, profileUserId, showReport, reportPostId, openProfile, openReport } = usePostActions()
const showComposer = ref(false),
  showSearch = ref(false),
  showRail = ref(false),
  composerLoaded = ref(false)
const dailyPost = ref<CommunityPost | null>(null),
  sentinel = ref<HTMLElement | null>(null)
const primaryTabs = [
  { value: 'recommend', label: '推荐' },
  { value: 'follow', label: '关注' },
  { value: 'question', label: '提问' },
  { value: 'circles', label: '圈子' }
]
const activeView = computed(() => (primaryTabs.some((t) => t.value === view.value) ? view.value : 'recommend'))
const emptyMessage = computed(() =>
  view.value === 'follow'
    ? '关注同学后，他们的学习动态会出现在这里。'
    : view.value === 'question'
      ? '这个筛选下还没有问题，把你的疑惑写下来。'
      : feed.tag || feed.query.keyword
        ? '没有找到相关讨论，试试其他关键词或标签。'
        : '今天的学习现场，等你分享。'
)
function chooseView(value: string) {
  if (['follow', 'circles'].includes(value) && requireLogin(router)) return
  void setQuery({ view: value, q: undefined })
}
function openComposer() {
  if (requireLogin(router)) return
  composerLoaded.value = true
  showComposer.value = true
}
function searchPosts(keyword: string) {
  void setQuery({ q: keyword, view: 'all' })
  showSearch.value = false
}
function chooseRailTag(tag: string) {
  void setQuery({ tag })
  showRail.value = false
}
let observer: IntersectionObserver | undefined
onMounted(() => {
  void postsApi
    .daily()
    .then((res) => {
      dailyPost.value = res.post
    })
    .catch(() => {})
  observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting) && !feed.error && !feed.feedLoading && feed.posts.length)
        void feed.fetchFeed()
    },
    { rootMargin: '200px' }
  )
  if (sentinel.value) observer.observe(sentinel.value)
})
watch(sentinel, (el, previous) => {
  if (previous) observer?.unobserve(previous)
  if (el) observer?.observe(el)
})
onUnmounted(() => observer?.disconnect())
</script>

<template>
  <div class="collaboration-page max-w-6xl mx-auto p-4 md:p-6 space-y-5">
    <header class="flex items-end justify-between gap-3">
      <div>
        <p class="text-xs text-slate-500 mb-1">把今天学到的，留给同行的人</p>
        <h1 class="collaboration-title">社区</h1>
      </div>
      <div class="flex gap-2 items-center">
        <button class="btn-ghost" aria-label="搜索帖子、用户和圈子" title="搜索" @click="showSearch = true">
          <Search :size="18" /><span class="hidden sm:inline">搜索</span></button
        ><button class="btn-primary hidden md:inline-flex" @click="openComposer"><Plus :size="18" />发布</button>
      </div>
    </header>
    <div class="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_280px] gap-8 items-start">
      <section class="min-w-0 space-y-4">
        <div class="feed-filters space-y-2">
          <AppTabs
            id="community-view"
            :model-value="activeView"
            :items="primaryTabs"
            label="社区内容"
            @update:model-value="chooseView"
          />
          <div v-if="view !== 'circles'" class="flex gap-2 overflow-x-auto items-center pb-1 text-sm">
            <button
              v-for="sort in ['latest', 'hot'] as const"
              :key="sort"
              class="px-3 rounded-lg"
              :class="feed.sort === sort ? 'bg-white dark:bg-slate-800 font-semibold' : 'text-slate-500'"
              :aria-pressed="feed.sort === sort"
              @click="setQuery({ sort })"
            >
              {{ sort === 'latest' ? '最新' : '热门' }}
            </button>
            <span class="h-5 border-l border-slate-300" aria-hidden="true"></span>
            <button
              class="px-3 whitespace-nowrap"
              :aria-pressed="view === 'featured'"
              @click="setQuery({ view: view === 'featured' ? 'recommend' : 'featured' })"
            >
              精华
            </button>
            <button
              v-for="tag in COMMUNITY_TAGS"
              :key="tag"
              class="px-3 rounded-lg whitespace-nowrap"
              :class="
                feed.tag === tag
                  ? 'text-primary-600 bg-primary-50 dark:bg-primary-900/30'
                  : 'text-slate-500 dark:text-slate-400'
              "
              :aria-pressed="feed.tag === tag"
              @click="setQuery({ tag: feed.tag === tag ? undefined : tag })"
            >
              {{ tag }}
            </button>
          </div>
        </div>
        <div
          id="community-view-panel"
          role="tabpanel"
          :aria-labelledby="`community-view-tab-${activeView}`"
          class="space-y-4"
        >
          <Circles v-if="view === 'circles' && isLoggedIn" />
          <template v-else>
            <div
              v-if="feed.tag || feed.query.keyword"
              class="flex flex-wrap items-center justify-between gap-2 text-sm"
            >
              <span>筛选：{{ feed.tag }} {{ feed.query.keyword }}</span
              ><button class="btn-ghost" @click="setQuery({ tag: undefined, q: undefined })">清除筛选</button>
            </div>
            <button
              v-if="dailyPost && !feed.tag && !feed.query.keyword"
              class="card w-full flex items-center gap-3 text-left !py-3"
              @click="router.push({ name: 'community-post', params: { id: dailyPost.id } })"
            >
              <span class="text-primary-600 dark:text-primary-400 text-xs font-semibold shrink-0">每日一题</span
              ><span class="truncate text-sm">{{ dailyPost.content }}</span
              ><ArrowUpRight :size="18" class="shrink-0 ml-auto" />
            </button>
            <button class="lg:hidden text-sm text-slate-500 flex justify-between w-full" @click="showRail = true">
              今日同行 · 周报与榜单 <span>↗</span>
            </button>
            <AsyncState
              :loading="feed.bucket.status === 'initial-loading'"
              :error="!feed.posts.length ? feed.bucket.initialError : ''"
              :empty="!feed.posts.length && !feed.feedLoading && !feed.error"
              :message="emptyMessage"
              @retry="feed.fetchFeed(true)"
            >
              <template #action
                ><button v-if="view === 'follow'" class="btn-ghost" @click="showSearch = true">去发现同学</button
                ><button v-else class="btn-ghost" @click="openComposer">
                  {{ view === 'question' ? '发布第一个问题' : '分享学习动态' }}
                </button></template
              >
              <p v-if="feed.bucket.status === 'refreshing'" role="status" class="text-xs text-slate-500">
                正在更新讨论…
              </p>
              <PostCard
                v-for="post in feed.posts"
                :key="post.id"
                :post="post"
                @like="action('like', post.id)"
                @dislike="action('dislike', post.id)"
                @tag="setQuery({ tag: $event })"
                @open="router.push({ name: 'community-post', params: { id: post.id } })"
                @profile="openProfile(post.userId)"
                @report="openReport(post.id)"
                @pin="action('pin', post.id)"
                @feature="action('feature', post.id)"
                @daily="action('daily', post.id)"
                @hide="action('hide', post.id)"
                ><template v-if="isAdmin" #actions
                  ><button class="text-sm text-red-500" @click.stop="action('remove', post.id)">删除</button></template
                ></PostCard
              >
            </AsyncState>
            <AsyncState
              v-if="feed.posts.length && feed.bucket.initialError"
              :error="feed.bucket.initialError"
              @retry="feed.fetchFeed(true)"
            />
            <AsyncState
              v-if="feed.bucket.loadMoreError"
              :error="feed.bucket.loadMoreError"
              @retry="feed.fetchFeed(false)"
            />
            <div ref="sentinel" class="h-1"></div>
            <div class="text-center text-sm text-slate-500" aria-live="polite">
              <button
                v-if="feed.hasMore && feed.posts.length && !feed.error"
                class="btn-ghost"
                :disabled="feed.feedLoading"
                @click="feed.fetchFeed(false)"
              >
                {{ feed.feedLoading ? '正在加载' : '加载更多讨论' }}</button
              ><span v-else-if="!feed.hasMore && feed.posts.length">你已看完这些讨论</span>
            </div>
          </template>
        </div>
      </section>
      <aside v-if="feed.bucket.updatedAt" class="hidden lg:block pt-4">
        <CommunityRail :extras="feed.recommendExtras" @tag="setQuery({ tag: $event })" />
      </aside>
    </div>
    <button
      class="btn-primary md:hidden fixed right-4 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-20 !rounded-full !px-5 shadow-lg"
      @click="openComposer"
    >
      <Plus :size="18" />发布
    </button>
    <PostComposer
      v-if="composerLoaded"
      v-model:show="showComposer"
      :type="view === 'question' ? 'question' : 'share'"
      allow-type-switch
      allow-template
      @posted="feed.fetchFeed(true)"
    />
    <CommunitySearch v-if="showSearch" @close="showSearch = false" @search-posts="searchPosts" />
    <ReportDialog v-if="showReport" v-model:show="showReport" target-type="post" :target-id="reportPostId" />
    <UserProfileModal v-if="showProfile" v-model:show="showProfile" :user-id="profileUserId" />
    <Modal title="今日同行" :show="showRail" @close="showRail = false"
      ><CommunityRail v-if="showRail" :extras="feed.recommendExtras" @tag="chooseRailTag"
    /></Modal>
  </div>
</template>
