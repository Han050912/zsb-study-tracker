<script setup lang="ts">
import { computed, inject, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useCommunityStore } from '../stores/community'
import { communityApi } from '../api/community'
import { sessionUser, isAdmin } from '../services/auth'
import type { CommunityComment, CommunityPost } from '../types'
import PostCard from '../components/community/PostCard.vue'
import CommentItem from '../components/community/CommentItem.vue'
import CommentInput from '../components/community/CommentInput.vue'
import Lightbox from '../components/community/Lightbox.vue'
import ReportDialog from '../components/community/ReportDialog.vue'

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

/** 一级评论 + 二级回复树（回复的 parentId 始终指向一级评论） */
const commentTree = computed(() => {
  const roots = comments.value.filter(c => !c.parentId)
  const byParent = new Map<string, CommunityComment[]>()
  for (const c of comments.value) {
    if (!c.parentId) continue
    const list = byParent.get(c.parentId) || []
    list.push(c)
    byParent.set(c.parentId, list)
  }
  return roots.map(r => ({ ...r, replies: byParent.get(r.id) || [] }))
})

function findComment(id: string): CommunityComment | undefined {
  return comments.value.find(c => c.id === id)
}

// ---- 点赞 ----
async function likePost() {
  if (!post.value) return
  const liked = await store.likePost(postId).catch((e: any) => { toast(e?.message || '操作失败'); return null })
  if (liked === null) return
  post.value.likedByMe = liked
  post.value.likesCount = Math.max(0, post.value.likesCount + (liked ? 1 : -1))
}

async function likeComment(c: CommunityComment) {
  const liked = await store.likeComment(c.id).catch((e: any) => { toast(e?.message || '操作失败'); return null })
  if (liked === null) return
  // 一级评论在 commentTree 中被展开为副本（携带 replies），必须更新原始数组中的对象
  const target = findComment(c.id)
  if (target) {
    target.likedByMe = liked
    target.likesCount = Math.max(0, target.likesCount + (liked ? 1 : -1))
  }
}

// ---- 评论 / 回复 ----
const replyTarget = ref<CommunityComment | null>(null)
const presetText = ref('')

function reply(c: CommunityComment) {
  // 回复二级评论时，parentId 仍指向其一级评论（最多二级）
  replyTarget.value = c.parentId ? (findComment(c.parentId) || c) : c
  presetText.value = ''
  requestAnimationFrame(() => { presetText.value = `@${c.userName} ` })
}

async function send(text: string) {
  try {
    const c = await store.postComment(postId, text, replyTarget.value?.id)
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
  reportTarget.value = { type, id }
  showReport.value = true
}

// ---- 提问帖标记解决 ----
async function toggleResolve() {
  if (!post.value) return
  try {
    const { isResolved } = await communityApi.resolvePost(postId)
    post.value.isResolved = isResolved
    const p = store.posts.find(x => x.id === postId)
    if (p) p.isResolved = isResolved
    toast(isResolved ? '已标记为已解答 🎉' : '已重新开放为待解答')
  } catch (e: any) { toast(e?.message || '操作失败') }
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
      <PostCard :post="post" detail @like="likePost" @pin="togglePin" @hide="toggleHidePost"
        @image="openLightbox" @report="openReport('post', post.id)">
        <template #actions>
          <button v-if="isMine && post.type === 'question'" class="text-xs text-slate-400 hover:text-emerald-500"
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
          <CommentItem :comment="c" @like="likeComment(c)" @reply="reply(c)" @remove="removeComment(c)"
            @hide="toggleHideComment(c)" @report="openReport('comment', c.id)" />
          <!-- 二级回复 -->
          <div v-if="c.replies?.length" class="ml-11 space-y-3 border-l-2 border-slate-100 dark:border-slate-700 pl-3">
            <CommentItem v-for="r in c.replies" :key="r.id" :comment="r"
              @like="likeComment(r)" @reply="reply(r)" @remove="removeComment(r)" @hide="toggleHideComment(r)"
              @report="openReport('comment', r.id)" />
          </div>
        </div>
      </div>

      <Lightbox v-model:show="showLightbox" v-model:index="lightboxIndex" :urls="post.imageUrls" />
      <ReportDialog v-model:show="showReport" :target-type="reportTarget.type" :target-id="reportTarget.id" />
    </template>
  </div>
</template>
