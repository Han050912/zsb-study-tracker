<script setup lang="ts">
/**
 * 双人番茄自习室（开黑）—— 沉浸式全屏 + 番茄钟联动：
 * - 邀请开黑时设定专注/休息时长（默认 25/5，双方一致）
 * - 各自独立计时（本地番茄钟倒计时）：idle→focus→break→done 一轮
 * - 状态实时同步给对方（PUT + 5s 轮询）；专注完成计入各自番茄统计
 * - 沉浸式全屏：壁纸轮播（哲风壁纸，预加载成功才切换，失败渐变降级）+ 大号倒计时 + 底部自动隐藏按钮
 * - 强制约束：不做聊天界面，仅展示对方状态
 */
import { computed, inject, onMounted, onUnmounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { communityApi } from '../api/community'
import { API_BASE } from '../api/client'
import UserAvatar from '../components/community/UserAvatar.vue'
import { useBack } from '../composables/useBack'
import { useAppStore } from '../stores/app'
import type { PartnerItem, PartnerStudySession } from '../types'

type Phase = 'idle' | 'focus' | 'break' | 'done'

const route = useRoute()
const { goBack } = useBack()
const toast = inject<(m: string) => void>('toast', () => {})
const store = useAppStore()

const loading = ref(true)
const partners = ref<PartnerItem[]>([])
const selectedId = ref((route.query.partner as string) || '')
const focusMinutes = ref(25)
const breakMinutes = ref(5)
const creating = ref(false)
const session = ref<PartnerStudySession | null>(null)

// ---- 本地番茄钟（各自独立计时） ----
const phase = ref<Phase>('idle')
const seconds = ref(0)
const running = ref(false)
let handle: ReturnType<typeof setInterval> | null = null
let startTimestamp = 0
let pausedElapsed = 0

/** 已完成的累计专注分钟（focus 完成时累加并同步后端） */
const myMinutes = ref(0)

let pollTimer: ReturnType<typeof setInterval> | null = null

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

/** 当前阶段总秒数 */
const phaseSeconds = computed(() =>
  (phase.value === 'focus' ? session.value?.focusMinutes ?? 25 : session.value?.breakMinutes ?? 5) * 60)

/** 倒计时显示 */
const display = computed(() => {
  if (phase.value === 'idle') return `${String(session.value?.focusMinutes ?? 25).padStart(2, '0')}:00`
  if (phase.value === 'done') return '00:00'
  const remain = Math.max(0, phaseSeconds.value - seconds.value)
  return `${String(Math.floor(remain / 60)).padStart(2, '0')}:${String(remain % 60).padStart(2, '0')}`
})

const bothDone = computed(() => session.value?.myState === 'done' && session.value?.partnerState === 'done')

// ---- 番茄钟控制 ----
function tick() {
  seconds.value = pausedElapsed + Math.floor((Date.now() - startTimestamp) / 1000)
  if (seconds.value >= phaseSeconds.value) completePhase()
}

function stopTimer() {
  running.value = false
  if (handle) { clearInterval(handle); handle = null }
  pausedElapsed += Math.floor((Date.now() - startTimestamp) / 1000)
}

function beginTimer() {
  startTimestamp = Date.now()
  running.value = true
  handle = setInterval(tick, 1000)
}

/** idle→focus 开始 / 暂停后继续 */
async function start() {
  if (!session.value) return
  if (phase.value === 'idle') {
    phase.value = 'focus'
    seconds.value = 0
    pausedElapsed = 0
    beginTimer()
    await syncState('focus')
  } else {
    beginTimer()
  }
}

function pause() {
  stopTimer()
}

/** 阶段到时自动切换：focus→break（计入统计）→done */
async function completePhase() {
  stopTimer()
  if (!session.value) return
  if (phase.value === 'focus') {
    myMinutes.value += session.value.focusMinutes
    store.recordPomodoro(session.value.focusMinutes)
    toast('🍅 完成一个番茄钟！+5 积分')
    phase.value = 'break'
    seconds.value = 0
    pausedElapsed = 0
    beginTimer()
    await syncState('break')
  } else if (phase.value === 'break') {
    phase.value = 'done'
    seconds.value = 0
    pausedElapsed = 0
    await syncState('done')
  }
}

/** 同步我的状态与累计分钟到后端 */
async function syncState(state: Phase) {
  const s = session.value
  if (!s) return
  try {
    const res = await communityApi.updateStudySession(s.id, state, myMinutes.value)
    if (!session.value) return
    session.value.partnerState = res.session.partnerState
    session.value.partnerMinutes = res.session.partnerMinutes
    if (res.session.status === 'done') finishSession()
  } catch (e: any) {
    toast(e?.message || '同步失败')
  }
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
function enterSession(s: PartnerStudySession) {
  session.value = s
  myMinutes.value = s.myMinutes
  phase.value = s.myState
  seconds.value = 0
  pausedElapsed = 0
  running.value = false
  startBgRotation()
  // 进入自习室显示按钮，3 秒后自动隐藏
  controlsVisible.value = true
  if (hideControlsTimer) { clearTimeout(hideControlsTimer); hideControlsTimer = null }
  hideControlsTimer = setTimeout(() => { controlsVisible.value = false }, 3000)
}

async function loadPartners() {
  try {
    const res = await communityApi.partners()
    partners.value = res.partners
    if (selectedId.value && !res.partners.some(p => p.userId === selectedId.value)) selectedId.value = ''
  } catch (e: any) {
    toast(e?.message || '搭子列表加载失败')
  }
}

async function invite() {
  if (!selectedId.value || creating.value) return
  creating.value = true
  try {
    const res = await communityApi.createStudySession(selectedId.value, focusMinutes.value, breakMinutes.value)
    const detail = await communityApi.studySession(res.id)
    enterSession(detail.session)
    toast('自习室已创建，开始开黑吧！')
  } catch (e: any) {
    toast(e?.message || '创建失败')
  } finally {
    creating.value = false
  }
}

async function endSession() {
  const s = session.value
  if (!s) return
  if (!window.confirm('结束本次自习？双方将退出自习室。')) return
  stopTimer()
  try {
    await communityApi.endStudySession(s.id)
    finishSession()
    toast('自习已结束')
  } catch (e: any) {
    toast(e?.message || '操作失败')
  }
}

/** 会话结束：清理并回到选择视图 */
function finishSession() {
  stopTimer()
  stopBgRotation()
  session.value = null
  phase.value = 'idle'
  myMinutes.value = 0
  controlsVisible.value = true
  loadPartners()
}

/** 5s 轮询：同步对方状态与会话状态 */
async function poll() {
  if (!session.value) return
  try {
    const res = await communityApi.studySession(session.value.id)
    if (!session.value) return
    session.value.partnerState = res.session.partnerState
    session.value.partnerMinutes = res.session.partnerMinutes
    if (res.session.status === 'done') {
      finishSession()
      toast('自习已结束')
    }
  } catch { /* 轮询失败静默，下个周期重试 */ }
}

function handleVisibilityChange() {
  if (!document.hidden && running.value) tick()
}

onMounted(async () => {
  loading.value = true
  try {
    const res = await communityApi.activeStudySession()
    if (res.session) enterSession(res.session)
    else await loadPartners()
  } catch (e: any) {
    toast(e?.message || '加载失败')
  } finally {
    loading.value = false
  }
  pollTimer = setInterval(poll, 5000)
  document.addEventListener('visibilitychange', handleVisibilityChange)
  window.addEventListener('mousemove', handleMouseMove)
})

onUnmounted(() => {
  stopTimer()
  stopBgRotation()
  if (pollTimer) clearInterval(pollTimer)
  if (hideControlsTimer) clearTimeout(hideControlsTimer)
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  window.removeEventListener('mousemove', handleMouseMove)
})
</script>

<template>
  <!-- 无会话：卡片式选择搭子（非全屏） -->
  <div v-if="!session" class="max-w-2xl mx-auto px-4 py-6 space-y-5">
    <button class="btn-ghost !text-xs" @click="goBack">← 返回</button>
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
  </div>

  <!-- 自习室：沉浸式全屏 -->
  <div v-else
    class="min-h-screen relative flex flex-col items-center justify-center p-6 transition-colors duration-700 overflow-hidden"
    :class="bgUrl ? 'text-white' : phase === 'focus' ? 'bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-950 text-white' : phase === 'break' ? 'bg-gradient-to-br from-emerald-50 to-teal-100 dark:from-emerald-950 dark:to-teal-900' : 'bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-900 dark:to-slate-800 text-slate-800 dark:text-slate-100'">

    <!-- 壁纸 + 遮罩（加载失败时 bgUrl 为空，自动降级为上方渐变） -->
    <template v-if="bgUrl">
      <img :src="bgUrl" alt="" class="absolute inset-0 w-full h-full object-cover transition-opacity duration-1000" />
      <div class="absolute inset-0 bg-gradient-to-b from-black/55 via-black/35 to-black/60"></div>
    </template>

    <!-- 左上角：返回（不结束会话，稍后可继续） -->
    <button class="absolute top-4 left-4 z-10 text-sm opacity-60 hover:opacity-100" @click="goBack">← 返回</button>

    <!-- 右上角：对方状态（弱化展示，减少干扰） -->
    <div class="absolute top-4 right-4 z-10 flex items-center gap-2 opacity-90">
      <UserAvatar :name="session.partnerName" size="sm" />
      <div class="text-right">
        <div class="text-[11px] font-semibold leading-tight">{{ session.partnerName }}</div>
        <div class="text-[11px] leading-tight" :class="STATE_CLS[session.partnerState]">
          {{ STATE_TEXT[session.partnerState] }} · {{ session.partnerMinutes }}分
        </div>
      </div>
    </div>

    <!-- 中央：大号倒计时 -->
    <div class="absolute inset-x-0 top-1/4 px-6 text-center z-10">
      <div class="text-sm tracking-widest opacity-85" :class="bgUrl || phase === 'focus' ? '' : 'opacity-70'">{{ PHASE_TEXT[phase] }}</div>
      <div class="text-7xl md:text-9xl font-mono font-black tabular-nums tracking-wider drop-shadow-lg my-3">{{ display }}</div>
      <div class="text-sm opacity-70">与「{{ session.partnerName }}」开黑中 · 我的累计 {{ myMinutes }} 分钟</div>
      <div v-if="bothDone" class="mt-6 text-lg font-bold text-emerald-300">🎉 本次开黑完成，继续加油！</div>
    </div>

    <!-- 底部控制按钮（鼠标滑至底部唤起，3 秒无操作自动隐藏） -->
    <div
      class="absolute bottom-8 inset-x-0 flex flex-col items-center gap-3 px-6 z-10 transition-all duration-500 ease-out"
      :class="controlsVisible ? 'opacity-100 translate-y-0 pointer-events-auto' : 'opacity-0 translate-y-4 pointer-events-none'">
      <div class="flex gap-3 justify-center">
        <template v-if="phase !== 'done'">
          <button v-if="running" class="btn backdrop-blur px-6"
            :class="bgUrl || phase === 'focus' ? 'bg-white/20 text-white' : 'bg-black/5 text-inherit'" @click="pause">⏸ 暂停</button>
          <button v-else class="btn backdrop-blur px-6"
            :class="bgUrl || phase === 'focus' ? 'bg-white/20 text-white' : 'bg-black/5 text-inherit'" @click="start">
            {{ phase === 'idle' ? '开始专注' : '▶ 继续' }}
          </button>
        </template>
        <span v-else class="text-sm opacity-80 self-center">等待对方完成…</span>
        <button class="btn bg-red-500/80 text-white px-6" @click="endSession">结束自习</button>
      </div>
    </div>
  </div>
</template>
