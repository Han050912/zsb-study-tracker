<script setup lang="ts">
/**
 * 双人番茄自习室（开黑）—— 沉浸式全屏 + 番茄钟联动：
 * - 邀请开黑时设定专注/休息时长（默认 25/5，双方一致）
 * - 各自独立计时（本地番茄钟倒计时）：idle→focus→break→done 一轮
 * - 状态实时同步给对方（PUT + 5s 轮询）；专注完成计入各自番茄统计
 * - 沉浸式全屏：壁纸轮播（哲风壁纸，预加载成功才切换，失败渐变降级）+ 大号倒计时 + 底部自动隐藏按钮
 * - 强制约束：不做聊天界面，仅展示对方状态
 */
import { computed, inject, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, onBeforeRouteLeave } from 'vue-router'
import { storeToRefs } from 'pinia'
import dayjs from 'dayjs'
import { communityApi } from '../api/community'
import { API_BASE } from '../api/client'
import Modal from '../components/Modal.vue'
import UserAvatar from '../components/community/UserAvatar.vue'
import { useBack } from '../composables/useBack'
import { useStudyTimerStore } from '../stores/studyTimer'
import { formatMinutes } from '../utils/date'
import type { PartnerItem, PartnerStudyRecord } from '../types'

type Phase = 'idle' | 'focus' | 'break' | 'done'

const route = useRoute()
const { goBack } = useBack()
const toast = inject<(m: string) => void>('toast', () => {})

const loading = ref(true)
const partners = ref<PartnerItem[]>([])
const selectedId = ref((route.query.partner as string) || '')
const focusMinutes = ref(25)
const breakMinutes = ref(5)
const creating = ref(false)

const timer = useStudyTimerStore()
const { session, phase, running, myMinutes, onlineSeconds, display } = storeToRefs(timer)

// ---- 实时系统时钟 ----
const now = ref(new Date())
let clockHandle: ReturnType<typeof setInterval> | null = null
const clockText = computed(() => {
  const d = now.value
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map(n => String(n).padStart(2, '0')).join(':')
})
const dateText = computed(() => {
  const d = now.value
  const week = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()]
  return `${d.getMonth() + 1}月${d.getDate()}日 星期${week}`
})

// ---- 历史开黑记录 ----
const history = ref<PartnerStudyRecord[]>([])
const historyLoading = ref(false)

