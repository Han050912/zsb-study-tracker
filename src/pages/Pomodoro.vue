<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { onBeforeRouteLeave, useRouter } from 'vue-router'
import { Ban } from '@lucide/vue'
import { useClock } from '../composables/useClock'
import { useToast } from '../composables/useToast'
import { useWallpaperRotation } from '../composables/useWallpaperRotation'
import dayjs from 'dayjs'
import { useAppStore } from '../stores/app'
import { useStudyTimerStore } from '../stores/studyTimer'
import { communityApi } from '../api/community'
import { businessDate, formatMinutes } from '../utils/date'
import Modal from '../components/Modal.vue'
import type { PomodoroRecord } from '../types'

const store = useAppStore()
const toast = useToast()
const router = useRouter()

// ---- 与开黑自习室互斥 ----
const studyTimer = useStudyTimerStore()
/** 服务端存在进行中的开黑会话：互斥判定的真实来源（studyTimer.session 是纯内存态，刷新 / 新标签页即丢失） */
const serverPartyActive = ref(false)
/** 开黑自习室存在进行中的会话：内存态（同标签页内跳转即时生效）或服务端态（刷新 / 新标签页）任一命中即占用。
 *  与其同时计时会把同一时段重复计入专注时长，因此这里是全局唯一的互斥判定口径。 */
const partyActive = computed(() => !!studyTimer.session || serverPartyActive.value)

/** 回源服务端确认是否已有进行中的开黑会话（挂载时调用，用于补上刷新后内存态丢失的判定缺口） */
async function syncPartyActive() {
  try {
    serverPartyActive.value = !!(await communityApi.activeStudySession()).session
  } catch {
    /* 查询失败按无开黑处理：不因网络异常阻断单人番茄；同标签页内仍由 studyTimer.session 兜底 */
  }
}

// ---- 模式与时长 ----
const mode = ref<'countdown' | 'countup'>('countdown')
const focusMinutes = ref(25)
const breakMinutes = ref(5)
const phase = ref<'idle' | 'focus' | 'break'>('idle')
const seconds = ref(0)
const running = ref(false)
let handle: ReturnType<typeof setInterval> | null = null
/** 当前计时段的起始时间戳（Date.now()），暂停后重新赋值 */
let startTimestamp = 0
/** 暂停前已累计的秒数，恢复计时后与新的时间差累加 */
let pausedElapsed = 0
/** 本次专注的任务描述（选填，maxlength 50）；开始番茄时捕获锁定 */
const taskDescription = ref('')
/** 当前番茄锁定后的描述快照（开始后修改输入框不影响本番茄） */
let activeDescription = ''

// ---- 单人专注持久化：刷新 / 误导航后按墙钟续算恢复未结束的专注 ----
/** 本地存储键（只存一条进行中的会话，正常结束 / 放弃即清理） */
const SOLO_STATE_KEY = 'zsb-pomodoro-solo-v1'
/** 僵尸状态上限：落盘时间或续算出的时长超过该值一律视为过期残留，直接清理不恢复 */
const MAX_SOLO_STALE_MS = 4 * 60 * 60 * 1000

/** 落盘的单人专注状态（与组件内计时变量一一对应） */
interface PersistedSoloState {
  phase: 'focus' | 'break'
  mode: 'countdown' | 'countup'
  focusMinutes: number
  breakMinutes: number
  /** 当前阶段已累计秒数（不含正在跑的当前段，语义同 pausedElapsed） */
  pausedElapsed: number
  /** 当前段是否正在计时 */
  running: boolean
  /** 正在计时段的起始时间戳（running 时有效），用于恢复后按真实时间续算 */
  startTimestamp: number
  /** 本次专注锁定的任务描述快照 */
  activeDescription: string
  /** 落盘时刻 */
  savedAt: number
}

/** 恢复时的数值兜底：非有限数 / 非正数回退默认值（防御被改坏的存储内容） */
function positiveOr(v: unknown, dflt: number) {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : dflt
}

function clearSoloState() {
  try {
    localStorage.removeItem(SOLO_STATE_KEY)
  } catch {
    /* 存储不可用时忽略 */
  }
}

