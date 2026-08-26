<script setup lang="ts">
import { computed, inject, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { communityApi } from '../api/community'
import { useAppStore } from '../stores/app'
import PostCard from '../components/community/PostCard.vue'
import PostComposer from '../components/community/PostComposer.vue'
import UserProfileModal from '../components/community/UserProfileModal.vue'
import ReportDialog from '../components/community/ReportDialog.vue'
import { useBack } from '../composables/useBack'
import { subjectLabel } from '../utils/subject'
import type { CommunityPost } from '../types'

/**
 * 知识点讨论区（P2-6）：以「科目 + 章节」为讨论单元的帖子流。
 * 讨论帖经 topicRef（'subjectId|chapterName'）标记归属，不进公共广场；
 * 复用 communityApi.feed(topicSubject, topicChapter) 拉取。
 */
const route = useRoute()
const router = useRouter()
const { goBack } = useBack()
const toast = inject<(m: string) => void>('toast', () => {})
const appStore = useAppStore()

const subjectId = route.params.subjectId as string
const chapterName = (route.query.chapter as string) || ''
const topicRef = `${subjectId}|${chapterName}`

const subject = computed(() => appStore.subjectMap[subjectId])

const posts = ref<CommunityPost[]>([])
const feedCursor = ref<string | null>(null)
const loading = ref(true)
const feedLoading = ref(false)
const feedError = ref('')

onMounted(() => {
  if (!chapterName) {
    toast('章节参数缺失')
    router.replace('/community')
    return
  }
  loadFeed(true).finally(() => { loading.value = false })
})

async function loadFeed(reset = false) {
  if (feedLoading.value) return
  feedLoading.value = true
  feedError.value = ''
  try {
    const res = await communityApi.feed({
      topicSubject: subjectId,
      topicChapter: chapterName,
      cursor: reset ? null : feedCursor.value
    })
    posts.value = reset ? res.posts : [...posts.value, ...res.posts]
    feedCursor.value = res.nextCursor
  } catch (e: any) {
    // 首屏失败展示错误态；追加失败仅提示，保留已加载内容
    if (reset) feedError.value = e?.message || '加载失败'
    else toast(e?.message || '加载失败')
  } finally {
    feedLoading.value = false
  }
}

// ---- 发帖 ----
const showComposer = ref(false)
function onPosted() {
  loadFeed(true)
}

// ---- 帖子互动（局部状态） ----
async function likePost(id: string) {
  const p = posts.value.find(x => x.id === id)
  if (!p) return
  try {
    const { liked } = await communityApi.toggleLike('post', id)
    p.likedByMe = liked
    p.likesCount = Math.max(0, p.likesCount + (liked ? 1 : -1))
  } catch (e: any) { toast(e?.message || '操作失败') }
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
  <div class="max-w-3xl mx-auto space-y-4">
    <div class="flex items-center gap-2">
      <button class="btn-ghost !px-2" @click="goBack">← 返回</button>
      <h2 class="text-lg font-bold flex-1 min-w-0 truncate">
        {{ subjectLabel(subject, subjectId) }} · {{ chapterName }}
      </h2>
    </div>
    <p class="text-xs text-slate-400 -mt-2">本章节疑难讨论（仅本讨论区可见，不进公共广场）</p>

    <div v-if="loading" class="text-center text-xs text-slate-400 py-10">加载中…</div>

    <template v-else>
      <!-- 发帖入口 -->
      <button class="card !p-4 text-left w-full" @click="showComposer = true">
        <div class="text-sm text-slate-400">在「{{ chapterName }}」发起讨论或求助…</div>
      </button>

      <!-- 讨论帖流 -->
      <div v-if="feedError" class="card text-center text-sm text-slate-400 py-8">{{ feedError }}</div>
      <template v-else>
        <div v-if="!posts.length && !feedLoading" class="card text-center text-sm text-slate-400 py-8">
          还没有讨论，来发第一帖吧～
        </div>
        <PostCard v-for="p in posts" :key="p.id" :post="p"
          @like="likePost(p.id)"
          @open="router.push(`/community/post/${p.id}`)"
          @profile="openProfile(p.userId)"
          @report="openReport(p.id)" />
        <div v-if="feedCursor" class="text-center">
          <button class="btn-ghost !text-xs" :disabled="feedLoading" @click="loadFeed()">{{ feedLoading ? '加载中…' : '加载更多' }}</button>
        </div>
      </template>

      <PostComposer v-model:show="showComposer" type="share" :topic-ref="topicRef" @posted="onPosted" />
      <UserProfileModal v-model:show="showProfile" :user-id="profileUserId" />
      <ReportDialog v-model:show="showReport" target-type="post" :target-id="reportPostId" />
    </template>
  </div>
</template>
