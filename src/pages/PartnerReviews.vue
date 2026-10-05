<script setup lang="ts">
import IconAction from '../shared/components/IconAction.vue'
import EmptyState from '../shared/components/EmptyState.vue'
import LoadingState from '../shared/components/LoadingState.vue'
import { usePartnerStore } from '../features/collaboration/stores/partners'
import { storeToRefs } from 'pinia'
const partnerStore = usePartnerStore()
/**
 * 双向复盘邀约：
 * - 列表：搭子/预约时间/状态/复盘记录 note；每条可「取消」（删除）
 * - 新建：选择搭子（?partner= 可预选）+ datetime-local 时间 → createPartnerReview（unix 秒）
 * - 收到的 pending 邀约可「接受」；已接受的邀约可「完成复盘」（填写复盘记录 note 后提交）
 */
import { onMounted, ref } from 'vue'
import { getErrorMessage } from '../utils/error'
import { useToast } from '../composables/useToast'
import { useConfirm } from '../composables/useConfirm'
import { useRoute } from 'vue-router'
import dayjs from 'dayjs'
import { partnersApi } from '../api/community/partners'
import { RefreshCw, TriangleAlert, ArrowLeft } from '@lucide/vue'
import { useBack } from '../composables/useBack'
import type { PartnerReview } from '../types'

const route = useRoute()
const { goBack } = useBack()
const toast = useToast()
const confirm = useConfirm()

const loading = ref(true)
/** 首屏加载失败信息：持久错误态（区别于「还没有复盘邀约」空态），提供重试 */
const loadError = ref('')
const items = ref<PartnerReview[]>([])
const { partners } = storeToRefs(partnerStore)

// ---- 新建邀约 ----
const newPartner = ref((route.query.partner as string) || '')
const newTime = ref('')
const creating = ref(false)

// ---- 完成复盘（内联填写复盘记录） ----
const completingId = ref('')
const noteText = ref('')

const STATUS: Record<PartnerReview['status'], { text: (r: PartnerReview) => string; cls: string }> = {
  pending: {
    text: (r) => (r.isFrom ? '待对方接受' : '待我接受'),
    cls: 'bg-action-soft dark:bg-action-soft text-action dark:text-action'
  },
  accepted: { text: () => '待复盘', cls: 'bg-action-soft dark:bg-action-soft text-action dark:text-action' },
  done: { text: () => '已完成', cls: 'bg-action-soft dark:bg-action-soft text-action dark:text-action' }
}

function fmtTime(sec: number) {
  return dayjs(sec * 1000).format('MM-DD HH:mm')
}

onMounted(load)

/** 首屏全量加载（邀约 + 搭子）；失败置持久错误态供重试 */
async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const [r, l] = await Promise.all([partnersApi.partnerReviews(), partnerStore.load()])
    items.value = r.items
    if (newPartner.value && !l.partners.some((x) => x.userId === newPartner.value)) newPartner.value = ''
  } catch (e) {
    loadError.value = getErrorMessage(e, '加载失败')
    toast(loadError.value)
  } finally {
    loading.value = false
  }
}

/** 操作后的增量刷新：仅拉邀约列表，失败时 toast 不清空现有列表 */
async function reloadItems() {
  try {
    items.value = (await partnersApi.partnerReviews()).items
  } catch (e) {
    toast(getErrorMessage(e, '加载失败'))
  }
}

async function create() {
  if (creating.value) return
  if (!newPartner.value) {
    toast('请选择搭子')
    return
  }
  if (!newTime.value) {
    toast('请选择复盘时间')
    return
  }
  const scheduledAt = Math.floor(new Date(newTime.value).getTime() / 1000)
  if (Number.isNaN(scheduledAt)) {
    toast('时间格式不正确')
    return
  }
  creating.value = true
  try {
    await partnersApi.createPartnerReview(newPartner.value, scheduledAt)
    newTime.value = ''
    toast('邀约已发送')
    await reloadItems()
  } catch (e) {
    toast(getErrorMessage(e, '创建失败'))
  } finally {
    creating.value = false
  }
}

/** 操作提交守卫（per-id，防止双击并发重复操作，避免第二次 400「邀约状态不正确」） */
const acting = ref<Record<string, boolean>>({})

async function accept(r: PartnerReview) {
  if (acting.value[r.id]) return
  acting.value[r.id] = true
  try {
    await partnersApi.updatePartnerReview(r.id, 'accept')
    toast('已接受邀约')
    await reloadItems()
  } catch (e) {
    toast(getErrorMessage(e, '未能接受邀约，请重试'))
  } finally {
    acting.value[r.id] = false
  }
}

function openComplete(r: PartnerReview) {
  completingId.value = r.id
  noteText.value = r.note || ''
}

async function complete(r: PartnerReview) {
  if (acting.value[r.id]) return
  acting.value[r.id] = true
  try {
    await partnersApi.updatePartnerReview(r.id, 'done', noteText.value.trim())
    completingId.value = ''
    noteText.value = ''
    toast('复盘已完成')
    await reloadItems()
  } catch (e) {
    toast(getErrorMessage(e, '复盘记录未能保存，请重试'))
  } finally {
    acting.value[r.id] = false
  }
}

