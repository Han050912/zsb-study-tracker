<script setup lang="ts">
import { computed, inject, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useCommunityStore } from '../stores/community'
import { communityApi } from '../api/community'
import { sessionUser, isAdmin, requireLogin } from '../services/auth'
import type { CommunityComment, CommunityPost } from '../types'
import PostCard from '../components/community/PostCard.vue'
import CommentItem from '../components/community/CommentItem.vue'
import CommentInput from '../components/community/CommentInput.vue'
import Lightbox from '../components/community/Lightbox.vue'
import ReportDialog from '../components/community/ReportDialog.vue'
import UserProfileModal from '../components/community/UserProfileModal.vue'

const route = useRoute()
const router = useRouter()
const store = useCommunityStore()
const toast = inject<(m: string) => void>('toast', () => {})

const postId = route.params.id as string
const post = ref<CommunityPost | null>(null)
const comments = ref<CommunityComment[]>([])
const loading = ref(true)
const notFound = ref(false)

onMounted(async () => {
  try {
    const d = await communityApi.post(postId)
    post.value = d.post
    comments.value = d.comments
  } catch {
    notFound.value = true
  } finally {
    loading.value = false
  }
})

const isMine = computed(() => post.value?.userId === sessionUser.value?.id)
const canDeletePost = computed(() => isMine.value || isAdmin.value)

/** 一级评论 + 二级回复树（回复的 parentId 始终指向一级评论）；被采纳的最佳答案置顶展示 */
const commentTree = computed(() => {
  const roots = comments.value.filter(c => !c.parentId)
  const byParent = new Map<string, CommunityComment[]>()
  for (const c of comments.value) {
    if (!c.parentId) continue
    const list = byParent.get(c.parentId) || []
    list.push(c)
    byParent.set(c.parentId, list)
  }
  roots.sort((a, b) => Number(b.isAccepted) - Number(a.isAccepted))
  return roots.map(r => ({ ...r, replies: byParent.get(r.id) || [] }))
})

function findComment(id: string): CommunityComment | undefined {
  return comments.value.find(c => c.id === id)
}

// ---- 点赞 ----
async function likePost() {
  if (requireLogin(router)) return
  if (!post.value) return
  const liked = await store.likePost(postId).catch((e: any) => { toast(e?.message || '操作失败'); return null })
  if (liked === null) return
  post.value.likedByMe = liked
  post.value.likesCount = Math.max(0, post.value.likesCount + (liked ? 1 : -1))
}

async function likeComment(c: CommunityComment) {
  if (requireLogin(router)) return
  const liked = await store.likeComment(c.id).catch((e: any) => { toast(e?.message || '操作失败'); return null })
  if (liked === null) return
  // 一级评论在 commentTree 中被展开为副本（携带 replies），必须更新原始数组中的对象
  const target = findComment(c.id)
  if (target) {
    target.likedByMe = liked
    target.likesCount = Math.max(0, target.likesCount + (liked ? 1 : -1))
  }
}

// ---- 踩 ----
async function dislikePost() {
  if (requireLogin(router)) return
  if (!post.value) return
  const res = await store.dislikePost(postId).catch((e: any) => { toast(e?.message || '操作失败'); return null })
  if (res === null) return
  post.value.dislikedByMe = res.disliked
  post.value.dislikesCount = Math.max(0, post.value.dislikesCount + (res.disliked ? 1 : -1))
  if (res.likeRevoked) {
    post.value.likedByMe = false
    post.value.likesCount = Math.max(0, post.value.likesCount - 1)
  }
}

async function dislikeComment(c: CommunityComment) {
  if (requireLogin(router)) return
  const res = await store.dislikeComment(c.id).catch((e: any) => { toast(e?.message || '操作失败'); return null })
  if (res === null) return
  const target = findComment(c.id)
  if (target) {
    target.dislikedByMe = res.disliked
    target.dislikesCount = Math.max(0, target.dislikesCount + (res.disliked ? 1 : -1))
    if (res.likeRevoked) {
      target.likedByMe = false
      target.likesCount = Math.max(0, target.likesCount - 1)
    }
  }
}

// ---- 评论 / 回复 ----
const replyTarget = ref<CommunityComment | null>(null)
const presetText = ref('')

function reply(c: CommunityComment) {
  if (requireLogin(router)) return
  // 回复二级评论时，parentId 仍指向其一级评论（最多二级）
  replyTarget.value = c.parentId ? (findComment(c.parentId) || c) : c
  presetText.value = ''
  requestAnimationFrame(() => { presetText.value = `@${c.userName} ` })
}

async function send(text: string, imageUrls: string[]) {
  if (requireLogin(router)) return
  try {
    const c = await store.postComment(postId, text, replyTarget.value?.id, imageUrls)
    comments.value.push(c)
    // store.postComment 已同步广场列表内的计数，此处仅当本帖不在列表时手动 +1，避免重复计数
    if (post.value && !store.posts.some(p => p.id === postId)) post.value.commentsCount++
    replyTarget.value = null
  } catch (e: any) {
    toast(e?.message || '评论失败')
  }
}