/** 落盘当前专注状态；已回到配置页（idle）则清理，避免残留 */
function syncSoloState() {
  if (phase.value === 'idle') {
    clearSoloState()
    return
  }
  const state: PersistedSoloState = {
    phase: phase.value,
    mode: mode.value,
    focusMinutes: focusMinutes.value,
    breakMinutes: breakMinutes.value,
    pausedElapsed,
    running: running.value,
    startTimestamp,
    activeDescription,
    savedAt: Date.now()
  }
  try {
    localStorage.setItem(SOLO_STATE_KEY, JSON.stringify(state))
  } catch {
    /* 存储满 / 被禁用时静默降级为仅内存计时 */
  }
}

/** 恢复未结束的专注；结构非法或已过期残留则清理 */
function restoreSoloState() {
  let raw: string | null
  try {
    raw = localStorage.getItem(SOLO_STATE_KEY)
  } catch {
    return
  }
  if (!raw) return
  let saved: PersistedSoloState
  try {
    saved = JSON.parse(raw) as PersistedSoloState
  } catch {
    clearSoloState()
    return
  }
  if (saved.phase !== 'focus' && saved.phase !== 'break') {
    clearSoloState()
    return
  }
  // 互斥优先：开黑会话进行中不恢复单人计时（partyActive 含服务端会话，刷新后同样生效；
  // 保留落盘状态，开黑结束后仍可恢复）
  if (partyActive.value) return
  const runningElapsed = saved.running ? Math.floor((Date.now() - saved.startTimestamp) / 1000) : 0
  const elapsed = saved.pausedElapsed + runningElapsed
  if (Date.now() - saved.savedAt > MAX_SOLO_STALE_MS || elapsed * 1000 > MAX_SOLO_STALE_MS) {
    clearSoloState()
    return
  }
  mode.value = saved.mode === 'countup' ? 'countup' : 'countdown'
  focusMinutes.value = positiveOr(saved.focusMinutes, 25)
  breakMinutes.value = positiveOr(saved.breakMinutes, 5)
  phase.value = saved.phase
  activeDescription = saved.activeDescription || ''
  taskDescription.value = activeDescription
  pausedElapsed = Number.isFinite(saved.pausedElapsed) && saved.pausedElapsed > 0 ? Math.floor(saved.pausedElapsed) : 0
  if (saved.running) {
    startTimestamp = saved.startTimestamp
    running.value = true
    handle = setInterval(tick, 1000)
    // 立即按真实时间续算；若倒计时已越过终点，tick 会直接结算并进入下一阶段
    tick()
  } else {
    seconds.value = pausedElapsed
  }
  // 恢复出来必然处于专注 / 休息阶段：开启壁纸轮播并短暂显示控制按钮
  startBgRotation()
  scheduleControlsHide(3000)
}

// ---- 控制按钮自动隐藏 ----
const controlsVisible = ref(true)
let hideControlsTimer: ReturnType<typeof setTimeout> | null = null

/** 显示控制按钮并在 ms 毫秒后自动隐藏（鼠标滑到页面底部会重新唤起） */
function scheduleControlsHide(ms: number) {
  controlsVisible.value = true
  if (hideControlsTimer) clearTimeout(hideControlsTimer)
  hideControlsTimer = setTimeout(() => {
    controlsVisible.value = false
  }, ms)
}

function handleMouseMove(e: MouseEvent) {
  // 配置页始终显示按钮
  if (phase.value === 'idle') {
    controlsVisible.value = true
    return
  }
  const threshold = 100
  if (e.clientY > window.innerHeight - threshold) {
    // 鼠标在底部区域：显示按钮并取消隐藏定时器
    controlsVisible.value = true
    if (hideControlsTimer) {
      clearTimeout(hideControlsTimer)
      hideControlsTimer = null
    }
  } else if (controlsVisible.value) {
    // 鼠标离开底部区域：启动 3 秒后隐藏
    if (!hideControlsTimer) {
      hideControlsTimer = setTimeout(() => {
        controlsVisible.value = false
      }, 3000)
    }
  }
}

const display = computed(() => {
  const s =
    mode.value === 'countdown' && phase.value !== 'idle'
      ? Math.max(0, (phase.value === 'focus' ? focusMinutes.value : breakMinutes.value) * 60 - seconds.value)
      : seconds.value
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
})