async function cancel(r: PartnerReview) {
  if (acting.value[r.id]) return
  if (!(await confirm('取消这条复盘邀约？'))) return
  if (acting.value[r.id]) return
  acting.value[r.id] = true
  try {
    await partnersApi.deletePartnerReview(r.id)
    if (completingId.value === r.id) completingId.value = ''
    toast('已取消')
    await reloadItems()
  } catch (e) {
    toast(getErrorMessage(e, '邀约未能取消，请重试'))
  } finally {
    acting.value[r.id] = false
  }
}
</script>

<template>
  <div class="collaboration-page study-page reading-page space-y-5">
    <span class="!text-xs arrow-action" @click="goBack"
      ><IconAction :icon="ArrowLeft" label="返回" @click="goBack" /> 返回</span
    >
    <h1 class="page-title">复盘邀约</h1>

    <LoadingState v-if="loading" />

    <template v-else>
      <!-- 首屏加载失败：持久错误态 + 重试，不落「还没有复盘邀约」空态 -->
      <div v-if="loadError" class="card flex items-center gap-2 text-xs text-correction dark:text-correction">
        <TriangleAlert :size="14" aria-hidden="true" class="shrink-0" />
        <span class="flex-1">{{ loadError }}</span>
        <button class="btn-ghost !text-xs shrink-0" @click="load">
          <RefreshCw :size="14" aria-hidden="true" />
          重试
        </button>
      </div>

      <!-- 新建邀约 -->
      <div v-else class="card space-y-2">
        <div class="text-sm font-semibold text-slate-700 dark:text-slate-200">新建复盘邀约</div>
        <div v-if="!partners.length" class="text-xs text-slate-400 dark:text-slate-500 text-center py-2">
          还没有搭子，先去<router-link to="/community/partners" class="text-action">搭子页</router-link>添加一位吧
        </div>
        <div v-else class="flex gap-2 flex-wrap">
          <select v-model="newPartner" aria-label="选择搭子" class="input !w-auto !text-xs">
            <option value="" disabled>选择搭子</option>
            <option v-for="p in partners" :key="p.userId" :value="p.userId">{{ p.userName }}</option>
          </select>
          <input
            v-model="newTime"
            aria-label="约定复盘时间"
            type="datetime-local"
            class="input flex-1 min-w-40 !text-xs"
          />
          <button class="btn-primary !text-xs shrink-0" :disabled="creating" @click="create">
            {{ creating ? '发送中…' : '发起邀约' }}
          </button>
        </div>
      </div>

      <!-- 邀约列表 -->
      <div v-if="!loadError" class="card space-y-2">
        <div class="text-sm font-semibold text-slate-700 dark:text-slate-200">我的邀约（{{ items.length }}）</div>
        <EmptyState v-if="!items.length" title="还没有复盘邀约，在上方发起一个吧" />
        <div
          v-for="r in items"
          :key="r.id"
          class="border-b border-slate-50 dark:border-slate-700 last:border-0 py-2 space-y-1.5 text-xs"
        >
          <div class="flex items-center gap-2 flex-wrap">
            <span class="font-medium">{{ r.partnerName }}</span>
            <span class="text-slate-400">{{ fmtTime(r.scheduledAt) }}</span>
            <span class="inline-flex items-center text-xs px-1.5 py-0.5 rounded-full" :class="STATUS[r.status].cls">
              {{ STATUS[r.status].text(r) }}
            </span>
            <span v-if="r.isFrom" class="text-xs text-slate-400">我发起的</span>
          </div>
          <div
            v-if="r.note && r.id !== completingId"
            class="text-xs text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-700/50 rounded-lg p-2 whitespace-pre-wrap"
          >
            复盘记录：{{ r.note }}
          </div>
          <div class="flex flex-wrap gap-1">
            <button
              v-if="!r.isFrom && r.status === 'pending'"
              class="btn-primary !text-xs"
              :disabled="acting[r.id]"
              @click="accept(r)"
            >
              {{ acting[r.id] ? '接受中…' : '接受' }}
            </button>
            <button
              v-if="r.status === 'accepted' && completingId !== r.id"
              class="btn-primary !text-xs"
              @click="openComplete(r)"
            >
              完成复盘
            </button>
            <button class="btn-ghost !text-xs" :disabled="acting[r.id]" @click="cancel(r)">取消</button>
          </div>
          <!-- 完成复盘：内联填写复盘记录 -->
          <div v-if="completingId === r.id" class="space-y-1.5">
            <textarea
              v-model="noteText"
              rows="3"
              class="input !text-xs"
              maxlength="500"
              aria-label="记录本次复盘的结论、问题与下一步计划…"
              placeholder="记录本次复盘的结论、问题与下一步计划…"
            ></textarea>
            <div class="flex gap-1 justify-end">
              <button class="btn-ghost !text-xs" @click="completingId = ''">取消</button>
              <button class="btn-primary !text-xs" :disabled="acting[r.id]" @click="complete(r)">
                {{ acting[r.id] ? '保存中…' : '提交复盘记录' }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
