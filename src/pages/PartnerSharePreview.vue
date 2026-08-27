<script setup lang="ts">
/** 搭子分享全屏预览：通知中心与搭子分享页统一入口；完整展示错题/笔记（含图片）+ 批注交流 + 添加到我的笔记 */
import { computed, inject, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { communityApi } from '../api/community'
import UserAvatar from '../components/community/UserAvatar.vue'
import PdfViewer from '../components/PdfViewer.vue'
import Modal from '../components/Modal.vue'
import { renderMarkdown } from '../utils/markdown'
import { fromNow } from '../utils/date'
import { subjectLabel } from '../utils/subject'
import { useBack } from '../composables/useBack'
import { useAppStore } from '../stores/app'
import { sessionUser } from '../services/auth'
import type { PartnerShareDetail, PartnerShareNoteItem, PartnerShareErrorItem } from '../types'

const route = useRoute()
const router = useRouter()
const { goBack } = useBack()
const toast = inject<(m: string) => void>('toast', () => {})
const store = useAppStore()

const loading = ref(true)
const detail = ref<PartnerShareDetail | null>(null)
const pdfBytes = ref<Uint8Array | null>(null)
const pdfError = ref('')

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
  return { question: it.question ?? '', answer: it.answer ?? '', image: it.image ?? '', wrongCount: it.wrong_count ?? 0 }
})

const isOwner = computed(() => !!detail.value && detail.value.ownerId === sessionUser.value?.id)

onMounted(load)

async function load() {
  loading.value = true
  const id = String(route.params.id)
  try {
    detail.value = await communityApi.partnerShare(id)
    if (noteView.value?.type === 'pdf') {
      try {
        pdfBytes.value = await communityApi.partnerSharePdf(id)
      } catch (e: any) {
        pdfError.value = e?.message || 'PDF 加载失败'
      }
    }
  } catch (e: any) {
    // 分享已删除：兜底提示并回搭子列表
    if (e?.status === 404) {
      toast('内容已不存在')
      router.replace('/community/partners')
      return
    }
    toast(e?.message || '加载失败')
  } finally {
    loading.value = false
  }
}

async function refreshDetail() {
  if (!detail.value) return
  try {
    detail.value = await communityApi.partnerShare(detail.value.id)
  } catch (e: any) {
    toast(e?.message || '刷新失败')
  }
}

async function addComment() {
  const d = detail.value
  if (!d || sendingComment.value) return
  const content = commentText.value.trim()
  if (!content) { toast('请输入批注内容'); return }
  sendingComment.value = true
  try {
    await communityApi.addShareComment(d.id, content)
    commentText.value = ''
    await refreshDetail()
  } catch (e: any) {
    toast(e?.message || '发送失败')
  } finally {
    sendingComment.value = false
  }
}

async function removeShare() {
  const d = detail.value
  if (!d) return
  if (!window.confirm('删除这条分享？其中的批注将一并删除。')) return
  try {
    await communityApi.deleteShare(d.id)
    toast('已删除分享')
    goBack()
  } catch (e: any) {
    toast(e?.message || '删除失败')
  }
}

function openCopyDialog() {
  const v = noteView.value
  if (!v) return
  // 默认选中原笔记同 id 科目（若接收者存在），否则第一个科目
  const has = store.subjects.some(s => s.id === v.subjectId)
  copySubjectId.value = has ? v.subjectId : (store.subjects[0]?.id || '')
  copyDialog.value = true
}

async function confirmCopy() {
  const d = detail.value
  if (!d || copying.value) return
  if (!copySubjectId.value) { toast('请选择科目'); return }
  copying.value = true
  try {
    const note = await communityApi.copyPartnerShare(d.id, copySubjectId.value)
    store.importNotes(copySubjectId.value, [{ id: note.id, title: note.title, content: note.content, tags: note.tags, type: note.type }])
    copyDialog.value = false
    toast('已添加到我的笔记')
  } catch (e: any) {
    toast(e?.message || '添加失败')
  } finally {
    copying.value = false
  }
}
</script>