async function removeComment(c: CommunityComment) {
  if (!window.confirm('确认删除这条评论？')) return
  const removed = 1 + (c.replies?.length ?? 0)
  try {
    await store.removeComment(c.id, postId, removed)
    // 本地移除该评论及其回复
    const ids = new Set([c.id, ...(c.replies?.map(r => r.id) ?? [])])
    comments.value = comments.value.filter(x => !ids.has(x.id) && x.parentId !== c.id)
    // 同上：仅当本帖不在广场列表时手动回退，避免与 store 重复扣减
    if (post.value && !store.posts.some(p => p.id === postId)) {
      post.value.commentsCount = Math.max(0, post.value.commentsCount - removed)
    }
    // 删除的若为最佳答案：服务端级联已解除采纳并回退为待解答，本地同步（含广场列表副本）
    if (c.isAccepted && post.value) {
      post.value.acceptedAnswerId = undefined
      post.value.isResolved = false
      const p = store.posts.find(x => x.id === postId)
      if (p) { p.acceptedAnswerId = undefined; p.isResolved = false }
    }
  } catch (e: any) {
    toast(e?.message || '删除失败')
  }
}

// ---- 删帖 ----
async function removePost() {
  if (!window.confirm('确认删除这篇帖子？评论和点赞将一并删除。')) return
  try {
    await store.removePost(postId)
    toast('帖子已删除')
    router.replace('/community')
  } catch (e: any) {
    toast(e?.message || '删除失败')
  }
}

// ---- 图片灯箱 ----
const showLightbox = ref(false)
const lightboxIndex = ref(0)
function openLightbox(i: number) {
  lightboxIndex.value = i
  showLightbox.value = true
}

// ---- 举报 ----
const showReport = ref(false)
const reportTarget = ref<{ type: 'post' | 'comment'; id: string }>({ type: 'post', id: '' })
function openReport(type: 'post' | 'comment', id: string) {
  if (requireLogin(router)) return
  reportTarget.value = { type, id }
  showReport.value = true
}

// ---- 提问帖标记解决 ----
async function toggleResolve() {
  if (requireLogin(router)) return
  if (!post.value) return
  try {
    const { isResolved } = await communityApi.resolvePost(postId)
    post.value.isResolved = isResolved
    const p = store.posts.find(x => x.id === postId)
    if (p) p.isResolved = isResolved
    toast(isResolved ? '已标记为已解答 🎉' : '已重新开放为待解答')
  } catch (e: any) { toast(e?.message || '操作失败') }
}

// ---- 最佳答案采纳（仅提问帖楼主；仅一级评论；不能采纳自己的评论） ----
const canAccept = computed(() =>
  !!post.value && post.value.type === 'question' && isMine.value && !post.value.isHidden
)

function acceptVisible(c: CommunityComment) {
  return canAccept.value && !c.parentId && !c.isHidden && c.userId !== sessionUser.value?.id
}

const accepting = ref(false) // 采纳请求在途标记：防止双击并发采纳导致积分重复发放

async function accept(c: CommunityComment) {
  if (requireLogin(router)) return
  if (!post.value || accepting.value) return
  const current = post.value.acceptedAnswerId
  if (current === c.id) {
    if (!window.confirm('取消采纳这条最佳答案？双方将扣除相应积分。')) return
  } else if (current) {
    if (!window.confirm('改采纳这条评论？原最佳答案的采纳将被撤销。')) return
  } else {
    if (!window.confirm(`采纳 @${c.userName} 的回答为最佳答案？对方 +10 积分，你 +3 积分。`)) return
  }
  accepting.value = true
  try {
    const res = await store.acceptAnswer(postId, c.id)
    post.value.acceptedAnswerId = res.acceptedAnswerId ?? undefined
    post.value.isResolved = res.isResolved
    // 同步评论标记：旧采纳清除，新采纳置位（commentTree 为展开副本，必须改原始数组）
    for (const x of comments.value) x.isAccepted = x.id === res.acceptedAnswerId
    toast(res.acceptedAnswerId ? '已采纳最佳答案 🎉' : '已取消采纳，帖子重新开放为待解答')
  } catch (e: any) { toast(e?.message || '操作失败') }
  finally { accepting.value = false }
}

// ---- 评论图片灯箱 ----
const showCommentLightbox = ref(false)
const commentLightboxIndex = ref(0)
const commentLightboxUrls = ref<string[]>([])
function openCommentLightbox(c: CommunityComment, i: number) {
  commentLightboxUrls.value = c.imageUrls
  commentLightboxIndex.value = i
  showCommentLightbox.value = true
}

// ---- 用户资料卡 ----
const showProfile = ref(false)
const profileUserId = ref('')
function openProfile(userId: string) {
  // 资料卡后端公开（auth:false）；访客可见性由弹窗内 401 引导处理
  profileUserId.value = userId
  showProfile.value = true
}

