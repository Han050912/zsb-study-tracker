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
  { value: 'featured', label: '精华' },
  { value: 'follow', label: '关注' },
  { value: 'question', label: '提问' },
  { value: 'circles', label: '圈子' }
]
const activeView = computed(() => (primaryTabs.some((t) => t.value === view.value) ? view.value : 'recommend'))
const emptyMessage = computed(() => {
  if (feed.tag || feed.query.keyword)
    return `没有找到${feed.tag ? `「${feed.tag}」话题下的` : ''}${view.value === 'featured' ? '精华' : ''}相关讨论，试试其他关键词或清除筛选。`
  if (view.value === 'featured') return '还没有精华讨论，值得推荐的解题思路和复习经验会出现在这里。'
  if (view.value === 'follow') return '关注同学后，他们的学习动态会出现在这里。'
  if (view.value === 'question') return '还没有问题，把你的疑惑写下来。'
  return '还没有讨论，可以分享一道真题或你的复习方法。'
})
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
  <div class="collaboration-page study-page social-page discussion-page">
    <header class="social-heading">
      <div>
        <h1 class="social-title">升本讨论</h1>
        <p class="social-description">一道没解开的题，一份值得分享的经验，都从这里聊起。</p>
      </div>
      <div class="social-heading-actions">
        <button class="btn-ghost" aria-label="搜索帖子、用户和圈子" title="搜索" @click="showSearch = true">
          <Search :size="18" /><span class="hidden sm:inline">搜索</span></button
        ><button class="btn-primary social-primary" @click="openComposer"><Plus :size="18" />发帖</button>
      </div>
    </header>
    <div class="social-columns">
      <section class="discussion-main" aria-label="讨论内容">
        <div class="feed-filters discussion-filters">
          <AppTabs
            id="community-view"
            class="discussion-tabs"
            :model-value="activeView"
            :items="primaryTabs"
            label="社区内容"
            @update:model-value="chooseView"
          />
          <div v-if="view !== 'circles'" class="discussion-filter-row" aria-label="排序与话题筛选">
            <div class="discussion-filter-group" role="group" aria-label="讨论排序">
              <span class="discussion-filter-label">排序</span>
              <button
                v-for="sort in ['latest', 'hot'] as const"
                :key="sort"
                class="discussion-filter discussion-sort"
                :aria-pressed="feed.sort === sort"
                @click="setQuery({ sort })"
              >
                {{ sort === 'latest' ? '最新' : '热门' }}
              </button>
            </div>
            <div class="discussion-filter-group discussion-topic-filters" role="group" aria-label="讨论话题">
              <span class="discussion-filter-label">话题</span>
              <button
                v-for="tag in COMMUNITY_TAGS"
                :key="tag"
                class="discussion-filter"
                :aria-pressed="feed.tag === tag"
                @click="setQuery({ tag: feed.tag === tag ? undefined : tag })"
              >
                {{ tag }}
              </button>
            </div>
          </div>
        </div>
        <div
          id="community-view-panel"
          role="tabpanel"
          :aria-labelledby="`community-view-tab-${activeView}`"
          class="discussion-panel"
        >
          <Circles v-if="view === 'circles' && isLoggedIn" embedded />
          <template v-else>
            <button class="discussion-compose" @click="openComposer">
              <span class="discussion-compose-mark" aria-hidden="true"><Plus :size="22" /></span>
              <span class="discussion-compose-copy">
                <strong>{{ view === 'question' ? '哪道题卡住了？' : '今天，有什么想和同学聊聊？' }}</strong>
                <span>{{
                  view === 'question' ? '写下题目和思路，一起找出关键一步。' : '分享复习方法，也可以带着问题来。'
                }}</span>
              </span>
              <span class="discussion-compose-label">{{ view === 'question' ? '提个问题' : '写一条' }}</span>
            </button>
            <div v-if="feed.tag || feed.query.keyword" class="discussion-active-filter">
              <span>筛选：{{ feed.tag }} {{ feed.query.keyword }}</span
              ><button class="btn-ghost" @click="setQuery({ tag: undefined, q: undefined })">清除筛选</button>
            </div>
            <button
              v-if="dailyPost && !feed.tag && !feed.query.keyword"
              type="button"
              class="discussion-daily"
              @click="router.push({ name: 'community-post', params: { id: dailyPost.id } })"
            >
              <span class="discussion-daily-label">每日一题</span>
              <span class="discussion-daily-copy"
                ><strong>{{ dailyPost.content }}</strong
                ><span>带着思路，一起解题</span></span
              >
              <ArrowUpRight :size="18" aria-hidden="true" class="shrink-0 ml-auto" />
            </button>
            <button type="button" class="discussion-mobile-rail lg:hidden" @click="showRail = true">
              今日同行 · 周报与榜单
              <ArrowUpRight :size="18" aria-hidden="true" />
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
              <div class="forum-stream discussion-stream">
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
                    ><button class="text-sm text-correction" @click.stop="action('remove', post.id)">
                      删除
                    </button></template
                  ></PostCard
                >
              </div>
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
            <div class="discussion-end" aria-live="polite">
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
      <aside v-if="feed.bucket.updatedAt" class="social-rail hidden lg:block" aria-label="同学与备考动态">
        <CommunityRail :extras="feed.recommendExtras" @tag="setQuery({ tag: $event })" />
      </aside>
    </div>
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
