<script setup lang="ts">
import IconAction from '../shared/components/IconAction.vue'
import LoadingState from '../shared/components/LoadingState.vue'
import AsyncState from '../shared/components/AsyncState.vue'
/**
 * 搭子错题/笔记分享列表：收到的 + 我发出的；点击统一跳转全屏预览页
 */
import { computed, onMounted, onBeforeUnmount, ref } from 'vue'
import { getErrorMessage } from '../utils/error'
import { useRouter } from 'vue-router'
import { partnersApi } from '../api/community/partners'
import { RefreshCw, TriangleAlert, ArrowLeft } from '@lucide/vue'
import UserAvatar from '../components/community/UserAvatar.vue'
import { useBack } from '../composables/useBack'
import { fromNow } from '../utils/date'
import type { PartnerShareItem } from '../types'

const { goBack } = useBack()
const router = useRouter()

const loading = ref(true)
/** 加载失败信息：持久错误态（区别于「还没有收到分享」空态），提供重试 */
const loadError = ref('')
const received = ref<PartnerShareItem[]>([])
const sent = ref<PartnerShareItem[]>([])
const nextCursor = ref<string | null>(null)
const loadingMore = ref(false)
const moreError = ref('')
let disposed = false
onBeforeUnmount(() => {
  disposed = true
})
const tab = ref<'received' | 'sent'>('received')

const list = computed(() => (tab.value === 'received' ? received.value : sent.value))

onMounted(() => load())

async function load(reset = true) {
  if (loadingMore.value || (!reset && !nextCursor.value)) return
  if (reset) {
    loading.value = true
    loadError.value = ''
  } else {
    loadingMore.value = true
    moreError.value = ''
  }
  try {
    const res = await partnersApi.partnerShares(reset ? null : nextCursor.value)
    if (disposed) return
    const merge = (old: PartnerShareItem[], incoming: PartnerShareItem[]) => [
      ...new Map([...old, ...incoming].map((item) => [item.id, item])).values()
    ]
    received.value = reset ? res.received : merge(received.value, res.received)
    sent.value = reset ? res.sent : merge(sent.value, res.sent)
    nextCursor.value = res.nextCursor ?? null
  } catch (e) {
    if (disposed) return
    if (reset) loadError.value = getErrorMessage(e, '分享加载失败，请重试')
    else moreError.value = getErrorMessage(e, '更早的分享未能加载，请重试')
  } finally {
    loading.value = false
    loadingMore.value = false
  }
}

function openPreview(item: PartnerShareItem) {
  router.push(`/partners/shares/preview/${item.id}`)
}
</script>

<template>
  <div class="study-page reading-page space-y-5">
    <span class="!text-xs arrow-action" @click="goBack"
      ><IconAction :icon="ArrowLeft" label="返回" @click="goBack" /> 返回</span
    >
    <h1 class="page-title">搭子分享</h1>

    <LoadingState v-if="loading" />

    <template v-else>
      <!-- 加载失败：持久错误态 + 重试，不落「还没有收到搭子的分享」空态 -->
      <div v-if="loadError" class="card flex items-center gap-2 text-xs text-correction dark:text-correction">
        <TriangleAlert :size="14" aria-hidden="true" class="shrink-0" />
        <span class="flex-1">{{ loadError }}</span>
        <button class="btn-ghost !text-xs shrink-0" @click="load()">
          <RefreshCw :size="14" aria-hidden="true" />
          重试
        </button>
      </div>

      <div v-else class="flex gap-2">
        <button
          class="btn !text-xs !py-1 !px-3"
          :class="tab === 'received' ? 'bg-action text-on-action' : 'bg-slate-100 dark:bg-slate-700'"
          :aria-pressed="tab === 'received'"
          @click="tab = 'received'"
        >
          收到的（{{ received.length }}）
        </button>
        <button
          class="btn !text-xs !py-1 !px-3"
          :class="tab === 'sent' ? 'bg-action text-on-action' : 'bg-slate-100 dark:bg-slate-700'"
          :aria-pressed="tab === 'sent'"
          @click="tab = 'sent'"
        >
          我发出的（{{ sent.length }}）
        </button>
      </div>

      <div v-if="!loadError" class="card space-y-2">
        <div v-if="!list.length" class="text-xs text-slate-400 dark:text-slate-500 text-center py-6">
          {{ tab === 'received' ? '还没有收到搭子的分享' : '还没有分享给搭子，去错题本/笔记页分享一条吧' }}
        </div>
        <button
          v-for="s in list"
          :key="s.id"
          class="w-full flex items-center gap-2 rounded-lg px-2 py-2 text-xs transition-colors hover:bg-slate-50 dark:hover:bg-slate-700"
          @click="openPreview(s)"
        >
          <UserAvatar :name="tab === 'received' ? s.ownerName : s.partnerName" size="sm" />
          <div class="min-w-0 text-left flex-1">
            <div class="flex items-center gap-1.5">
              <span class="font-medium truncate">{{ tab === 'received' ? s.ownerName : s.partnerName }}</span>
              <span
                class="text-xs px-1.5 py-0.5 rounded-full shrink-0"
                :class="
                  s.itemType === 'error'
                    ? 'bg-correction-soft dark:bg-correction-soft text-correction'
                    : 'bg-action-soft dark:bg-action-soft text-action'
                "
              >
                {{ s.itemType === 'error' ? '错题' : '笔记' }}
              </span>
            </div>
            <div class="text-xs text-slate-400">
              {{ tab === 'received' ? `分享给我 · ${fromNow(s.createdAt)}` : `分享给TA · ${fromNow(s.createdAt)}` }}
            </div>
          </div>
          <span v-if="s.commentCount" class="shrink-0 text-xs text-slate-400">{{ s.commentCount }} 条批注</span>
        </button>
        <AsyncState v-if="moreError" :error="moreError" @retry="load(false)" />
        <div v-else-if="nextCursor" class="text-center pt-1">
          <button class="btn-ghost" :disabled="loadingMore" @click="load(false)">
            {{ loadingMore ? '加载中…' : '加载更早的分享' }}
          </button>
        </div>
      </div>
    </template>
  </div>
</template>