/** 基于时间戳计算已流逝秒数，后台节流/休眠后恢复也能得到准确值 */
function tick() {
  seconds.value = pausedElapsed + Math.floor((Date.now() - startTimestamp) / 1000)
  if (mode.value === 'countdown') {
    const total = (phase.value === 'focus' ? focusMinutes.value : breakMinutes.value) * 60
    if (seconds.value >= total) completePhase()
  }
}

/**
 * 停止计时器并将当前段的时间累加到 pausedElapsed（纯计时操作，无 UI 副作用）。
 * 已暂停时为无操作：重复调用不会把暂停等待的墙钟时间再累加一次。
 */
function stopTimer() {
  if (!running.value) return
  running.value = false
  if (handle) {
    clearInterval(handle)
    handle = null
  }
  pausedElapsed += Math.floor((Date.now() - startTimestamp) / 1000)
}

/** 页面从后台恢复可见时立即校准计时显示，并检查是否已到达结束时间 */
function handleVisibilityChange() {
  if (!document.hidden && running.value) tick()
}

function start() {
  // 与开黑自习室互斥（partyActive 单一口径：内存态或服务端态命中即拒绝）
  if (partyActive.value) {
    toast('开黑自习室计时进行中，请先结束开黑再开始单人番茄')
    return
  }
  if (phase.value === 'idle') {
    phase.value = 'focus'
    activeDescription = taskDescription.value.trim().slice(0, 50)
    seconds.value = 0
    pausedElapsed = 0
    document.documentElement.requestFullscreen?.().catch(() => {})
    startBgRotation()
  }
  startTimestamp = Date.now()
  running.value = true
  handle = setInterval(tick, 1000)
  scheduleControlsHide(3000)
  syncSoloState()
}

function pause() {
  stopTimer()
  // 暂停时保持按钮可见更久，方便用户看到「继续」按钮
  scheduleControlsHide(8000)
  syncSoloState()
}

function completePhase() {
  stopTimer()
  if (phase.value === 'focus') {
    store.recordPomodoro(focusMinutes.value, activeDescription)
    toast(`完成一个番茄钟！+5 积分`)
    phase.value = 'break'
    seconds.value = 0
    pausedElapsed = 0
    if (mode.value === 'countdown') {
      startTimestamp = Date.now()
      running.value = true
      handle = setInterval(tick, 1000)
    }
  } else {
    phase.value = 'idle'
    seconds.value = 0
    pausedElapsed = 0
    stopBgRotation()
    toast('休息结束，继续加油！')
  }
  syncSoloState()
}

/** 结束本次专注：以真实已用时长结算（stopTimer 会把在跑的当前段折算进 pausedElapsed，暂停等待不计入） */
function giveUp() {
  stopTimer()
  const elapsed = pausedElapsed
  if (phase.value === 'focus') {
    const minutes = Math.round(elapsed / 60)
    // 达标口径：正计时以「结束」为完成；倒计时须已累计到设定时长。未达标只记真实时长，不发完成奖励
    const completed = mode.value === 'countup' || elapsed >= focusMinutes.value * 60
    if (minutes >= 1) {
      store.recordPomodoro(minutes, activeDescription, 'solo', undefined, completed)
      toast(
        completed
          ? '完成一个番茄钟！+5 积分'
          : `已记录 ${minutes} 分钟专注（未满 ${focusMinutes.value} 分钟，不计入完成番茄）`
      )
    }
  }
  phase.value = 'idle'
  seconds.value = 0
  pausedElapsed = 0
  stopBgRotation()
  document.exitFullscreen?.().catch(() => {})
  syncSoloState()
}

// ---- 中断记录 ----
const showInterrupt = ref(false)
const interruptReason = ref('')
function submitInterrupt() {
  if (!interruptReason.value.trim()) return
  store.recordInterruption(interruptReason.value.trim())
  interruptReason.value = ''
  showInterrupt.value = false
  toast('已记录中断')
}

// ---- 背景图（进入专注全屏后开启壁纸轮播，实现见 useWallpaperRotation） ----
const { bgUrl, startBgRotation, stopBgRotation } = useWallpaperRotation()

