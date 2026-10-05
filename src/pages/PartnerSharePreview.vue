<script setup lang="ts">
import { ArrowLeft } from '@lucide/vue'
import IconAction from '../shared/components/IconAction.vue'
import EmptyState from '../shared/components/EmptyState.vue'
import LoadingState from '../shared/components/LoadingState.vue'
import AsyncState from '../shared/components/AsyncState.vue'
/** 搭子分享全屏预览：通知中心与搭子分享页统一入口；完整展示错题/笔记（含图片）+ 批注交流 + 添加到我的笔记 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { getErrorMessage } from '../utils/error'
import { useToast } from '../composables/useToast'
import { useConfirm } from '../composables/useConfirm'
import { useRoute, useRouter } from 'vue-router'
import { partnersApi } from '../api/community/partners'
import { postsApi } from '../api/community/posts'
import UserAvatar from '../components/community/UserAvatar.vue'
import PdfViewer from '../components/PdfViewer.vue'
import Modal from '../components/Modal.vue'
import { useMarkdownHtml } from '../composables/useMarkdownHtml'
import { fromNow } from '../utils/date'
import { subjectLabel } from '../utils/subject'
import { useBack } from '../composables/useBack'
import { useAppStore } from '../stores/app'
import { sessionUser } from '../services/auth'
import type { PartnerShareDetail, PartnerShareNoteItem, PartnerShareErrorItem } from '../types'

const route = useRoute()
const router = useRouter()
const { goBack } = useBack()
const toast = useToast()
const confirm = useConfirm()
const store = useAppStore()

const loading = ref(true)
const detail = ref<PartnerShareDetail | null>(null)
/** 详情加载失败原因（非 404）：避免无 detail 时页面空白，给出可读状态而非仅一次性 toast */
const loadError = ref('')
const pdfBytes = ref<Uint8Array | null>(null)
const pdfError = ref('')
const pdfLoading = ref(false)

/** 分享错题配图（代理读取的 blob URL；非错题分享或加载失败时为空） */
const errorImageUrl = ref('')
const imageError = ref('')
const imageLoading = ref(false)
let disposed = false,
  loadTicket = 0

const commentText = ref('')
const sendingComment = ref(false)

// 添加到我的笔记
const copyDialog = ref(false)
const copySubjectId = ref('')
const copying = ref(false)

const noteView = computed(() => {
  const d = detail.value
  if (!d || d.itemType !== 'note') return null
  const it = d.item as PartnerShareNoteItem
  return { title: it.title ?? '', content: it.content ?? '', type: it.type, subjectId: it.subjectId ?? '' }
})

const errorView = computed(() => {
  const d = detail.value
  if (!d || d.itemType !== 'error') return null
  const it = d.item as PartnerShareErrorItem
  return {
    question: it.question ?? '',
    answer: it.answer ?? '',
    image: it.image ?? '',
    wrongCount: it.wrong_count ?? 0
  }
})

const isOwner = computed(() => !!detail.value && detail.value.ownerId === sessionUser.value?.id)
const canCopy = computed(() => !!detail.value && detail.value.partnerId === sessionUser.value?.id)

/**
 * 笔记正文 HTML（两阶段渲染）：同步渲染立即可见（无公式即最终态）；
 * 含公式时异步加载 KaTeX chunk 后原地升级（同一 v-html 容器，无布局跳动）。
 */
const noteHtml = useMarkdownHtml(() => noteView.value?.content ?? '')

onMounted(load)

onUnmounted(() => {
  disposed = true
  loadTicket++
  if (errorImageUrl.value) URL.revokeObjectURL(errorImageUrl.value)
})

async function load() {
  const ticket = ++loadTicket
  loading.value = true
  loadError.value = ''
  pdfBytes.value = null
  pdfLoading.value = false
  pdfError.value = ''
  imageError.value = ''
  imageLoading.value = false
  if (errorImageUrl.value) URL.revokeObjectURL(errorImageUrl.value)
  errorImageUrl.value = ''
  detail.value = null
  const id = String(route.params.id)
  try {
    const result = await partnersApi.partnerShare(id)
    if (disposed || ticket !== loadTicket) return
    detail.value = result
    if (errorView.value?.image) void loadImage()
    if (noteView.value?.type === 'pdf') void loadPdf()
  } catch (e) {
    if (disposed || ticket !== loadTicket) return
    // 分享已删除：兜底提示并回搭子列表
    if ((e as { status?: number } | null)?.status === 404) {
      toast('内容已不存在')
      router.replace('/community/partners')
      return
    }
    loadError.value = getErrorMessage(e, '加载失败')
    toast(loadError.value)
  } finally {
    if (ticket === loadTicket && !disposed) loading.value = false
  }
}