/** 在线秒数 → MM:SS / H:MM:SS（走表用） */
function formatDuration(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(r).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

/** Unix 秒 → MM-DD HH:mm（历史记录时间） */
function fmtDateTime(sec: number): string {
  return dayjs(sec * 1000).format('MM-DD HH:mm')
}

// ---- 壁纸轮播（复用番茄专注机制） ----
const bgUrl = ref('')
let bgTimer: ReturnType<typeof setInterval> | null = null

// ---- 控制按钮自动隐藏 ----
const controlsVisible = ref(true)
let hideControlsTimer: ReturnType<typeof setTimeout> | null = null

const PHASE_TEXT: Record<Phase, string> = { idle: '准备开始', focus: '专注中', break: '休息中', done: '已完成' }
const STATE_TEXT: Record<Phase, string> = { idle: '未开始', focus: '专注中', break: '休息中', done: '已完成' }
const STATE_CLS: Record<Phase, string> = {
  idle: 'opacity-70',
  focus: 'text-emerald-300',
  break: 'text-amber-300',
  done: 'text-emerald-400'
}

// ---- 壁纸轮播 ----
function fetchBackground() {
  const url = `${API_BASE}/api/proxy/wallpaper?r=${Date.now()}`
  const img = new Image()
  img.onload = () => { bgUrl.value = url }
  img.src = url
}
function startBgRotation() {
  if (bgTimer) return
  fetchBackground()
  bgTimer = setInterval(fetchBackground, 300_000)
}
function stopBgRotation() {
  if (bgTimer) { clearInterval(bgTimer); bgTimer = null }
  bgUrl.value = ''
}

// ---- 控制按钮自动隐藏 ----
function handleMouseMove(e: MouseEvent) {
  if (!session.value) return
  const threshold = 100
  if (e.clientY > window.innerHeight - threshold) {
    controlsVisible.value = true
    if (hideControlsTimer) { clearTimeout(hideControlsTimer); hideControlsTimer = null }
  } else if (controlsVisible.value) {
    if (!hideControlsTimer) hideControlsTimer = setTimeout(() => { controlsVisible.value = false }, 3000)
  }
}

// ---- 会话管理 ----
async function loadPartners() {
  try {
    const res = await communityApi.partners()
    partners.value = res.partners ?? []
    if (selectedId.value && !partners.value.some(p => p.userId === selectedId.value)) selectedId.value = ''
  } catch (e: any) {
    toast(e?.message || '搭子列表加载失败')
  }
}

async function loadHistory() {
  historyLoading.value = true
  try {
    const res = await communityApi.studyHistory()
    history.value = res.records ?? []
  } catch { /* 历史加载失败静默，不影响主流程 */ }
  finally { historyLoading.value = false }
}

async function invite() {
  if (!selectedId.value || creating.value) return
  creating.value = true
  try {
    const res = await communityApi.createStudySession(selectedId.value, focusMinutes.value, breakMinutes.value)
    const detail = await communityApi.studySession(res.id)
    if (!detail?.session) {
      toast('会话已创建，但获取详情失败，请返回后重试')
      await loadPartners()
      return
    }
    timer.enterSession(detail.session)
    toast('自习室已创建，开始开黑吧！')
  } catch (e: any) {
    toast(e?.message || '创建失败')
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

function handleEndBtn() {
  if (!window.confirm('结束本次自习？双方将退出自习室。')) return
  timer.endSession()
}

onMounted(() => {
  clockHandle = setInterval(() => { now.value = new Date() }, 1000)
  window.addEventListener('mousemove', handleMouseMove)
  init()
})

async function init() {
  if (timer.session) { loading.value = false; return }
  loading.value = true
  try {
    const res = await communityApi.activeStudySession()
    if (res.session) {
      timer.enterSession(res.session)
      if (timer.phase !== 'idle' && timer.phase !== 'done') {
        toast('计时已暂停，点击继续恢复')
      }
    } else {
      await loadPartners(); await loadHistory()
    }
  } catch (e: any) {
    toast(e?.message || '加载失败')
  } finally {
    loading.value = false
  }
}

onUnmounted(() => {
  stopBgRotation()
  if (clockHandle) clearInterval(clockHandle)
  if (hideControlsTimer) clearTimeout(hideControlsTimer)
  window.removeEventListener('mousemove', handleMouseMove)
})

watch(session, (v, old) => {
  if (v && !old) {
    startBgRotation()
    controlsVisible.value = true
    if (hideControlsTimer) { clearTimeout(hideControlsTimer); hideControlsTimer = null }
    hideControlsTimer = setTimeout(() => { controlsVisible.value = false }, 3000)
  } else if (!v && old) {
    loadPartners(); loadHistory()
  }
}, { immediate: true })

watch(() => timer.pomodoroCompleted, (v, old) => {
  if (v > old) toast('完成一个番茄钟！+5 积分')
})

// 双方均完成时庆祝（会话随即结束并退出沉浸视图，toast 全局可见）
watch(() => timer.sessionCompleted, (v, old) => {
  if (v > old) toast('本次开黑完成，继续加油！')
})
</script>

<template>
  <div class="min-h-screen">
  <!-- 无会话：卡片式选择搭子（非全屏） -->
  <div v-if="!session" class="max-w-2xl mx-auto px-4 py-6 space-y-5">
    <button class="btn-ghost !text-xs" @click="handleBack">← 返回</button>
    <div class="section-title !mb-0">开黑自习室</div>

    <div v-if="loading" class="text-center text-slate-400 dark:text-slate-500 text-xs py-10">加载中…</div>

    <div v-else class="card space-y-3">
      <div class="text-sm font-semibold text-slate-700 dark:text-slate-200">选择搭子，邀请一起开黑自习</div>
      <div v-if="!partners.length" class="text-xs text-slate-400 dark:text-slate-500 text-center py-4">
        还没有搭子，先去<router-link to="/community/partners" class="text-primary-500">搭子页</router-link>添加一位吧
      </div>
      <template v-else>
        <button v-for="p in partners" :key="p.userId"
          class="w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs transition-colors"
          :class="selectedId === p.userId
            ? 'bg-primary-50 dark:bg-primary-900/30 ring-1 ring-primary-200 dark:ring-primary-800'
            : 'hover:bg-slate-50 dark:hover:bg-slate-700'"
          @click="selectedId = p.userId">
          <UserAvatar :name="p.userName" :avatar="p.userAvatar" size="sm" />
          <span class="font-medium">{{ p.userName }}</span>
          <span v-if="selectedId === p.userId" class="ml-auto text-primary-500">✓</span>
        </button>
        <div class="grid grid-cols-2 gap-3 pt-1">
          <div><label class="label">专注（分钟）</label><input v-model.number="focusMinutes" type="number" min="1" max="120" class="input !text-xs" /></div>
          <div><label class="label">休息（分钟）</label><input v-model.number="breakMinutes" type="number" min="1" max="30" class="input !text-xs" /></div>
        </div>
        <button class="btn-primary w-full !text-xs" :disabled="!selectedId || creating" @click="invite">
          {{ creating ? '创建中…' : '邀请开黑' }}
        </button>
      </template>
    </div>

    <!-- 历史开黑记录 -->
    <div class="card space-y-3">
      <div class="text-sm font-semibold text-slate-700 dark:text-slate-200">历史开黑记录</div>
      <div v-if="historyLoading" class="text-xs text-slate-400 dark:text-slate-500 text-center py-3">加载中…</div>
      <div v-else-if="!history.length" class="text-xs text-slate-400 dark:text-slate-500 text-center py-4">还没有开黑记录</div>
      <template v-else>
        <div v-for="r in history" :key="r.id"
          class="flex items-center gap-2 py-2 border-t border-slate-100 dark:border-slate-700 first:border-t-0">
          <UserAvatar :name="r.partnerName" :avatar="r.partnerAvatar" size="sm" />
          <div class="flex-1 min-w-0">
            <div class="text-xs font-medium truncate">与「{{ r.partnerName }}」开黑</div>
            <div class="text-[11px] text-slate-400">{{ fmtDateTime(r.startedAt) }} ~ {{ fmtDateTime(r.endedAt) }}</div>
          </div>
          <div class="text-right text-[11px] text-slate-500 whitespace-nowrap">
            <div>我 {{ formatMinutes(Math.floor(r.myOnlineSeconds / 60)) }}</div>
            <div>对方 {{ formatMinutes(Math.floor(r.partnerOnlineSeconds / 60)) }}</div>
          </div>
        </div>
      </template>
    </div>
  </div>

  <!-- 自习室：沉浸式全屏 -->
  <div v-else
    class="min-h-screen relative flex flex-col items-center justify-center p-6 transition-colors duration-700 overflow-hidden"
    :class="bgUrl ? 'text-white' : phase === 'focus' ? 'bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-950 text-white' : phase === 'break' ? 'bg-gradient-to-br from-emerald-50 to-teal-100 dark:from-emerald-950 dark:to-teal-900' : 'bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-900 dark:to-slate-800 text-slate-800 dark:text-slate-100'">

    <!-- 壁纸 + 遮罩（加载失败时 bgUrl 为空，自动降级为上方渐变） -->
    <template v-if="bgUrl">
      <img :src="bgUrl" alt="" class="absolute inset-0 w-full h-full object-cover transition-opacity duration-1000 pointer-events-none" />
      <div class="absolute inset-0 bg-gradient-to-b from-black/55 via-black/35 to-black/60 pointer-events-none"></div>
    </template>

    <!-- 左上角：返回（不结束会话，稍后可继续） -->
    <button class="absolute top-4 left-4 z-10 text-sm opacity-60 hover:opacity-100" @click="handleBack">← 返回</button>

    <!-- 右上角：对方状态（弱化展示，减少干扰） -->
    <div class="absolute top-4 right-4 z-10 flex items-center gap-2 opacity-90">
      <UserAvatar :name="session.partnerName" :avatar="session.partnerAvatar" size="sm" />
      <div class="text-right">
        <div class="text-[11px] font-semibold leading-tight">{{ session.partnerName }}</div>
        <div class="text-[11px] leading-tight" :class="STATE_CLS[session.partnerState]">
          {{ STATE_TEXT[session.partnerState] }} · {{ formatDuration(session.partnerOnlineSeconds) }}
        </div>
      </div>
    </div>

    <!-- 中央：系统时钟 + 番茄倒计时 + 双方在线时长监督 -->
    <div class="absolute inset-x-0 top-[14%] px-6 text-center z-10">
      <div class="text-6xl md:text-8xl font-mono font-black tabular-nums tracking-wider drop-shadow-lg">{{ clockText }}</div>
      <div class="mt-1 text-sm opacity-70">{{ dateText }}</div>

      <div class="mt-6 text-sm tracking-widest opacity-85" :class="bgUrl || phase === 'focus' ? '' : 'opacity-70'">{{ PHASE_TEXT[phase] }}</div>
      <div class="text-4xl md:text-5xl font-mono font-bold tabular-nums tracking-wider my-2">{{ display }}</div>

      <div class="mt-6 flex items-center justify-center gap-6 text-sm">
        <div class="opacity-90">
          <div class="text-[11px] opacity-70">我的在线</div>
          <div class="font-mono font-bold tabular-nums text-xl">{{ formatDuration(onlineSeconds) }}</div>
        </div>
        <div class="opacity-50">·</div>
        <div class="opacity-90">
          <div class="text-[11px] opacity-70">{{ session.partnerName }}在线</div>
          <div class="font-mono font-bold tabular-nums text-xl">{{ formatDuration(session.partnerOnlineSeconds) }}</div>
        </div>
      </div>

      <div class="mt-2 text-xs opacity-70">与「{{ session.partnerName }}」开黑中 · 我的累计专注 {{ myMinutes }} 分钟</div>
    </div>

    <!-- 底部控制按钮（鼠标滑至底部唤起，3 秒无操作自动隐藏） -->
    <div
      class="absolute bottom-8 inset-x-0 flex flex-col items-center gap-3 px-6 z-10 transition-all duration-500 ease-out"
      :class="controlsVisible ? 'opacity-100 translate-y-0 pointer-events-auto' : 'opacity-0 translate-y-4 pointer-events-none'">
      <div class="flex gap-3 justify-center">
        <template v-if="phase !== 'done'">
          <button v-if="running" class="btn backdrop-blur px-6"
            :class="bgUrl || phase === 'focus' ? 'bg-white/20 text-white' : 'bg-black/5 text-inherit'" @click="timer.pause">⏸ 暂停</button>
          <button v-else class="btn backdrop-blur px-6"
            :class="bgUrl || phase === 'focus' ? 'bg-white/20 text-white' : 'bg-black/5 text-inherit'" @click="timer.start">
            ▶ 继续
          </button>
        </template>
        <span v-else class="text-sm opacity-80 self-center">等待对方完成…</span>
        <button class="btn bg-red-500/80 text-white px-6" @click="handleEndBtn">结束自习</button>
      </div>
    </div>
  </div>

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
  </div>
</template>