// ---- 实时时钟 ----
const { now, clockText, dateText } = useClock()

// ---- 随机名人名言 ----
const FAMOUS_QUOTES = [
  { text: '书山有路勤为径，学海无涯苦作舟。', author: '韩愈' },
  { text: '天才是百分之一的灵感，加百分之九十九的汗水。', author: '爱迪生' },
  { text: '不积跬步，无以至千里；不积小流，无以成江海。', author: '荀子' },
  { text: '业精于勤，荒于嬉；行成于思，毁于随。', author: '韩愈' },
  { text: '路漫漫其修远兮，吾将上下而求索。', author: '屈原' },
  { text: '宝剑锋从磨砺出，梅花香自苦寒来。', author: '《警世贤文》' },
  { text: '学而不思则罔，思而不学则殆。', author: '孔子' },
  { text: '只要功夫深，铁杵磨成针。', author: '祝穆' },
  { text: '长风破浪会有时，直挂云帆济沧海。', author: '李白' },
  { text: '千淘万漉虽辛苦，吹尽狂沙始到金。', author: '刘禹锡' },
  { text: '博观而约取，厚积而薄发。', author: '苏轼' },
  { text: '古之立大事者，不惟有超世之才，亦必有坚忍不拔之志。', author: '苏轼' }
]
const quote = ref(FAMOUS_QUOTES[0])
let lastQuoteIdx = -1
function randomQuote() {
  // 用户自定义名言也并入候选池
  const pool = [...FAMOUS_QUOTES, ...store.settings.quotes.map((q) => ({ text: q, author: '' }))]
  let idx = Math.floor(Math.random() * pool.length)
  if (pool.length > 1) {
    while (idx === lastQuoteIdx) idx = Math.floor(Math.random() * pool.length)
  }
  lastQuoteIdx = idx
  quote.value = pool[idx]
}

// ---- 离开拦截：未结束的专注需用户确认（状态已落盘，返回本页可继续） ----
const showLeaveDialog = ref(false)
let allowLeave = false
let pendingLeavePath = ''

onBeforeRouteLeave((to) => {
  if (phase.value === 'idle' || allowLeave) {
    allowLeave = false
    return true
  }
  pendingLeavePath = to.fullPath
  showLeaveDialog.value = true
  return false
})

/** 确认离开：计时按真实时间继续累计（已落盘），返回番茄钟页面即可恢复 */
function confirmLeave() {
  showLeaveDialog.value = false
  const path = pendingLeavePath
  pendingLeavePath = ''
  if (!path) return
  allowLeave = true
  router.push(path)
}

function cancelLeave() {
  showLeaveDialog.value = false
  pendingLeavePath = ''
}

/** 刷新 / 关闭页面前的拦截提示：状态已落盘，重新打开可恢复 */
function handleBeforeUnload(e: BeforeUnloadEvent) {
  if (phase.value === 'idle') return
  e.preventDefault()
  e.returnValue = ''
}

onMounted(async () => {
  randomQuote()
  window.addEventListener('mousemove', handleMouseMove)
  window.addEventListener('beforeunload', handleBeforeUnload)
  document.addEventListener('visibilitychange', handleVisibilityChange)
  // 互斥优先：先回源服务端确认开黑会话，再决定是否恢复本地单人专注
  // （否则刷新后内存态丢失，会与仍在服务端进行中的开黑会话同时计时、重复计入专注时长）
  await syncPartyActive()
  restoreSoloState()
})
onUnmounted(() => {
  stopTimer()
  if (hideControlsTimer) clearTimeout(hideControlsTimer)
  window.removeEventListener('mousemove', handleMouseMove)
  window.removeEventListener('beforeunload', handleBeforeUnload)
  document.removeEventListener('visibilitychange', handleVisibilityChange)
})

const recentInterruptions = computed(() => store.pomodoro.interruptions.slice(-5).reverse())

// ---- 最近完成：今日番茄明细 ----
/** 响应式今日键：随实时时钟每秒更新，跨 00:00 后列表与编辑守卫自动切换到新的一天（UTC+8 业务日，不随系统时区） */
const todayKey = computed(() => businessDate(now.value.getTime()))
const todayRecordsSorted = computed(() =>
  (store.pomodoro.records || []).filter((r) => r.date === todayKey.value).sort((a, b) => b.time - a.time)
)
const editingId = ref('')
const editingText = ref('')

