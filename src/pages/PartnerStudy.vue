<script setup lang="ts">
/**
 * 双人番茄自习室（开黑）—— 沉浸式全屏 + 番茄钟联动：
 * - 邀请开黑时设定专注/休息时长（默认 25/5，双方一致）
 * - 各自独立计时（本地番茄钟倒计时）：idle→focus→break→done 一轮
 * - 状态实时同步给对方（PUT + 5s 轮询）；专注完成计入各自番茄统计
 * - 沉浸式全屏：壁纸轮播（哲风壁纸，预加载成功才切换，失败渐变降级）+ 大号倒计时 + 底部自动隐藏按钮
 * - 强制约束：不做聊天界面，仅展示对方状态
 * 视图拆分为 components/partner/ 下三个子组件；本页保留会话管理、返回拦截与弹窗编排
 */
import { onMounted, ref, watch } from 'vue'
import { getErrorMessage } from '../utils/error'
import { useToast } from '../composables/useToast'
import { useRoute, onBeforeRouteLeave } from 'vue-router'
import { storeToRefs } from 'pinia'
import { communityApi } from '../api/community'
import { RefreshCw, TriangleAlert } from '@lucide/vue'
import Modal from '../components/Modal.vue'
import PartnerPickerCard from '../components/partner/PartnerPickerCard.vue'
import PartnerStudyHistoryCard from '../components/partner/PartnerStudyHistoryCard.vue'
import PartnerStudyRoom from '../components/partner/PartnerStudyRoom.vue'
import { useBack } from '../composables/useBack'
import { useWallpaperRotation } from '../composables/useWallpaperRotation'
import { useStudyTimerStore } from '../stores/studyTimer'
import type { PartnerItem, PartnerStudyRecord } from '../types'

const route = useRoute()
const { goBack } = useBack()
const toast = useToast()

const loading = ref(true)
const partners = ref<PartnerItem[]>([])
const selectedId = ref((route.query.partner as string) || '')
const focusMinutes = ref(25)
const mode = ref<'countdown' | 'countup'>('countdown')
const creating = ref(false)

const timer = useStudyTimerStore()
const { session, running, pendingChoice } = storeToRefs(timer)

// ---- 壁纸轮播（与番茄专注共用，见 useWallpaperRotation）；bgUrl 传给自习室全屏视图 ----
const { bgUrl, startBgRotation } = useWallpaperRotation()

// ---- 历史开黑记录 ----
const history = ref<PartnerStudyRecord[]>([])
const historyLoading = ref(false)
/** 历史记录加载失败信息：持久错误态（区别于「还没有开黑记录」空态），提供重试 */
const historyError = ref('')

// ---- 会话管理 ----
async function loadPartners() {
  try {
    const res = await communityApi.partners()
    partners.value = res.partners ?? []
    if (selectedId.value && !partners.value.some((p) => p.userId === selectedId.value)) selectedId.value = ''
  } catch (e) {
    toast(getErrorMessage(e, '搭子列表加载失败'))
  }
}

async function loadHistory() {
  historyLoading.value = true
  historyError.value = ''
  try {
    const res = await communityApi.studyHistory()
    history.value = res.records ?? []
  } catch (e) {
    historyError.value = getErrorMessage(e, '历史记录加载失败')
    toast(historyError.value)
  } finally {
    historyLoading.value = false
  }
}

async function invite() {
  if (!selectedId.value || creating.value) return
  creating.value = true
  try {
    const res = await communityApi.createStudySession(
      selectedId.value,
      mode.value,
      mode.value === 'countdown' ? focusMinutes.value : undefined
    )
    const detail = await communityApi.studySession(res.id)
    if (!detail?.session) {
      toast('会话已创建，但获取详情失败，请返回后重试')
      await loadPartners()
      return
    }
    timer.enterSession(detail.session)
    toast('自习室已创建，开始开黑吧！')
  } catch (e) {
    toast(getErrorMessage(e, '创建失败'))
  } finally {
    creating.value = false
  }
}

// ---- 返回拦截 ----
const exitDialog = ref<'none' | 'main' | 'bg'>('none')
let allowLeave = false

function handleBack() {
  if (running.value) {
    exitDialog.value = 'main'
  } else {
    goBack()
  }
}

onBeforeRouteLeave(() => {
  if (running.value && !allowLeave) {
    exitDialog.value = 'main'
    return false
  }
  allowLeave = false
  return true
})

function chooseEnd() {
  exitDialog.value = 'none'
  allowLeave = true
  timer.endSession().finally(() => goBack())
}

function chooseReturn() {
  exitDialog.value = 'bg'
}

function chooseContinue() {
  exitDialog.value = 'none'
  allowLeave = true
  goBack()
}

function choosePause() {
  exitDialog.value = 'none'
  allowLeave = true
  timer.pause().finally(() => goBack())
}

onMounted(() => {
  init()
})