<template>
  <div class="max-w-3xl mx-auto px-4 py-6 space-y-5">
    <button class="btn-ghost !text-xs" @click="goBack">← 返回</button>
    <div class="section-title !mb-0">分享预览</div>

    <div v-if="loading" class="text-center text-slate-400 dark:text-slate-500 text-xs py-10">加载中…</div>

    <div v-else-if="detail" class="card space-y-3">
      <div class="flex items-center gap-2">
        <span class="text-[10px] px-1.5 py-0.5 rounded-full"
          :class="detail.itemType === 'error' ? 'bg-rose-50 dark:bg-rose-900/30 text-rose-500' : 'bg-sky-50 dark:bg-sky-900/30 text-sky-500'">
          {{ detail.itemType === 'error' ? '错题' : '笔记' }}
        </span>
        <div class="text-[10px] text-slate-400 truncate">{{ detail.ownerName }} 分享给 {{ detail.partnerName }}</div>
        <button v-if="isOwner" class="ml-auto btn-danger !text-xs shrink-0" @click="removeShare">删除分享</button>
      </div>

      <!-- 错题（含图片） -->
      <div v-if="detail.itemType === 'error' && errorView" class="rounded-xl bg-slate-50 dark:bg-slate-700/50 p-3 space-y-2">
        <div class="text-sm font-semibold whitespace-pre-wrap">{{ errorView.question }}</div>
        <img v-if="errorView.image" :src="errorView.image" class="mt-2 max-w-full h-auto rounded-lg border border-slate-100 dark:border-slate-700" alt="错题图片" />
        <div v-if="errorView.answer" class="text-xs text-slate-500 dark:text-slate-400 whitespace-pre-wrap">答案：{{ errorView.answer }}</div>
        <div class="text-[10px] text-slate-400">错 {{ errorView.wrongCount }} 次</div>
      </div>

      <!-- Markdown 笔记 -->
      <div v-else-if="detail.itemType === 'note' && noteView && noteView.type !== 'pdf'" class="space-y-2">
        <div class="text-sm font-semibold">{{ noteView.title }}</div>
        <div class="md-body" v-html="renderMarkdown(noteView.content)"></div>
      </div>

      <!-- PDF 笔记 -->
      <div v-else-if="detail.itemType === 'note' && noteView?.type === 'pdf'" class="h-[60vh]">
        <div v-if="pdfError" class="flex items-center justify-center text-xs text-red-400 h-full">{{ pdfError }}</div>
        <PdfViewer v-else :bytes="pdfBytes" />
      </div>

      <!-- 添加到我的笔记（仅笔记） -->
      <button v-if="detail.itemType === 'note'" class="btn-primary !text-xs self-start" @click="openCopyDialog">添加到我的笔记</button>

      <!-- 批注列表 -->
      <div class="space-y-2">
        <div class="text-xs font-semibold text-slate-500 dark:text-slate-300">批注交流（{{ detail.comments.length }}）</div>
        <div v-if="!detail.comments.length" class="text-xs text-slate-400 text-center py-4">还没有批注，来聊聊解题思路吧</div>
        <div v-for="c in detail.comments" :key="c.id" class="flex items-start gap-2">
          <UserAvatar :name="c.userName" size="sm" />
          <div class="min-w-0 flex-1 rounded-lg bg-slate-50 dark:bg-slate-700/50 px-2 py-1.5">
            <div class="flex items-center gap-2">
              <span class="text-xs font-semibold">{{ c.userName }}</span>
              <span class="text-[10px] text-slate-400">{{ fromNow(c.createdAt) }}</span>
            </div>
            <div class="text-xs text-slate-600 dark:text-slate-300 whitespace-pre-wrap">{{ c.content }}</div>
          </div>
        </div>
      </div>

      <!-- 批注输入 -->
      <div class="flex gap-2 pt-2 border-t border-slate-100 dark:border-slate-700">
        <input v-model="commentText" class="input flex-1 !text-xs" placeholder="写下你的批注或解题思路…"
          maxlength="500" @keydown.enter="addComment" />
        <button class="btn-primary !text-xs shrink-0" :disabled="sendingComment" @click="addComment">
          {{ sendingComment ? '发送中…' : '发送' }}
        </button>
      </div>
    </div>

    <!-- 添加到我的笔记：二次确认 + 科目选择（必填） -->
    <Modal title="添加到我的笔记" :show="copyDialog" @close="copyDialog = false">
      <div class="space-y-3">
        <p class="text-xs text-slate-500 dark:text-slate-400">将会生成一份笔记副本保存到你的笔记列表</p>
        <label class="block text-xs text-slate-500 dark:text-slate-300">归属科目（必选）</label>
        <select v-model="copySubjectId" class="input !text-xs">
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