function fmtClock(t: number) {
  return dayjs(t).format('HH:mm')
}

/** 编辑输入框挂载后自动聚焦并全选（与 SubjectPanel 行内改名一致，避免 autofocus 失效导致行卡在编辑态） */
const vFocus = {
  mounted: (el: HTMLInputElement) => {
    el.focus()
    el.select()
  }
}

function startEdit(r: PomodoroRecord) {
  if (editingId.value === r.id) return
  if (r.date !== todayKey.value) return
  editingId.value = r.id
  editingText.value = r.description
}

/** 中文输入法回车选词不结束编辑：isComposing / keyCode 229 时直接忽略 */
function onEditEnter(e: KeyboardEvent) {
  if (e.isComposing || e.keyCode === 229) return
  saveEdit()
}
function saveEdit() {
  if (editingId.value) store.updatePomodoroRecordDescription(editingId.value, editingText.value)
  editingId.value = ''
}
function cancelEdit() {
  editingId.value = ''
}
</script>

<template>
  <div
    class="min-h-screen relative flex flex-col items-center justify-center p-6 transition-colors duration-700 overflow-hidden"
    :class="
      bgUrl
        ? 'text-white'
        : phase === 'focus'
          ? 'bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-950 text-white'
          : phase === 'break'
            ? 'bg-gradient-to-br from-emerald-50 to-teal-100 dark:from-emerald-950 dark:to-teal-900'
            : ''
    "
  >
    <!-- 背景图 + 遮罩（图片加载失败时 bgUrl 为空，自动降级为上方渐变） -->
    <template v-if="bgUrl">
      <img :src="bgUrl" alt="" class="absolute inset-0 w-full h-full object-cover transition-opacity duration-1000" />
      <div class="absolute inset-0 bg-gradient-to-b from-black/55 via-black/35 to-black/60"></div>
    </template>

    <!-- 返回入口仅在配置页展示；专注计时中隐藏，保持界面零导航干扰 -->
    <RouterLink v-if="phase === 'idle'" to="/" class="absolute top-4 left-4 z-10 text-sm opacity-60 hover:opacity-100"
      >← 返回首页</RouterLink
    >

    <!-- 实时时钟（右上角，仅配置页展示） -->
    <div v-if="phase === 'idle'" class="absolute top-4 right-4 z-10 text-right">
      <div class="text-2xl font-mono font-bold tabular-nums tracking-wider">{{ clockText }}</div>
      <div class="text-[11px] opacity-70">{{ dateText }}</div>
    </div>

    <!-- 配置 -->
    <div v-if="phase === 'idle'" class="relative z-10 w-full max-w-md space-y-4">
      <h1 class="text-2xl font-bold text-center">番茄专注</h1>
      <div class="card space-y-3">
        <div class="flex gap-2">
          <button
            class="flex-1 btn"
            :class="mode === 'countdown' ? 'bg-primary-500 text-white' : 'bg-slate-100 dark:bg-slate-700'"
            @click="mode = 'countdown'"
          >
            倒计时
          </button>
          <button
            class="flex-1 btn"
            :class="mode === 'countup' ? 'bg-primary-500 text-white' : 'bg-slate-100 dark:bg-slate-700'"
            @click="mode = 'countup'"
          >
            正计时
          </button>
        </div>
        <div v-if="mode === 'countdown'" class="grid grid-cols-2 gap-3">
          <div>
            <label class="label" for="pomo-focus-minutes">专注（分钟）</label
            ><input
              id="pomo-focus-minutes"
              v-model.number="focusMinutes"
              type="number"
              min="1"
              max="120"
              class="input"
            />
          </div>
          <div>
            <label class="label" for="pomo-break-minutes">休息（分钟）</label
            ><input
              id="pomo-break-minutes"
              v-model.number="breakMinutes"
              type="number"
              min="1"
              max="30"
              class="input"
            />
          </div>
        </div>
        <div>
          <label class="label" for="pomo-task">任务描述（选填）</label>
          <input
            id="pomo-task"
            v-model="taskDescription"
            maxlength="50"
            class="input"
            placeholder="本次专注的任务，如：复习高数第三章"
          />
        </div>
        <button
          class="btn-primary w-full !py-3 text-base disabled:opacity-50 disabled:cursor-not-allowed"
          :disabled="partyActive"
          @click="start"
        >
          开始专注
        </button>
        <!-- 与开黑自习室互斥：有进行中的会话时禁止启动单人番茄 -->
        <p v-if="partyActive" class="flex items-start gap-1.5 text-xs text-amber-500">
          <Ban :size="14" class="mt-px shrink-0" aria-hidden="true" />
          <span>开黑自习室计时进行中，需先结束开黑会话才能开始单人番茄（避免同一时段重复计入专注）</span>
        </p>
      </div>

      <!-- 名言点缀 -->
      <div class="text-center cursor-pointer select-none" title="点击换一句" @click="randomQuote">
        <p class="text-xs italic text-slate-400">「{{ quote.text }}」</p>
        <p v-if="quote.author" class="text-[10px] mt-0.5 text-slate-300 dark:text-slate-500">—— {{ quote.author }}</p>
      </div>

      <!-- 统计 -->
      <div class="grid grid-cols-3 gap-3">
        <div class="card !p-3 text-center">
          <div class="text-xl font-black text-primary-500">{{ store.todayPomodoro.count }}</div>
          <div class="text-[11px] text-slate-400">今日番茄</div>
        </div>
        <div class="card !p-3 text-center">
          <div class="text-xl font-black text-primary-500">{{ formatMinutes(store.todayPomodoro.minutes) }}</div>
          <div class="text-[11px] text-slate-400">今日专注</div>
        </div>
        <div class="card !p-3 text-center">
          <div class="text-xl font-black text-primary-500">
            {{
              store.todayPomodoro.count ? (store.todayPomodoro.minutes / store.todayPomodoro.count).toFixed(1) : '0.0'
            }}分
          </div>
          <div class="text-[11px] text-slate-400">平均时长</div>
        </div>
      </div>

      <!-- 最近完成：今日番茄明细（独立板块，位于最近中断上方） -->
      <div class="card">
        <div class="section-title">最近完成（{{ todayRecordsSorted.length }} 个/今日）</div>
        <div v-if="!todayRecordsSorted.length" class="text-xs text-slate-400 dark:text-slate-500 text-center py-3">
          今日还没有完成的番茄
        </div>
        <div v-else class="max-h-48 overflow-y-auto">
          <div
            v-for="r in todayRecordsSorted"
            :key="r.id"
            class="text-xs py-1.5 flex items-center gap-2 text-slate-500 border-t border-slate-100 dark:border-slate-700 first:border-t-0 cursor-default"
            @dblclick="startEdit(r)"
          >
            <template v-if="editingId === r.id">
              <input
                v-model="editingText"
                v-focus
                maxlength="50"
                class="input !py-1 !text-xs flex-1"
                @dblclick.stop
                @keydown.enter="onEditEnter"
                @keyup.esc="cancelEdit"
                @blur="saveEdit"
              />
            </template>
            <template v-else>
              <span class="opacity-60 whitespace-nowrap">{{ fmtClock(r.time) }}</span>
              <span class="flex-1 truncate" :class="r.description ? '' : 'italic opacity-50'">{{
                r.description || '未命名'
              }}</span>
              <span
                v-if="r.source === 'party'"
                class="px-1.5 py-0.5 rounded-full bg-primary-50 dark:bg-primary-900/40 text-primary-500 text-[10px] whitespace-nowrap"
                >开黑·{{ r.partnerName }}</span
              >
              <span class="whitespace-nowrap">{{ r.minutes }} 分钟</span>
            </template>
          </div>
        </div>
      </div>

      <div v-if="recentInterruptions.length" class="card">
        <div class="section-title">最近中断（{{ store.todayPomodoro.interruptions }} 次/今日）</div>
        <div v-for="(it, i) in recentInterruptions" :key="i" class="text-xs py-1 flex gap-2 text-slate-500">
          <span class="opacity-60">{{ it.date }}</span
          ><span>{{ it.reason }}</span>
        </div>
      </div>
    </div>

    <!-- 计时中（沉浸式全屏）：大时钟距顶 1/4，番茄钟弱化至右上角，名言紧随大时钟，控制按钮沉底 -->
    <div
      v-else
      class="absolute inset-0 z-10"
      :class="bgUrl || phase === 'focus' ? 'text-white' : 'text-slate-800 dark:text-slate-100'"
    >
      <!-- 番茄钟（右上角弱化展示，减少干扰） -->
      <div class="absolute top-4 right-4 text-right opacity-75">
        <div class="text-[11px] tracking-widest">{{ phase === 'focus' ? '专注中' : '休息中' }}</div>
        <div class="text-2xl font-mono font-bold tabular-nums">{{ display }}</div>
      </div>

      <!-- 大号实时时钟：距页面顶部 1/4 -->
      <div class="absolute inset-x-0 top-1/4 px-6 text-center">
        <div class="text-6xl md:text-8xl font-mono font-black tabular-nums tracking-wider drop-shadow-lg">
          {{ clockText }}
        </div>
        <div class="mt-2 text-sm opacity-70">{{ dateText }}</div>
        <!-- 名言（点击换一句） -->
        <div class="mt-8 max-w-md mx-auto cursor-pointer select-none" title="点击换一句" @click="randomQuote">
          <p class="text-sm italic leading-relaxed opacity-85">「{{ quote.text }}」</p>
          <p v-if="quote.author" class="text-xs mt-1 opacity-50">—— {{ quote.author }}</p>
        </div>
      </div>

      <!-- 控制按钮（底部，低干扰，鼠标滑至底部自动唤起） -->
      <div
        class="absolute bottom-8 inset-x-0 flex gap-3 justify-center px-6 transition-all duration-500 ease-out"
        :class="
          controlsVisible
            ? 'opacity-100 translate-y-0 pointer-events-auto'
            : 'opacity-0 translate-y-4 pointer-events-none'
        "
      >
        <button
          v-if="running"
          class="btn backdrop-blur px-6"
          :class="bgUrl || phase === 'focus' ? 'bg-white/20 text-white' : 'bg-black/5 text-inherit'"
          @click="pause"
        >
          ⏸ 暂停
        </button>
        <button
          v-else
          class="btn backdrop-blur px-6"
          :class="bgUrl || phase === 'focus' ? 'bg-white/20 text-white' : 'bg-black/5 text-inherit'"
          @click="start"
        >
          ▶ 继续
        </button>
        <button
          v-if="phase === 'focus'"
          class="btn backdrop-blur px-6"
          :class="bgUrl || phase === 'focus' ? 'bg-white/20 text-white' : 'bg-black/5 text-inherit'"
          @click="showInterrupt = true"
        >
          被打断
        </button>
        <button class="btn bg-red-500/80 text-white px-6" @click="giveUp">结束</button>
      </div>
    </div>

    <!-- 中断原因弹窗 -->
    <Teleport to="body">
      <div v-if="showInterrupt" class="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-6">
        <div class="card max-w-xs w-full text-slate-800 dark:text-slate-100">
          <h3 class="font-bold mb-3">记录中断原因</h3>
          <input
            v-model="interruptReason"
            class="input"
            placeholder="如：看手机、有人打扰…"
            @keyup.enter="submitInterrupt"
          />
          <div class="flex gap-2 mt-4 justify-end">
            <button class="btn-ghost" @click="showInterrupt = false">取消</button>
            <button class="btn-primary" @click="submitInterrupt">保存</button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 离开拦截：计时中离开需确认（状态已落盘，返回可恢复） -->
    <Modal :show="showLeaveDialog" title="离开番茄钟？" @close="cancelLeave">
      <p class="text-sm text-slate-600 dark:text-slate-300">
        本次专注未结束。离开后计时仍按真实时间继续累计，返回番茄钟页面可恢复；下次刷新也会自动续算。
      </p>
      <template #footer>
        <button class="btn !px-4 text-sm" @click="cancelLeave">留在本页</button>
        <button class="btn btn-primary !px-4 text-sm" @click="confirmLeave">确认离开</button>
      </template>
    </Modal>
  </div>
</template>