async function init() {
  if (timer.session) {
    loading.value = false
    return
  }
  loading.value = true
  try {
    const res = await communityApi.activeStudySession()
    if (res.session) {
      timer.enterSession(res.session)
      if (timer.phase !== 'idle' && timer.phase !== 'done') {
        toast('计时已暂停，点击继续恢复')
      }
    } else {
      await loadPartners()
      await loadHistory()
    }
  } catch (e) {
    toast(getErrorMessage(e, '加载失败'))
  } finally {
    loading.value = false
  }
}

// 进入会话启动壁纸轮播（控制条初始化由自习室组件挂载时完成）；会话结束回到选择页时刷新搭子/历史列表
watch(
  session,
  (v, old) => {
    if (v && !old) {
      startBgRotation()
    } else if (!v && old) {
      loadPartners()
      loadHistory()
    }
  },
  { immediate: true }
)

watch(
  () => timer.pomodoroCompleted,
  (v, old) => {
    if (v > old) toast('完成一个番茄钟！+5 积分')
  }
)

// 双方均完成时庆祝（会话随即结束并退出沉浸视图，toast 全局可见）
watch(
  () => timer.sessionCompleted,
  (v, old) => {
    if (v > old) toast('本次开黑完成，继续加油！')
  }
)
</script>

<template>
  <div class="min-h-screen">
    <!-- 无会话：卡片式选择搭子（非全屏） -->
    <div v-if="!session" class="max-w-2xl mx-auto px-4 py-6 space-y-5">
      <button class="btn-ghost !text-xs" @click="handleBack">← 返回</button>
      <div class="section-title !mb-0">开黑自习室</div>

      <div v-if="loading" class="text-center text-slate-400 dark:text-slate-500 text-xs py-10">加载中…</div>
      <PartnerPickerCard
        v-else
        v-model:selected-id="selectedId"
        v-model:mode="mode"
        v-model:focus-minutes="focusMinutes"
        :partners="partners"
        :creating="creating"
        @invite="invite"
      />

      <!-- 历史开黑记录（加载失败：持久错误态 + 重试，不落「还没有开黑记录」空态） -->
      <div v-if="historyError" class="card space-y-2">
        <div class="text-sm font-semibold text-slate-700 dark:text-slate-200">历史开黑记录</div>
        <div class="flex items-center gap-2 text-xs text-red-500 dark:text-red-400">
          <TriangleAlert :size="14" aria-hidden="true" class="shrink-0" />
          <span class="flex-1">{{ historyError }}</span>
          <button class="btn-ghost !text-xs shrink-0" @click="loadHistory">
            <RefreshCw :size="14" aria-hidden="true" />
            重试
          </button>
        </div>
      </div>
      <PartnerStudyHistoryCard v-else :records="history" :loading="historyLoading" />
    </div>

    <!-- 自习室：沉浸式全屏 -->
    <PartnerStudyRoom v-else :bg-url="bgUrl" @back="handleBack" />

    <!-- 返回拦截弹窗① -->
    <Modal :show="exitDialog === 'main'" title="离开将中断计时" @close="exitDialog = 'none'">
      <p class="text-sm text-slate-600 dark:text-slate-300">离开后计时将中断，请选择处理方式。</p>
      <template #footer>
        <button class="btn !px-4 text-sm" @click="chooseEnd">结束自习</button>
        <button class="btn btn-primary !px-4 text-sm" @click="chooseReturn">返回页面</button>
      </template>
    </Modal>

    <!-- 返回拦截弹窗② -->
    <Modal :show="exitDialog === 'bg'" title="计时方案" @close="exitDialog = 'none'">
      <p class="text-sm text-slate-600 dark:text-slate-300">返回页面后，是否后台继续计时？</p>
      <template #footer>
        <button class="btn !px-4 text-sm" @click="choosePause">否，暂停计时</button>
        <button class="btn btn-primary !px-4 text-sm" @click="chooseContinue">是，后台继续计时</button>
      </template>
    </Modal>

    <!-- 搭子未进入弹窗 -->
    <Modal :show="pendingChoice === 'partner_idle'" title="搭子还未进入" @close="timer.waitForPartner()">
      <p class="text-sm text-slate-600 dark:text-slate-300">你已完成专注，但搭子还未进入自习室。</p>
      <template #footer>
        <button class="btn btn-primary !px-4 text-sm" @click="timer.waitForPartner()">继续等待</button>
        <button class="btn !px-4 text-sm" @click="timer.endSession()">结束本次自习</button>
      </template>
    </Modal>

    <!-- 搭子仍专注弹窗 -->
    <Modal :show="pendingChoice === 'partner_focus'" title="你已完成专注" @close="timer.waitForPartner()">
      <p class="text-sm text-slate-600 dark:text-slate-300">搭子还在专注中，是否等待？</p>
      <template #footer>
        <button class="btn btn-primary !px-4 text-sm" @click="timer.waitForPartner()">等待对方完成</button>
        <button class="btn !px-4 text-sm" @click="timer.leaveSession().finally(() => goBack())">先行离开</button>
      </template>
    </Modal>
  </div>
</template>