async function loadImage() {
  if (!detail.value || imageLoading.value) return
  const id = detail.value.id,
    ticket = loadTicket
  imageLoading.value = true
  imageError.value = ''
  try {
    const blob = await partnersApi.partnerShareImage(id)
    if (disposed || ticket !== loadTicket) return
    if (errorImageUrl.value) URL.revokeObjectURL(errorImageUrl.value)
    errorImageUrl.value = URL.createObjectURL(blob)
  } catch (e) {
    if (!disposed && ticket === loadTicket) imageError.value = getErrorMessage(e, '错题图片加载失败，请重试')
  } finally {
    if (ticket === loadTicket) imageLoading.value = false
  }
}

async function loadPdf() {
  if (!detail.value || pdfLoading.value) return
  const id = detail.value.id,
    ticket = loadTicket
  pdfLoading.value = true
  pdfError.value = ''
  try {
    const bytes = await partnersApi.partnerSharePdf(id)
    if (!disposed && ticket === loadTicket) pdfBytes.value = bytes
  } catch (e) {
    if (!disposed && ticket === loadTicket) pdfError.value = getErrorMessage(e, 'PDF 加载失败，请重试')
  } finally {
    if (ticket === loadTicket) pdfLoading.value = false
  }
}

async function refreshDetail() {
  if (!detail.value) return
  try {
    detail.value = await partnersApi.partnerShare(detail.value.id)
  } catch (e) {
    toast(getErrorMessage(e, '刷新失败'))
  }
}

async function addComment() {
  const d = detail.value
  if (!d || sendingComment.value) return
  const content = commentText.value.trim()
  if (!content) {
    toast('请输入批注内容')
    return
  }
  sendingComment.value = true
  try {
    await postsApi.addShareComment(d.id, content)
    if (commentText.value.trim() === content) commentText.value = ''
    await refreshDetail()
  } catch (e) {
    toast(getErrorMessage(e, '发送失败'))
  } finally {
    sendingComment.value = false
  }
}

async function removeShare() {
  const d = detail.value
  if (!d) return
  if (!(await confirm('删除这条分享？其中的批注将一并删除。', { danger: true }))) return
  try {
    await postsApi.deleteShare(d.id)
    toast('已删除分享')
    goBack()
  } catch (e) {
    toast(getErrorMessage(e, '删除失败'))
  }
}

function openCopyDialog() {
  const v = noteView.value
  if (!v) return
  // 默认选中原笔记同 id 科目（若接收者存在），否则第一个科目
  const has = store.subjects.some((s) => s.id === v.subjectId)
  copySubjectId.value = has ? v.subjectId : store.subjects[0]?.id || ''
  copyDialog.value = true
}

async function confirmCopy() {
  const d = detail.value
  if (!d || copying.value) return
  if (!copySubjectId.value) {
    toast('请选择科目')
    return
  }
  copying.value = true
  try {
    const note = await partnersApi.copyPartnerShare(d.id, copySubjectId.value)
    store.importNotes(copySubjectId.value, [
      { id: note.id, title: note.title, content: note.content, tags: note.tags, type: note.type }
    ])
    copyDialog.value = false
    toast('已添加到我的笔记')
  } catch (e) {
    toast(getErrorMessage(e, '添加失败'))
  } finally {
    copying.value = false
  }
}
</script>

