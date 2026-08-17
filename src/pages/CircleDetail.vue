<script setup lang="ts">
import { computed, inject, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { communityApi } from '../api/community'
import PostCard from '../components/community/PostCard.vue'
import PostComposer from '../components/community/PostComposer.vue'
import UserAvatar from '../components/community/UserAvatar.vue'
import UserProfileModal from '../components/community/UserProfileModal.vue'
import ReportDialog from '../components/community/ReportDialog.vue'
import type { CircleDetail, CommunityPost } from '../types'

/**
 * 圈子详情：信息头 + 成员列表 + 圈内帖子流（局部管理，不进广场 store）。
 * 审核圈非成员的帖子流由服务端 403 拦截。
 */
const route = useRoute()
const router = useRouter()
const toast = inject<(m: string) => void>('toast', () => {})
const circleId = route.params.id as string

const detail = ref<CircleDetail | null>(null)
const posts = ref<CommunityPost[]>([])
const feedCursor = ref<string | null>(null)
const loading = ref(true)
const feedLoading = ref(false)
const feedError = ref('')

const circle = computed(() => detail.value?.circle ?? null)
const isActiveMember = computed(() => circle.value?.myStatus === 'owner' || circle.value?.myStatus === 'member')

onMounted(async () => {
  try {
    detail.value = await communityApi.circleDetail(circleId)
  } catch (e: any) {
    toast(e?.message || '圈子不存在')
    router.replace('/community/circles')
    return
  } finally {
    loading.value = false
  }
  await loadFeed(true)
})

async function loadFeed(reset = false) {
  if (feedLoading.value) return
  feedLoading.value = true
  feedError.value = ''
  try {
    const res = await communityApi.feed({ circle: circleId, cursor: reset ? null : feedCursor.value })
    posts.value = reset ? res.posts : [...posts.value, ...res.posts]
    feedCursor.value = res.nextCursor
  } catch (e: any) {
    feedError.value = e?.message || '加载失败'
  } finally {
    feedLoading.value = false
  }
}

// ---- 加入/退圈/取消申请 ----
const joinSubmitting = ref(false)
async function toggleJoin() {
  if (!circle.value || joinSubmitting.value) return
  joinSubmitting.value = true
  try {
    const res = await communityApi.joinCircle(circleId)
    const c = circle.value
    if (res.status === 'active') { c.myStatus = 'member'; c.memberCount++; toast('已加入圈子 🎉') }
    else if (res.status === 'pending') { c.myStatus = 'pending'; toast('已提交申请，等待圈主审批') }
    else {
      if (c.myStatus === 'member') c.memberCount = Math.max(0, c.memberCount - 1)
      c.myStatus = null
      toast('已退出/取消')
      if (!c.isPublic) posts.value = [] // 审核圈退出后不可再看内容
    }
    // 成员列表刷新
    detail.value = await communityApi.circleDetail(circleId)
  } catch (e: any) { toast(e?.message || '操作失败') }
  finally { joinSubmitting.value = false }
}

// ---- 圈主审批/移除 ----
async function approve(userId: string) {
  try {
    await communityApi.approveCircleMember(circleId, userId)
    detail.value = await communityApi.circleDetail(circleId)
    toast('已通过')
  } catch (e: any) { toast(e?.message || '操作失败') }
}

async function removeMember(userId: string, name: string) {
  if (!window.confirm(`确认将 ${name} 移出圈子？`)) return
  try {
    await communityApi.removeCircleMember(circleId, userId)
    detail.value = await communityApi.circleDetail(circleId)
    toast('已移除')
  } catch (e: any) { toast(e?.message || '操作失败') }
}

// ---- 圈内发帖 ----
const showComposer = ref(false)
function onPosted() {
  loadFeed(true)
}

// ---- 帖子互动（局部状态） ----
async function likePost(id: string) {
  const p = posts.value.find(x => x.id === id)
  if (!p) return
  try {
    if (p.likedByMe) {
      await communityApi.unlike('post', id)
      p.likedByMe = false; p.likesCount--
    } else {
      await communityApi.like('post', id)
      p.likedByMe = true; p.likesCount++
    }
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
    <div v-if="loading" class="text-center text-xs text-slate-400 py-10">加载中…</div>

    <template v-else-if="circle">
      <button class="btn-ghost !px-2" @click="router.push('/community/circles')">← 圈子列表</button>

      <!-- 圈子信息头 -->
      <div class="card space-y-3">
        <div class="flex items-center gap-2 flex-wrap">
          <h2 class="text-lg font-bold flex-1 min-w-0 truncate">{{ circle.name }}</h2>
          <span class="text-[10px] px-1.5 py-0.5 rounded-full shrink-0"
            :class="circle.isPublic ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400' : 'bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400'">
            {{ circle.isPublic ? '公开圈' : '审核圈' }}
          </span>
        </div>
        <p v-if="circle.description" class="text-sm text-slate-500 dark:text-slate-400 whitespace-pre-wrap">{{ circle.description }}</p>
        <div class="flex items-center gap-3">
          <span class="text-xs text-slate-400">👥 {{ circle.memberCount }} 位成员</span>
          <div class="flex-1"></div>
          <button v-if="circle.myStatus !== 'owner'" class="btn-primary !text-xs"
            :class="{ '!bg-slate-200 dark:!bg-slate-700 !text-slate-500 dark:!text-slate-300': !!circle.myStatus }"
            :disabled="joinSubmitting" @click="toggleJoin">
            {{ circle.myStatus === 'member' ? '退出圈子' : circle.myStatus === 'pending' ? '取消申请' : circle.isPublic ? '加入圈子' : '申请加入' }}
          </button>
        </div>
      </div>

      <!-- 圈主：待审批申请 -->
      <div v-if="circle.myStatus === 'owner' && detail?.pending.length" class="card space-y-2">
        <div class="label !mb-1">待审批申请（{{ detail.pending.length }}）</div>
        <div v-for="p in detail.pending" :key="p.userId" class="flex items-center gap-2">
          <UserAvatar :name="p.userName" size="sm" />
          <span class="text-sm flex-1 truncate">{{ p.userName }}</span>
          <button class="btn-ghost !text-xs !text-emerald-500" @click="approve(p.userId)">通过</button>
          <button class="btn-ghost !text-xs !text-red-500" @click="removeMember(p.userId, p.userName)">拒绝</button>
        </div>
      </div>

      <!-- 成员列表 -->
      <div v-if="detail?.members.length" class="card">
        <div class="label !mb-2">成员（{{ detail.members.length }}）</div>
        <div class="flex flex-wrap gap-3">
          <div v-for="m in detail.members" :key="m.userId" class="flex items-center gap-1.5 cursor-pointer group"
            @click="openProfile(m.userId)">
            <UserAvatar :name="m.userName" size="sm" />
            <span class="text-xs group-hover:text-primary-500">{{ m.userName }}</span>
            <span v-if="m.role === 'owner'" class="text-[10px] text-amber-500">圈主</span>
            <button v-if="circle.myStatus === 'owner' && m.role !== 'owner'"
              class="text-[10px] text-slate-300 hover:text-red-500" @click.stop="removeMember(m.userId, m.userName)">✕</button>
          </div>
        </div>
      </div>

      <!-- 圈内发帖入口 -->
      <button v-if="isActiveMember" class="card !p-4 text-left w-full" @click="showComposer = true">
        <div class="text-sm text-slate-400">在「{{ circle.name }}」分享你的想法…</div>
      </button>

      <!-- 圈内帖子流 -->
      <div v-if="feedError" class="card text-center text-sm text-slate-400 py-8">{{ feedError }}</div>
      <template v-else>
        <div v-if="!posts.length && !feedLoading" class="card text-center text-sm text-slate-400 py-8">
          {{ isActiveMember ? '圈内还没有帖子，来发第一帖吧～' : '加入圈子后查看圈内讨论' }}
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

      <PostComposer v-model:show="showComposer" type="share" :circle-id="circleId" @posted="onPosted" />
      <UserProfileModal v-model:show="showProfile" :user-id="profileUserId" />
      <ReportDialog v-model:show="showReport" target-type="post" :target-id="reportPostId" />
    </template>
  </div>
</template>
