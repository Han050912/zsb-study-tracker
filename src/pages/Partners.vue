<script setup lang="ts">
import { inject, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { communityApi } from '../api/community'
import UserAvatar from '../components/community/UserAvatar.vue'
import type { PartnerSuggestion, PartnerItem } from '../types'

const router = useRouter()
const toast = inject<(m: string) => void>('toast', () => {})
const suggestions = ref<PartnerSuggestion[]>([])
const incoming = ref<PartnerItem[]>([])
const partners = ref<PartnerItem[]>([])
const loading = ref(false)

onMounted(load)

async function load() {
  loading.value = true
  try {
    const [s, l] = await Promise.all([communityApi.partnerSuggestions(), communityApi.partners()])
    suggestions.value = s.suggestions
    incoming.value = l.incoming
    partners.value = l.partners
  } catch (e: any) {
    toast(e?.message || '加载失败')
  } finally {
    loading.value = false
  }
}

async function send(userId: string) {
  try {
    const res = await communityApi.sendPartner(userId)
    toast(res.accepted ? '你们已成为搭子！' : '已发送请求')
    await load()
  } catch (e: any) { toast(e?.message || '操作失败') }
}

async function respond(reqId: string, action: 'accept' | 'reject') {
  try {
    await communityApi.respondPartner(reqId, action)
    toast(action === 'accept' ? '已接受' : '已拒绝')
    await load()
  } catch (e: any) { toast(e?.message || '操作失败') }
}
</script>

<template>
  <div class="max-w-3xl mx-auto px-4 py-6 space-y-5">
    <button class="btn-ghost !text-xs" @click="router.push('/community')">← 返回广场</button>
    <div class="section-title !mb-0">🧑‍🤝‍🧑 学习搭子</div>

    <div v-if="loading" class="text-center text-slate-400 dark:text-slate-500 text-xs py-10">加载中…</div>

    <template v-else>
      <!-- 收到的请求 -->
      <div v-if="incoming.length" class="card space-y-2">
        <div class="text-sm font-semibold text-slate-700 dark:text-slate-200">收到的请求</div>
        <div v-for="u in incoming" :key="u.reqId" class="flex items-center gap-2 text-xs">
          <UserAvatar :name="u.userName" size="sm" />
          <span class="font-medium">{{ u.userName }}</span>
          <button class="ml-auto btn-primary !text-xs" @click="respond(u.reqId, 'accept')">接受</button>
          <button class="btn-ghost !text-xs" @click="respond(u.reqId, 'reject')">拒绝</button>
        </div>
      </div>

      <!-- 推荐 -->
      <div class="card space-y-2">
        <div class="text-sm font-semibold text-slate-700 dark:text-slate-200">为你推荐</div>
        <div v-if="!suggestions.length" class="text-xs text-slate-400 dark:text-slate-500 text-center py-4">暂无可推荐的搭子</div>
        <div v-for="s in suggestions" :key="s.userId" class="flex items-center gap-2 text-xs border-b border-slate-50 dark:border-slate-700 last:border-0 py-1.5">
          <UserAvatar :name="s.userName" size="sm" />
          <div class="min-w-0">
            <div class="font-medium truncate">{{ s.userName }}</div>
            <div class="text-[10px] text-slate-400 dark:text-slate-500 truncate">{{ s.reasons.join(' · ') || '缘分推荐' }}</div>
          </div>
          <button class="ml-auto btn-primary !text-xs shrink-0" @click="send(s.userId)">加搭子</button>
        </div>
      </div>

      <!-- 我的搭子 -->
      <div class="card space-y-2">
        <div class="text-sm font-semibold text-slate-700 dark:text-slate-200">我的搭子（{{ partners.length }}）</div>
        <div v-if="!partners.length" class="text-xs text-slate-400 dark:text-slate-500 text-center py-4">还没有搭子，去上方推荐里找一个吧</div>
        <div v-for="p in partners" :key="p.reqId" class="flex items-center gap-2 text-xs">
          <UserAvatar :name="p.userName" size="sm" />
          <span class="font-medium">{{ p.userName }}</span>
          <button class="ml-auto btn-ghost !text-xs" @click="router.push(`/profile/${p.userId}`)">看主页</button>
        </div>
      </div>
    </template>
  </div>
</template>
