<script setup lang="ts">
import { inject, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { communityApi } from '../api/community'
import UserAvatar from '../components/community/UserAvatar.vue'
import PartnerWeeklyModal from '../components/partner/PartnerWeeklyModal.vue'
import { useBack } from '../composables/useBack'
import type { PartnerSuggestion, PartnerItem, UserLookupResult } from '../types'

const router = useRouter()
const { goBack } = useBack()
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

// ---- 我的搭子：周报对比 / 学习提醒 / 一键解绑 ----
const weeklyTarget = ref<PartnerItem | null>(null)

function openWeekly(p: PartnerItem) {
  weeklyTarget.value = p
}

async function remind(p: PartnerItem) {
  try {
    await communityApi.partnerRemind(p.userId)
    toast('已发送学习提醒')
  } catch (e: any) { toast(e?.message || '操作失败') }
}

async function unbind(p: PartnerItem) {
  if (!window.confirm(`确认与「${p.userName}」解除搭子关系？`)) return
  try {
    await communityApi.unbindPartner(p.userId)
    toast('已解除搭子关系')
    await load()
  } catch (e: any) { toast(e?.message || '操作失败') }
}

// ---- 查找搭子（复用 lookup 接口）----
const searchKey = ref('')
const searching = ref(false)
const searchResult = ref<UserLookupResult | null>(null)
const searchNotFound = ref(false)
const searchError = ref(false)

async function searchPartner() {
  const key = searchKey.value.trim()
  if (!key || searching.value) return
  searching.value = true
  searchResult.value = null
  searchNotFound.value = false
  searchError.value = false
  try {
    searchResult.value = await communityApi.lookup(key)
  } catch (e: any) {
    if (e?.status === 404) searchNotFound.value = true
    else searchError.value = true
  } finally {
    searching.value = false
  }
}

async function addPartner(userId: string) {
  try {
    const res = await communityApi.sendPartner(userId)
    toast(res.accepted ? '你们已成为搭子！' : '已发送请求')
    if (searchResult.value) searchResult.value.partnerStatus = res.accepted ? 'accepted' : 'pending_sent'
    await load()
  } catch (e: any) { toast(e?.message || '操作失败') }
}
</script>

<template>
  <div class="max-w-3xl mx-auto px-4 py-6 space-y-5">
    <button class="btn-ghost !text-xs" @click="goBack">← 返回</button>
    <div class="section-title !mb-0">学习搭子</div>

    <div v-if="loading" class="text-center text-slate-400 dark:text-slate-500 text-xs py-10">加载中…</div>

    <template v-else>
      <!-- 查找搭子 -->
      <div class="card space-y-2">
        <div class="text-sm font-semibold text-slate-700 dark:text-slate-200">查找搭子</div>
        <div class="flex gap-2">
          <input v-model="searchKey" class="input flex-1" placeholder="输入用户ID查找搭子"
            maxlength="32" @keydown.enter="searchPartner" />
          <button class="btn-primary !text-xs shrink-0" :disabled="searching" @click="searchPartner">
            {{ searching ? '搜索中' : '搜索' }}
          </button>
        </div>
        <div v-if="searchResult" class="flex items-center gap-3 pt-2">
          <div class="flex items-center gap-2 min-w-0 cursor-pointer group" @click="router.push(`/profile/${searchResult.userId}`)">
            <UserAvatar :name="searchResult.userName" :avatar="searchResult.avatar" size="sm" />
            <div class="min-w-0">
              <div class="flex items-center gap-1.5">
                <span class="font-medium truncate group-hover:text-primary-500">{{ searchResult.userName }}</span>
                <span v-if="searchResult.verified" class="w-3.5 h-3.5 rounded-full bg-sky-500 text-white text-[9px] flex items-center justify-center shrink-0" title="认证专家">✓</span>
              </div>
              <div class="text-[10px] text-slate-400 dark:text-slate-500">用户ID：{{ searchResult.userCode }}</div>
            </div>
          </div>
          <span v-if="searchResult.partnerStatus === 'accepted'" class="ml-auto text-xs text-slate-400 shrink-0">已是搭子</span>
          <span v-else-if="searchResult.partnerStatus === 'pending_sent'" class="ml-auto text-xs text-slate-400 shrink-0">已发送请求</span>
          <span v-else-if="searchResult.partnerStatus === 'self'" class="ml-auto text-xs text-slate-400 shrink-0">这是你自己</span>
          <button v-else class="ml-auto btn-primary !text-xs shrink-0" @click="addPartner(searchResult.userId)">
            {{ searchResult.partnerStatus === 'pending_received' ? '接受邀请' : '加搭子' }}
          </button>
        </div>
        <div v-else-if="searchNotFound" class="text-xs text-slate-400 dark:text-slate-500 text-center py-2">未找到该用户</div>
        <div v-else-if="searchError" class="text-xs text-slate-400 dark:text-slate-500 text-center py-2">搜索失败，请重试</div>
        <div v-else class="text-xs text-slate-400 dark:text-slate-500 text-center py-2">输入用户ID查找学习搭子</div>
      </div>

      <!-- 收到的请求 -->
      <div v-if="incoming.length" class="card space-y-2">
        <div class="text-sm font-semibold text-slate-700 dark:text-slate-200">收到的请求</div>
        <div v-for="u in incoming" :key="u.reqId" class="flex items-center gap-2 text-xs">
          <div class="flex items-center gap-2 cursor-pointer group" @click="router.push(`/profile/${u.userId}`)">
            <UserAvatar :name="u.userName" :avatar="u.userAvatar" size="sm" />
            <span class="font-medium group-hover:text-primary-500">{{ u.userName }}</span>
          </div>
          <button class="ml-auto btn-primary !text-xs" @click="respond(u.reqId, 'accept')">接受</button>
          <button class="btn-ghost !text-xs" @click="respond(u.reqId, 'reject')">拒绝</button>
        </div>
      </div>

      <!-- 我的搭子 -->
      <div class="card space-y-2">
        <div class="flex items-center">
          <div class="text-sm font-semibold text-slate-700 dark:text-slate-200">我的搭子（{{ partners.length }}/3）</div>
          <button class="ml-auto btn-ghost !text-xs" @click="router.push('/partners/shares')">搭子分享 →</button>
        </div>
        <div v-if="!partners.length" class="text-xs text-slate-400 dark:text-slate-500 text-center py-4">还没有搭子，去下方推荐里找一个吧</div>
        <div v-for="p in partners" :key="p.reqId" class="text-xs border-b border-slate-50 dark:border-slate-700 last:border-0 py-1.5 space-y-1.5">
          <div class="flex items-center gap-2 cursor-pointer group" @click="router.push(`/profile/${p.userId}`)">
            <UserAvatar :name="p.userName" :avatar="p.userAvatar" size="sm" />
            <span class="font-medium group-hover:text-primary-500">{{ p.userName }}</span>
          </div>
          <div class="flex flex-wrap gap-1">
            <button class="btn-ghost !text-xs" @click="openWeekly(p)">周报</button>
            <button class="btn-ghost !text-xs" @click="remind(p)">提醒</button>
            <button class="btn-ghost !text-xs" @click="router.push(`/partners/study?partner=${p.userId}`)">开黑</button>
            <button class="btn-ghost !text-xs" @click="router.push(`/partners/plans?partner=${p.userId}`)">计划</button>
            <button class="btn-ghost !text-xs" @click="router.push(`/partners/reviews?partner=${p.userId}`)">复盘</button>
            <button class="btn-ghost !text-xs" @click="router.push(`/messages/${p.userId}`)">私信</button>
            <button class="btn-ghost !text-xs text-red-400" @click="unbind(p)">解绑</button>
          </div>
        </div>
      </div>

      <!-- 推荐 -->
      <div class="card space-y-2">
        <div class="text-sm font-semibold text-slate-700 dark:text-slate-200">为你推荐</div>
        <div v-if="!suggestions.length" class="text-xs text-slate-400 dark:text-slate-500 text-center py-4">暂无可推荐的搭子</div>
        <div v-for="s in suggestions" :key="s.userId" class="flex items-center gap-2 text-xs border-b border-slate-50 dark:border-slate-700 last:border-0 py-1.5">
          <div class="flex items-center gap-2 min-w-0 cursor-pointer group" @click="router.push(`/profile/${s.userId}`)">
            <UserAvatar :name="s.userName" :avatar="s.userAvatar" size="sm" />
            <div class="min-w-0">
              <div class="font-medium truncate group-hover:text-primary-500">{{ s.userName }}</div>
              <div class="text-[10px] text-slate-400 dark:text-slate-500 truncate">{{ s.reasons.join(' · ') || '缘分推荐' }}</div>
            </div>
          </div>
          <button class="ml-auto btn-primary !text-xs shrink-0" @click="send(s.userId)">加搭子</button>
        </div>
      </div>
    </template>

    <!-- 搭子周报对比弹窗 -->
    <PartnerWeeklyModal v-if="weeklyTarget" :partner-id="weeklyTarget.userId" :partner-name="weeklyTarget.userName"
      @close="weeklyTarget = null" />
  </div>
</template>
