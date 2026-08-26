<script setup lang="ts">
/**
 * 搭子错题/笔记分享列表：收到的 + 我发出的；点击统一跳转全屏预览页
 */
import { computed, inject, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { communityApi } from '../api/community'
import UserAvatar from '../components/community/UserAvatar.vue'
import { useBack } from '../composables/useBack'
import { fromNow } from '../utils/date'
import type { PartnerShareItem } from '../types'

const { goBack } = useBack()
const router = useRouter()
const toast = inject<(m: string) => void>('toast', () => {})

const loading = ref(true)
const received = ref<PartnerShareItem[]>([])
const sent = ref<PartnerShareItem[]>([])
const tab = ref<'received' | 'sent'>('received')

const list = computed(() => (tab.value === 'received' ? received.value : sent.value))

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

function openPreview(item: PartnerShareItem) {
  router.push(`/partners/shares/preview/${item.id}`)
}
</script>

<template>
  <div class="max-w-2xl mx-auto px-4 py-6 space-y-5">
    <button class="btn-ghost !text-xs" @click="goBack">← 返回</button>
    <div class="section-title !mb-0">搭子分享</div>

    <div v-if="loading" class="text-center text-slate-400 dark:text-slate-500 text-xs py-10">加载中…</div>

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
          @click="openPreview(s)">
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
