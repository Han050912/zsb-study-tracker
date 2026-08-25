<script setup lang="ts">
/**
 * 双向复盘邀约：
 * - 列表：搭子/预约时间/状态/复盘记录 note；每条可「取消」（删除）
 * - 新建：选择搭子（?partner= 可预选）+ datetime-local 时间 → createPartnerReview（unix 秒）
 * - 收到的 pending 邀约可「接受」；已接受的邀约可「完成复盘」（填写复盘记录 note 后提交）
 */
import { inject, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import dayjs from 'dayjs'
import { communityApi } from '../api/community'
import { useBack } from '../composables/useBack'
import type { PartnerItem, PartnerReview } from '../types'

const route = useRoute()
const { goBack } = useBack()
const toast = inject<(m: string) => void>('toast', () => {})

const loading = ref(true)
const items = ref<PartnerReview[]>([])
const partners = ref<PartnerItem[]>([])

// ---- 新建邀约 ----
const newPartner = ref((route.query.partner as string) || '')
const newTime = ref('')
const creating = ref(false)

// ---- 完成复盘（内联填写复盘记录） ----
const completingId = ref('')
const noteText = ref('')

const STATUS: Record<PartnerReview['status'], { text: (r: PartnerReview) => string; cls: string }> = {
  pending: { text: r => (r.isFrom ? '待对方接受' : '待我接受'), cls: 'bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400' },
  accepted: { text: () => '待复盘', cls: 'bg-sky-50 dark:bg-sky-900/30 text-sky-600 dark:text-sky-400' },
  done: { text: () => '已完成', cls: 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400' }
}

function fmtTime(sec: number) {
  return dayjs(sec * 1000).format('MM-DD HH:mm')
}

onMounted(async () => {
  loading.value = true
  try {
    const [r, l] = await Promise.all([communityApi.partnerReviews(), communityApi.partners()])
    items.value = r.items
    partners.value = l.partners
    if (newPartner.value && !l.partners.some(x => x.userId === newPartner.value)) newPartner.value = ''
  } catch (e: any) {
    toast(e?.message || '加载失败')
  } finally {
    loading.value = false
  }
})

async function load() {
  try {
    items.value = (await communityApi.partnerReviews()).items
  } catch (e: any) {
    toast(e?.message || '加载失败')
  }
}

async function create() {
  if (creating.value) return
  if (!newPartner.value) { toast('请选择搭子'); return }
  if (!newTime.value) { toast('请选择复盘时间'); return }
  const scheduledAt = Math.floor(new Date(newTime.value).getTime() / 1000)
  if (Number.isNaN(scheduledAt)) { toast('时间格式不正确'); return }
  creating.value = true
  try {
    await communityApi.createPartnerReview(newPartner.value, scheduledAt)
    newTime.value = ''
    toast('邀约已发送')
    await load()
  } catch (e: any) {
    toast(e?.message || '创建失败')
  } finally {
    creating.value = false
  }
}

async function accept(r: PartnerReview) {
  try {
    await communityApi.updatePartnerReview(r.id, 'accept')
    toast('已接受邀约')
    await load()
  } catch (e: any) {
    toast(e?.message || '操作失败')
  }
}

function openComplete(r: PartnerReview) {
  completingId.value = r.id
  noteText.value = r.note || ''
}

async function complete(r: PartnerReview) {
  try {
    await communityApi.updatePartnerReview(r.id, 'done', noteText.value.trim())
    completingId.value = ''
    noteText.value = ''
    toast('复盘已完成')
    await load()
  } catch (e: any) {
    toast(e?.message || '操作失败')
  }
}

async function cancel(r: PartnerReview) {
  if (!window.confirm('取消这条复盘邀约？')) return
  try {
    await communityApi.deletePartnerReview(r.id)
    if (completingId.value === r.id) completingId.value = ''
    toast('已取消')
    await load()
  } catch (e: any) {
    toast(e?.message || '操作失败')
  }
}
</script>

<template>
  <div class="max-w-2xl mx-auto px-4 py-6 space-y-5">
    <button class="btn-ghost !text-xs" @click="goBack">← 返回</button>
    <div class="section-title !mb-0">复盘邀约</div>

    <div v-if="loading" class="text-center text-slate-400 dark:text-slate-500 text-xs py-10">加载中…</div>

    <template v-else>
      <!-- 新建邀约 -->
      <div class="card space-y-2">
        <div class="text-sm font-semibold text-slate-700 dark:text-slate-200">新建复盘邀约</div>
        <div v-if="!partners.length" class="text-xs text-slate-400 dark:text-slate-500 text-center py-2">
          还没有搭子，先去<router-link to="/community/partners" class="text-primary-500">搭子页</router-link>添加一位吧
        </div>
        <div v-else class="flex gap-2 flex-wrap">
          <select v-model="newPartner" class="input !w-auto !text-xs">
            <option value="" disabled>选择搭子</option>
            <option v-for="p in partners" :key="p.userId" :value="p.userId">{{ p.userName }}</option>
          </select>
          <input v-model="newTime" type="datetime-local" class="input flex-1 min-w-40 !text-xs" />
          <button class="btn-primary !text-xs shrink-0" :disabled="creating" @click="create">
            {{ creating ? '发送中…' : '发起邀约' }}
          </button>
        </div>
      </div>

      <!-- 邀约列表 -->
      <div class="card space-y-2">
        <div class="text-sm font-semibold text-slate-700 dark:text-slate-200">我的邀约（{{ items.length }}）</div>
        <div v-if="!items.length" class="text-xs text-slate-400 dark:text-slate-500 text-center py-6">还没有复盘邀约，在上方发起一个吧</div>
        <div v-for="r in items" :key="r.id"
          class="border-b border-slate-50 dark:border-slate-700 last:border-0 py-2 space-y-1.5 text-xs">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="font-medium">{{ r.partnerName }}</span>
            <span class="text-slate-400">{{ fmtTime(r.scheduledAt) }}</span>
            <span class="inline-flex items-center text-[10px] px-1.5 py-0.5 rounded-full" :class="STATUS[r.status].cls">
              {{ STATUS[r.status].text(r) }}
            </span>
            <span v-if="r.isFrom" class="text-[10px] text-slate-400">我发起的</span>
          </div>
          <div v-if="r.note && r.id !== completingId"
            class="text-xs text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-700/50 rounded-lg p-2 whitespace-pre-wrap">
            复盘记录：{{ r.note }}
          </div>
          <div class="flex flex-wrap gap-1">
            <button v-if="!r.isFrom && r.status === 'pending'" class="btn-primary !text-xs" @click="accept(r)">接受</button>
            <button v-if="r.status === 'accepted' && completingId !== r.id" class="btn-primary !text-xs" @click="openComplete(r)">完成复盘</button>
            <button class="btn-ghost !text-xs" @click="cancel(r)">取消</button>
          </div>
          <!-- 完成复盘：内联填写复盘记录 -->
          <div v-if="completingId === r.id" class="space-y-1.5">
            <textarea v-model="noteText" rows="3" class="input !text-xs" maxlength="500"
              placeholder="记录本次复盘的结论、问题与下一步计划…"></textarea>
            <div class="flex gap-1 justify-end">
              <button class="btn-ghost !text-xs" @click="completingId = ''">取消</button>
              <button class="btn-primary !text-xs" @click="complete(r)">提交复盘记录</button>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