<template>
  <div class="collaboration-page study-page reading-page space-y-5">
    <span class="!text-xs arrow-action" @click="goBack"
      ><IconAction :icon="ArrowLeft" label="返回" @click="goBack" /> 返回</span
    >
    <h1 class="page-title">分享预览</h1>

    <LoadingState v-if="loading" />

    <AsyncState v-else-if="loadError" :error="loadError" @retry="load" />

    <div v-else-if="detail" class="card space-y-3">
      <div class="flex items-center gap-2">
        <span
          class="text-xs px-1.5 py-0.5 rounded-full"
          :class="
            detail.itemType === 'error'
              ? 'bg-correction-soft dark:bg-correction-soft text-correction'
              : 'bg-action-soft dark:bg-action-soft text-action'
          "
        >
          {{ detail.itemType === 'error' ? '错题' : '笔记' }}
        </span>
        <div class="text-xs text-slate-400 truncate">{{ detail.ownerName }} 分享给 {{ detail.partnerName }}</div>
        <button v-if="isOwner" class="ml-auto btn-danger !text-xs shrink-0" @click="removeShare">删除分享</button>
      </div>

      <!-- 错题（含图片） -->
      <div
        v-if="detail.itemType === 'error' && errorView"
        class="rounded-xl bg-slate-50 dark:bg-slate-700/50 p-3 space-y-2"
      >
        <div class="text-sm font-semibold whitespace-pre-wrap">{{ errorView.question }}</div>
        <img
          v-if="errorImageUrl"
          :src="errorImageUrl"
          class="mt-2 max-w-full h-auto rounded-lg border border-slate-100 dark:border-slate-700"
          alt="错题图片"
        />
        <AsyncState v-if="imageLoading || imageError" :loading="imageLoading" :error="imageError" @retry="loadImage" />
        <div v-if="errorView.answer" class="text-xs text-slate-500 dark:text-slate-400 whitespace-pre-wrap">
          答案：{{ errorView.answer }}
        </div>
        <div class="text-xs text-slate-400">错 {{ errorView.wrongCount }} 次</div>
      </div>

      <!-- Markdown 笔记 -->
      <div v-else-if="detail.itemType === 'note' && noteView && noteView.type !== 'pdf'" class="space-y-2">
        <div class="text-sm font-semibold">{{ noteView.title }}</div>
        <div class="md-body" v-html="noteHtml"></div>
      </div>

      <!-- PDF 笔记 -->
      <div v-else-if="detail.itemType === 'note' && noteView?.type === 'pdf'" class="h-[60vh]">
        <AsyncState v-if="pdfLoading || pdfError" :loading="pdfLoading" :error="pdfError" @retry="loadPdf" />
        <PdfViewer v-else :bytes="pdfBytes" />
      </div>

      <!-- 添加到我的笔记（仅笔记） -->
      <button
        v-if="detail.itemType === 'note' && canCopy"
        class="btn-primary !text-xs self-start"
        @click="openCopyDialog"
      >
        添加到我的笔记
      </button>

      <!-- 批注列表 -->
      <div class="space-y-2">
        <div class="text-xs font-semibold text-slate-500 dark:text-slate-300">
          批注交流（{{ detail.comments.length }}）
        </div>
        <EmptyState v-if="!detail.comments.length" title="还没有批注，来聊聊解题思路吧" />
        <div v-for="c in detail.comments" :key="c.id" class="flex items-start gap-2">
          <UserAvatar :name="c.userName" size="sm" />
          <div class="min-w-0 flex-1 rounded-lg bg-slate-50 dark:bg-slate-700/50 px-2 py-1.5">
            <div class="flex items-center gap-2">
              <span class="text-xs font-semibold">{{ c.userName }}</span>
              <span class="text-xs text-slate-400">{{ fromNow(c.createdAt) }}</span>
            </div>
            <div class="text-xs text-slate-600 dark:text-slate-300 whitespace-pre-wrap">{{ c.content }}</div>
          </div>
        </div>
      </div>

      <!-- 批注输入 -->
      <div class="flex gap-2 pt-2 border-t border-slate-100 dark:border-slate-700">
        <input
          v-model="commentText"
          class="input flex-1 !text-xs"
          aria-label="写下你的批注或解题思路…"
          placeholder="写下你的批注或解题思路…"
          maxlength="500"
          @keydown.enter="addComment"
        />
        <button class="btn-primary !text-xs shrink-0" :disabled="sendingComment" @click="addComment">
          {{ sendingComment ? '发送中…' : '发送' }}
        </button>
      </div>
    </div>

    <!-- 添加到我的笔记：二次确认 + 科目选择（必填） -->
    <Modal title="添加到我的笔记" :show="copyDialog" @close="copyDialog = false">
      <div class="space-y-3">
        <p class="text-xs text-slate-500 dark:text-slate-400">将会生成一份笔记副本保存到你的笔记列表</p>
        <label class="block text-xs text-slate-500 dark:text-slate-300" for="psp-copy-subject">归属科目（必选）</label>
        <select id="psp-copy-subject" v-model="copySubjectId" class="input !text-xs">
          <option v-for="s in store.subjects" :key="s.id" :value="s.id">{{ subjectLabel(s) }}</option>
        </select>
      </div>
      <template #footer>
        <button class="btn-ghost !text-xs" @click="copyDialog = false">取消</button>
        <button class="btn-primary !text-xs" :disabled="copying || !copySubjectId" @click="confirmCopy">
          {{ copying ? '添加中…' : '确认添加' }}
        </button>
      </template>
    </Modal>
  </div>
</template>
