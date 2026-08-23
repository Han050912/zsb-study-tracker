<script setup lang="ts">
/** 用户作品 Tab：帖子 / 点赞（仅本人）。游标分页 + 加载更多 + 空态/错误重试；点赞/踩计数口径与 community store 一致 */
import { inject, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import type { CommunityPost } from '../../types'
import { communityApi } from '../../api/community'
import PostCard from '../community/PostCard.vue'

const props = defineProps<{ userId: string; isSelf: boolean }>()
const activeTab = defineModel<'posts' | 'likes'>('activeTab', { default: 'posts' })
const router = useRouter()
const toast = inject<(m: string) => void>('toast', () => {})

const posts = ref<CommunityPost[]>([])
const cursor = ref<string | null>(null)
const loading = ref(false)
const loadError = ref(false)
const loaded = ref(false)

/** 请求令牌：每次请求自增，配合 activeTab 快照在响应返回时丢弃过期的竞态结果（机制同 community store 的 feedTicket） */
let loadTicket = 0

async function loadMore() {
  if (loading.value) return
  const ticket = ++loadTicket
  const tab = activeTab.value // 请求发起时的 tab 快照，响应返回时校验
  loading.value = true
  loadError.value = false
  try {
    const res = tab === 'posts'
      ? await communityApi.userPosts(props.userId, cursor.value)
      : await communityApi.likedPosts(cursor.value)
    if (ticket !== loadTicket || tab !== activeTab.value) return // 已有更新请求或已切 tab，丢弃本次过期结果
    posts.value.push(...res.posts)
    cursor.value = res.nextCursor
    loaded.value = true
  } catch {
    if (ticket === loadTicket && tab === activeTab.value) loadError.value = true
  } finally {
    if (ticket === loadTicket && tab === activeTab.value) loading.value = false
  }
}

function reset() {
  loadTicket++ // 使在途请求结果失效，避免切 tab 后旧数据写入新 tab
  loading.value = false // 在途请求已失效，解除加载锁让新请求可发起
  posts.value = []; cursor.value = null; loaded.value = false; loadError.value = false
  loadMore()
}
watch(activeTab, reset)
// 访客态强制回 posts tab（外部误置 likes 时兜底；immediate 覆盖初始即为访客+likes 的场景）
watch(() => props.isSelf, v => { if (!v && activeTab.value === 'likes') activeTab.value = 'posts' }, { immediate: true })
onMounted(reset)

/** 帖子点赞 toggle：计数口径同 community store likePost（赞踩互斥，点赞成功反向清踩）；先请求后改数，失败不改计数仅 toast */
async function onLike(p: CommunityPost) {
  try {
    const { liked } = await communityApi.toggleLike('post', p.id)
    p.likedByMe = liked
    p.likesCount = Math.max(0, p.likesCount + (liked ? 1 : -1))
    // 后端点赞会反向取消踩（赞踩互斥），本地同步清除踩状态
    if (liked && p.dislikedByMe) {
      p.dislikedByMe = false
      p.dislikesCount = Math.max(0, p.dislikesCount - 1)
    }
  } catch (e: any) {
    toast(e?.message || '操作失败')
  }
}

/** 帖子踩 toggle：计数口径同 community store dislikePost（likeRevoked 时同步清赞）；先请求后改数，失败不改计数仅 toast */
async function onDislike(p: CommunityPost) {
  try {
    const res = await communityApi.dislike('post', p.id)
    p.dislikedByMe = res.disliked
    p.dislikesCount = Math.max(0, p.dislikesCount + (res.disliked ? 1 : -1))
    if (res.likeRevoked) {
      p.likedByMe = false
      p.likesCount = Math.max(0, p.likesCount - 1)
    }
  } catch (e: any) {
    toast(e?.message || '操作失败')
  }
}
</script>

<template>
  <div>
    <!-- Tab 头 -->
    <div class="flex border-b border-slate-100 dark:border-slate-700">
      <button class="px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors"
        :class="activeTab === 'posts' ? 'border-primary-500 text-primary-600' : 'border-transparent text-slate-400'"
        @click="activeTab = 'posts'">帖子</button>
      <button v-if="isSelf" class="px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors"
        :class="activeTab === 'likes' ? 'border-primary-500 text-primary-600' : 'border-transparent text-slate-400'"
        @click="activeTab = 'likes'">点赞</button>
    </div>

    <!-- 帖子列表 -->
    <div v-if="posts.length" class="space-y-3 mt-3">
      <PostCard v-for="p in posts" :key="p.id" :post="p"
        @open="router.push(`/community/post/${p.id}`)"
        @profile="router.push(`/profile/${p.userId}`)"
        @like="onLike(p)" @dislike="onDislike(p)" />
    </div>

    <!-- 空态 -->
    <div v-if="loaded && !loading && !loadError && !posts.length" class="text-center text-xs text-slate-400 py-10">
      {{ activeTab === 'posts' ? '还没有发布帖子' : '还没有点赞过帖子' }}
    </div>

    <!-- 错误态 -->
    <div v-if="loadError" class="text-center text-xs text-slate-400 py-6">
      加载失败
      <button class="btn-ghost !text-xs ml-1" @click="loadMore">重试</button>
    </div>
    <!-- 加载中 -->
    <div v-else-if="loading" class="text-center text-xs text-slate-400 py-6">加载中…</div>
    <!-- 加载更多 -->
    <div v-else-if="cursor" class="text-center py-4">
      <button class="btn-ghost !text-xs" @click="loadMore">加载更多</button>
    </div>
    <!-- 到底提示（仅当 posts 非空） -->
    <div v-else-if="loaded && posts.length" class="text-center text-xs text-slate-400 py-6">没有更多了</div>
  </div>
</template>
