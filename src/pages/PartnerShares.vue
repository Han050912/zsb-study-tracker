<script setup lang="ts">
/**
 * 搭子错题/笔记分享：收到的 + 我发出的分享列表，点进详情查看内容并双人批注交流
 * - 列表：分享者/接收者、类型标签（错题/笔记）、批注数、时间
 * - 详情：错题/笔记内容 + 批注列表 + 批注输入框；仅分享者可删除
 */
import { computed, inject, onMounted, ref } from 'vue'
import { communityApi } from '../api/community'
import UserAvatar from '../components/community/UserAvatar.vue'
import { useBack } from '../composables/useBack'
import { fromNow } from '../utils/date'
import { useAppStore } from '../stores/app'
import type { PartnerShareDetail, PartnerShareItem } from '../types'

const { goBack } = useBack()
const toast = inject<(m: string) => void>('toast', () => {})
const store = useAppStore()

const loading = ref(true)
const received = ref<PartnerShareItem[]>([])
const sent = ref<PartnerShareItem[]>([])
const tab = ref<'received' | 'sent'>('received')

const detail = ref<PartnerShareDetail | null>(null)
const detailLoading = ref(false)
const commentText = ref('')
const sendingComment = ref(false)

const list = computed(() => (tab.value === 'received' ? received.value : sent.value))

/** 详情中错题/笔记内容（按 itemType 断言字段） */
const itemView = computed(() => {
  const d = detail.value
  if (!d) return null
  const it: any = d.item
  if (d.itemType === 'error') {
    return { kind: 'error' as const, question: it.question ?? '', answer: it.answer ?? '', note: it.note ?? '', wrongCount: it.wrong_count ?? 0 }
  }
  return { kind: 'note' as const, title: it.title ?? '', content: it.content ?? '' }
})

const isOwner = computed(() => !!detail.value && detail.value.ownerId === store.user?.id)

onMounted(load)

async function load() {
  loading.value = true
  try {
    const res = await communityApi.partnerShares()
    received.value = res.received
    sent.value = res.sent
  } catch (e: any) {
    toast(e?.message || '加载失败')
  } finally {
    loading.value = false
  }
}

async function openDetail(item: PartnerShareItem) {
  detailLoading.value = true
  detail.value = null
  commentText.value = ''
  try {
    detail.value = await communityApi.partnerShare(item.id)
  } catch (e: any) {
    toast(e?.message || '加载失败')
  } finally {
    detailLoading.value = false
  }
}

function backToList() {
  detail.value = null
  load()
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
    detail.value = null
    await load()
  } catch (e: any) {
    toast(e?.message || '删除失败')
  }
}
</script>

<template>
  <div class="max-w-2xl mx-auto px-4 py-6 space-y-5">
    <button class="btn-ghost !text-xs" @click="goBack">← 返回</button>
    <div class="section-title !mb-0">搭子分享</div>

    <div v-if="loading" class="text-center text-slate-400 dark:text-slate-500 text-xs py-10">加载中…</div>

    <!-- 详情视图 -->
    <template v-else-if="detail || detailLoading">
      <div class="card space-y-3">
        <div v-if="detailLoading" class="text-center text-xs text-slate-400 py-10">加载中…</div>
        <template v-else-if="detail && itemView">
          <div class="flex items-center gap-2">
            <button class="btn-ghost !text-xs !px-2" @click="backToList">← 列表</button>
            <span class="text-[10px] px-1.5 py-0.5 rounded-full"
              :class="detail.itemType === 'error' ? 'bg-rose-50 dark:bg-rose-900/30 text-rose-500' : 'bg-sky-50 dark:bg-sky-900/30 text-sky-500'">
              {{ detail.itemType === 'error' ? '错题' : '笔记' }}
            </span>
            <div class="text-[10px] text-slate-400 truncate">{{ detail.ownerName }} 分享给 {{ detail.partnerName }}</div>
            <button v-if="isOwner" class="ml-auto btn-danger !text-xs shrink-0" @click="removeShare">删除分享</button>
          </div>

          <!-- 内容展示 -->
          <div v-if="itemView.kind === 'error'" class="rounded-xl bg-slate-50 dark:bg-slate-700/50 p-3 space-y-2">
            <div class="text-sm font-semibold whitespace-pre-wrap">{{ itemView.question }}</div>
            <div v-if="itemView.answer" class="text-xs text-slate-500 dark:text-slate-400 whitespace-pre-wrap">答案：{{ itemView.answer }}</div>
            <div v-if="itemView.note" class="text-xs text-slate-500 dark:text-slate-400 whitespace-pre-wrap">解析：{{ itemView.note }}</div>
            <div class="text-[10px] text-slate-400">错 {{ itemView.wrongCount }} 次</div>
          </div>
          <div v-else class="rounded-xl bg-slate-50 dark:bg-slate-700/50 p-3 space-y-2">
            <div class="text-sm font-semibold">{{ itemView.title }}</div>
            <div class="text-xs text-slate-600 dark:text-slate-300 whitespace-pre-wrap">{{ itemView.content }}</div>
          </div>

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
        </template>
      </div>
    </template>

    <!-- 列表视图 -->
    <template v-else>
      <div class="flex gap-2">
        <button class="btn !text-xs !py-1 !px-3" :class="tab === 'received' ? 'bg-primary-500 text-white' : 'bg-slate-100 dark:bg-slate-700'"
          @click="tab = 'received'">收到的（{{ received.length }}）</button>
        <button class="btn !text-xs !py-1 !px-3" :class="tab === 'sent' ? 'bg-primary-500 text-white' : 'bg-slate-100 dark:bg-slate-700'"
          @click="tab = 'sent'">我发出的（{{ sent.length }}）</button>
      </div>

      <div class="card space-y-2">
        <div v-if="!list.length" class="text-xs text-slate-400 dark:text-slate-500 text-center py-6">
          {{ tab === 'received' ? '还没有收到搭子的分享' : '还没有分享给搭子，去错题本/笔记页分享一条吧' }}
        </div>
        <button v-for="s in list" :key="s.id"
          class="w-full flex items-center gap-2 rounded-lg px-2 py-2 text-xs transition-colors hover:bg-slate-50 dark:hover:bg-slate-700"
          @click="openDetail(s)">
          <UserAvatar :name="tab === 'received' ? s.ownerName : s.partnerName" size="sm" />
          <div class="min-w-0 text-left flex-1">
            <div class="flex items-center gap-1.5">
              <span class="font-medium truncate">{{ tab === 'received' ? s.ownerName : s.partnerName }}</span>
              <span class="text-[10px] px-1.5 py-0.5 rounded-full shrink-0"
                :class="s.itemType === 'error' ? 'bg-rose-50 dark:bg-rose-900/30 text-rose-500' : 'bg-sky-50 dark:bg-sky-900/30 text-sky-500'">
                {{ s.itemType === 'error' ? '错题' : '笔记' }}
              </span>
            </div>
            <div class="text-[10px] text-slate-400">
              {{ tab === 'received' ? `分享给我 · ${fromNow(s.createdAt)}` : `分享给TA · ${fromNow(s.createdAt)}` }}
            </div>
          </div>
          <span v-if="s.commentCount" class="shrink-0 text-[10px] text-slate-400">{{ s.commentCount }} 条批注</span>
        </button>
      </div>
    </template>
  </div>
</template>