// ---- 管理员操作 ----
async function togglePin() {
  if (!post.value) return
  try {
    const pinned = await store.adminPinPost(postId)
    post.value.isPinned = pinned
    toast(pinned ? '已置顶' : '已取消置顶')
  } catch (e: any) { toast(e?.message || '操作失败') }
}

async function toggleFeature() {
  if (!post.value) return
  try {
    const featured = await store.adminFeaturePost(postId)
    post.value.isFeatured = featured
    toast(featured ? '已加精 🌟' : '已取消加精')
  } catch (e: any) { toast(e?.message || '操作失败') }
}

async function toggleHidePost() {
  if (!post.value) return
  try {
    const hidden = await store.adminHidePost(postId)
    post.value.isHidden = hidden
    toast(hidden ? '已隐藏' : '已取消隐藏')
  } catch (e: any) { toast(e?.message || '操作失败') }
}

async function toggleHideComment(c: CommunityComment) {
  try {
    const hidden = await store.adminHideComment(c.id)
    const target = findComment(c.id)
    if (target) target.isHidden = hidden
    toast(hidden ? '评论已隐藏' : '评论已恢复')
  } catch (e: any) { toast(e?.message || '操作失败') }
}
</script>

<template>
  <div class="p-4 md:p-6 max-w-2xl mx-auto space-y-4">
    <div class="flex items-center gap-2">
      <button class="btn-ghost !px-2.5" @click="router.back()">←</button>
      <h1 class="page-title">帖子详情</h1>
    </div>

    <div v-if="loading" class="text-center text-xs text-slate-400 py-10">加载中…</div>
    <div v-else-if="notFound" class="card text-center py-10 text-slate-400 text-sm">
      <div class="text-3xl mb-2">🫥</div>
      <p>帖子不存在或已被删除</p>
    </div>

    <template v-else-if="post">
      <PostCard :post="post" detail @like="likePost" @dislike="dislikePost" @pin="togglePin" @feature="toggleFeature" @hide="toggleHidePost"
        @image="openLightbox" @report="openReport('post', post.id)" @profile="openProfile(post.userId)">
        <template #actions>
          <!-- 已采纳最佳答案时禁用手动标记（需先取消采纳），避免出现矛盾态 -->
          <button v-if="isMine && post.type === 'question' && !post.acceptedAnswerId" class="text-xs text-slate-400 hover:text-emerald-500"
            @click.stop="toggleResolve">{{ post.isResolved ? '取消已解答' : '标记已解答' }}</button>
          <button v-if="canDeletePost" class="text-xs text-slate-400 hover:text-red-500" @click.stop="removePost">删除</button>
        </template>
      </PostCard>

      <!-- 评论区 -->
      <div class="card space-y-4">
        <div class="section-title !mb-0">💬 评论 {{ post.commentsCount || '' }}</div>
        <CommentInput :preset-text="presetText"
          :placeholder="replyTarget ? `回复 @${replyTarget.userName}…` : '写下你的评论…（支持 emoji）'"
          @send="send" />
        <div v-if="replyTarget" class="text-xs text-slate-400">
          正在回复 @{{ replyTarget.userName }}
          <button class="text-primary-500 ml-1" @click="replyTarget = null">取消回复</button>
        </div>

        <div v-if="!commentTree.length" class="text-center text-xs text-slate-400 py-4">暂无评论，来抢沙发～</div>
        <div v-for="c in commentTree" :key="c.id" class="space-y-3">
          <CommentItem :comment="c" :show-accept="acceptVisible(c)" @like="likeComment(c)" @dislike="dislikeComment(c)" @reply="reply(c)" @remove="removeComment(c)"
            @hide="toggleHideComment(c)" @report="openReport('comment', c.id)" @accept="accept(c)" @image="openCommentLightbox(c, $event)"
            @profile="openProfile(c.userId)" />
          <!-- 二级回复 -->
          <div v-if="c.replies?.length" class="ml-11 space-y-3 border-l-2 border-slate-100 dark:border-slate-700 pl-3">
            <CommentItem v-for="r in c.replies" :key="r.id" :comment="r"
              @like="likeComment(r)" @dislike="dislikeComment(r)" @reply="reply(r)" @remove="removeComment(r)" @hide="toggleHideComment(r)"
              @report="openReport('comment', r.id)" @image="openCommentLightbox(r, $event)" @profile="openProfile(r.userId)" />
          </div>
        </div>
      </div>

      <Lightbox v-model:show="showLightbox" v-model:index="lightboxIndex" :urls="post.imageUrls" />
      <Lightbox v-model:show="showCommentLightbox" v-model:index="commentLightboxIndex" :urls="commentLightboxUrls" />
      <ReportDialog v-model:show="showReport" :target-type="reportTarget.type" :target-id="reportTarget.id" />
      <UserProfileModal v-model:show="showProfile" :user-id="profileUserId" />
    </template>
  </div>
</template>
