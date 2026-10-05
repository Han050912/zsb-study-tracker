<script setup lang="ts">
import IconAction from '../shared/components/IconAction.vue'
import EmptyState from '../shared/components/EmptyState.vue'
import LoadingState from '../shared/components/LoadingState.vue'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { requireLogin } from '../services/auth'
import { getErrorMessage } from '../utils/error'
import { useToast } from '../composables/useToast'
import { useRoute, useRouter } from 'vue-router'
import { postsApi } from '../api/community/posts'
import { RefreshCw, TriangleAlert, ArrowLeft } from '@lucide/vue'
import { useAppStore } from '../stores/app'
import PostCard from '../components/community/PostCard.vue'
import PostComposer from '../components/community/PostComposer.vue'
import UserProfileModal from '../components/community/UserProfileModal.vue'
import ReportDialog from '../components/community/ReportDialog.vue'
import { useBack } from '../composables/useBack'
import { subjectLabel } from '../utils/subject'
import { usePostCollection } from '../features/community/composables/usePostCollection'

/**
 * 知识点讨论区（P2-6）：以「科目 + 章节」为讨论单元的帖子流。
 * 讨论帖经 topicRef（'subjectId|chapterName'）标记归属，不进公共广场；
 * 复用 postsApi.feed(topicSubject, topicChapter) 拉取。
 */
const route = useRoute()
const router = useRouter()
const { goBack } = useBack()
const toast = useToast()
const appStore = useAppStore()

const subjectId = route.params.subjectId as string
const chapterName = computed(() => (typeof route.query.chapter === 'string' ? route.query.chapter : ''))
const topicRef = computed(() => `${subjectId}|${chapterName.value}`)

const subject = computed(() => appStore.subjectMap[subjectId])

const { posts, entities } = usePostCollection()
const feedCursor = ref<string | null>(null)
const loading = ref(true)
const feedLoading = ref(false)
const feedError = ref('')
const showComposer = ref(false)
let feedTicket = 0,
  disposed = false
onBeforeUnmount(() => {
  disposed = true
  feedTicket++
})

watch(
  chapterName,
  () => {
    feedTicket++
    showComposer.value = false
    posts.value = []
    feedCursor.value = null
    feedError.value = ''
    loading.value = true
    if (!chapterName.value) {
      toast('章节参数缺失')
      router.replace('/community')
      return
    }
    void loadFeed(true)
  },
  { immediate: true }
)

async function loadFeed(reset = false) {
  if (!reset && feedLoading.value) return
  const ticket = ++feedTicket
  feedLoading.value = true
  feedError.value = ''
  try {
    const res = await postsApi.feed({
      topicSubject: subjectId,
      topicChapter: chapterName.value,
      cursor: reset ? null : feedCursor.value
    })
    if (disposed || ticket !== feedTicket) return
    posts.value = reset ? res.posts : [...posts.value, ...res.posts]
    feedCursor.value = res.nextCursor
  } catch (e) {
    if (disposed || ticket !== feedTicket) return
    // 首屏失败展示错误态；追加失败仅提示，保留已加载内容
    if (reset) feedError.value = getErrorMessage(e, '加载失败')
    else toast(getErrorMessage(e, '加载失败'))
  } finally {
    if (ticket === feedTicket) {
      feedLoading.value = false
      loading.value = false
    }
  }
}

// ---- 发帖 ----
function onPosted() {
  loadFeed(true)
}

// ---- 帖子互动（局部状态） ----
async function likePost(id: string) {
  if (requireLogin(router)) return
  const p = posts.value.find((x) => x.id === id)
  if (!p) return
  try {
    await entities.likePost(id)
  } catch (e) {
    toast(getErrorMessage(e, '点赞未能更新，请重试'))
  }
}

async function dislikePost(id: string) {
  if (requireLogin(router)) return
  try {
    await entities.dislikePost(id)
  } catch (e) {
    toast(getErrorMessage(e, '不赞同状态未能更新，请重试'))
  }
}

// ---- 资料卡 / 举报 ----
const showProfile = ref(false)
const profileUserId = ref('')
function openProfile(userId: string) {
  profileUserId.value = userId
  showProfile.value = true
}
const showReport = ref(false)
const reportPostId = ref('')
function openReport(postId: string) {
  reportPostId.value = postId
  showReport.value = true
}
</script>

<template>
  <div class="collaboration-page study-page reading-page space-y-4">
    <div class="flex items-center gap-2">
      <span class="arrow-action" @click="goBack"
        ><IconAction :icon="ArrowLeft" label="返回" @click="goBack" /> 返回</span
      >
      <h1 class="page-title flex-1 min-w-0 truncate">{{ subjectLabel(subject, subjectId) }} · {{ chapterName }}</h1>
    </div>
    <p class="text-xs text-slate-400 -mt-2">本章节疑难讨论（仅本讨论区可见，不进公共广场）</p>

    <LoadingState v-if="loading" />

    <template v-else>
      <!-- 发帖入口 -->
      <button class="card !p-4 text-left w-full" @click="showComposer = true">
        <div class="text-sm text-slate-400">在「{{ chapterName }}」发起讨论或求助…</div>
      </button>

      <!-- 讨论帖流：首屏失败提供重试（与广场推荐错误块口径一致） -->
      <div v-if="feedError" class="card flex items-center gap-2 text-xs text-correction dark:text-correction">
        <TriangleAlert :size="14" aria-hidden="true" class="shrink-0" />
        <span class="flex-1">{{ feedError }}</span>
        <button class="btn-ghost !text-xs shrink-0" @click="loadFeed(true)">
          <RefreshCw :size="14" aria-hidden="true" />
          重试
        </button>
      </div>
      <template v-else>
        <EmptyState
          v-if="!posts.length && !feedLoading"
          class="card"
          title="还没有讨论。可以贴出题目和你的解题步骤，一起找出卡住的地方。"
        />
        <PostCard
          v-for="p in posts"
          :key="p.id"
          :post="p"
          @like="likePost(p.id)"
          @dislike="dislikePost(p.id)"
          @open="router.push(`/community/post/${p.id}`)"
          @profile="openProfile(p.userId)"
          @report="openReport(p.id)"
        />
        <div v-if="feedCursor" class="text-center">
          <button class="btn-ghost !text-xs" :disabled="feedLoading" @click="loadFeed()">
            {{ feedLoading ? '加载中…' : '加载更多' }}
          </button>
        </div>
      </template>

      <PostComposer v-model:show="showComposer" type="share" :topic-ref="topicRef" @posted="onPosted" />
      <UserProfileModal v-model:show="showProfile" :user-id="profileUserId" />
      <ReportDialog v-model:show="showReport" target-type="post" :target-id="reportPostId" />
    </template>
  </div>
</template>
