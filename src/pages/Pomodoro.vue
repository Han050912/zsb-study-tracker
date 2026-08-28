<script setup lang="ts">
import { computed, inject, onMounted, onUnmounted, ref } from 'vue'
import dayjs from 'dayjs'
import { useAppStore } from '../stores/app'
import { formatMinutes } from '../utils/date'
import { API_BASE } from '../api/client'
import type { PomodoroRecord } from '../types'

const store = useAppStore()
const toast = inject<(m: string) => void>('toast', () => {})

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

// ---- 控制按钮自动隐藏 ----
const controlsVisible = ref(true)
let hideControlsTimer: ReturnType<typeof setTimeout> | null = null

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
    if (hideControlsTimer) { clearTimeout(hideControlsTimer); hideControlsTimer = null }
  } else if (controlsVisible.value) {
    // 鼠标离开底部区域：启动 3 秒后隐藏
    if (!hideControlsTimer) {
      hideControlsTimer = setTimeout(() => { controlsVisible.value = false }, 3000)
    }
  }
}

const display = computed(() => {
  const s = mode.value === 'countdown' && phase.value !== 'idle'
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

/** 停止计时器并将当前段的时间累加到 pausedElapsed（纯计时操作，无 UI 副作用） */
function stopTimer() {
  running.value = false
  if (handle) clearInterval(handle)
  pausedElapsed += Math.floor((Date.now() - startTimestamp) / 1000)
}

/** 页面从后台恢复可见时立即校准计时显示，并检查是否已到达结束时间 */
function handleVisibilityChange() {
  if (!document.hidden && running.value) tick()
}

function start() {
  if (phase.value === 'idle') {
    phase.value = 'focus'
    activeDescription = taskDescription.value.trim().slice(0, 50)
    seconds.value = 0
    pausedElapsed = 0
    document.documentElement.requestFullscreen?.().catch(() => {})
    startBgRotation()
    // 进入专注时显示按钮 3 秒后自动隐藏
    controlsVisible.value = true
    if (hideControlsTimer) { clearTimeout(hideControlsTimer); hideControlsTimer = null }
    hideControlsTimer = setTimeout(() => { controlsVisible.value = false }, 3000)
  }
  startTimestamp = Date.now()
  running.value = true
  handle = setInterval(tick, 1000)
}

function pause() {
  stopTimer()
  // 暂停时保持按钮可见更久，方便用户看到「继续」按钮
  controlsVisible.value = true
  if (hideControlsTimer) { clearTimeout(hideControlsTimer); hideControlsTimer = null }
  hideControlsTimer = setTimeout(() => { controlsVisible.value = false }, 8000)
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
}

function giveUp() {
  // 先计算已流逝秒数（stopTimer 会将当前段累加到 pausedElapsed）
  const elapsed = pausedElapsed + Math.floor((Date.now() - startTimestamp) / 1000)
  stopTimer()
  if (phase.value === 'focus') {
    const minutes = Math.round(elapsed / 60)
    if (minutes >= 1) {
      store.recordPomodoro(minutes, activeDescription)
      toast(`完成一个番茄钟！+5 积分`)
    }
  }
  phase.value = 'idle'
  seconds.value = 0
  pausedElapsed = 0
  stopBgRotation()
  document.exitFullscreen?.().catch(() => {})
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

// ---- 背景图（进入专注全屏后经 Worker 代理从哲风壁纸拉取静态壁纸，每 2 分钟自动轮播；预加载成功才切换，失败保持渐变降级） ----
const bgUrl = ref('')
let bgTimer: ReturnType<typeof setInterval> | null = null

function fetchBackground() {
  // r 参数防缓存；Worker 每次 302 到一张随机静态壁纸
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

// ---- 实时时钟 ----
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
  const pool = [...FAMOUS_QUOTES, ...store.settings.quotes.map(q => ({ text: q, author: '' }))]
  let idx = Math.floor(Math.random() * pool.length)
  if (pool.length > 1) {
    while (idx === lastQuoteIdx) idx = Math.floor(Math.random() * pool.length)
  }
  lastQuoteIdx = idx
  quote.value = pool[idx]
}

onMounted(() => {
  randomQuote()
  clockHandle = setInterval(() => { now.value = new Date() }, 1000)
  window.addEventListener('mousemove', handleMouseMove)
  document.addEventListener('visibilitychange', handleVisibilityChange)
})
onUnmounted(() => {
  stopTimer()
  stopBgRotation()
  if (clockHandle) clearInterval(clockHandle)
  if (hideControlsTimer) clearTimeout(hideControlsTimer)
  window.removeEventListener('mousemove', handleMouseMove)
  document.removeEventListener('visibilitychange', handleVisibilityChange)
})

const recentInterruptions = computed(() => store.pomodoro.interruptions.slice(-5).reverse())

// ---- 最近完成：今日番茄明细 ----
/** 响应式今日键：随实时时钟每秒更新，跨 00:00 后列表与编辑守卫自动切换到新的一天 */
const todayKey = computed(() => dayjs(now.value).format('YYYY-MM-DD'))
const todayRecordsSorted = computed(() =>
  (store.pomodoro.records || []).filter(r => r.date === todayKey.value).sort((a, b) => b.time - a.time)
)
const editingId = ref('')
const editingText = ref('')

function fmtClock(t: number) { return dayjs(t).format('HH:mm') }

/** 编辑输入框挂载后自动聚焦并全选（与 SubjectPanel 行内改名一致，避免 autofocus 失效导致行卡在编辑态） */
const vFocus = { mounted: (el: HTMLInputElement) => { el.focus(); el.select() } }

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
function cancelEdit() { editingId.value = '' }
</script>

<template>
  <div class="min-h-screen relative flex flex-col items-center justify-center p-6 transition-colors duration-700 overflow-hidden"
    :class="bgUrl ? 'text-white' : phase === 'focus' ? 'bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-950 text-white' : phase === 'break' ? 'bg-gradient-to-br from-emerald-50 to-teal-100 dark:from-emerald-950 dark:to-teal-900' : ''">

    <!-- 背景图 + 遮罩（图片加载失败时 bgUrl 为空，自动降级为上方渐变） -->
    <template v-if="bgUrl">
      <img :src="bgUrl" alt="" class="absolute inset-0 w-full h-full object-cover transition-opacity duration-1000" />
      <div class="absolute inset-0 bg-gradient-to-b from-black/55 via-black/35 to-black/60"></div>
    </template>

    <!-- 返回入口仅在配置页展示；专注计时中隐藏，保持界面零导航干扰 -->
    <RouterLink v-if="phase === 'idle'" to="/" class="absolute top-4 left-4 z-10 text-sm opacity-60 hover:opacity-100">← 返回首页</RouterLink>

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
          <button class="flex-1 btn" :class="mode === 'countdown' ? 'bg-primary-500 text-white' : 'bg-slate-100 dark:bg-slate-700'" @click="mode = 'countdown'">倒计时</button>
          <button class="flex-1 btn" :class="mode === 'countup' ? 'bg-primary-500 text-white' : 'bg-slate-100 dark:bg-slate-700'" @click="mode = 'countup'">正计时</button>
        </div>
        <div v-if="mode === 'countdown'" class="grid grid-cols-2 gap-3">
          <div><label class="label">专注（分钟）</label><input v-model.number="focusMinutes" type="number" min="1" max="120" class="input" /></div>
          <div><label class="label">休息（分钟）</label><input v-model.number="breakMinutes" type="number" min="1" max="30" class="input" /></div>
        </div>
        <div>
          <label class="label">任务描述（选填）</label>
          <input v-model="taskDescription" maxlength="50" class="input" placeholder="本次专注的任务，如：复习高数第三章" />
        </div>
        <button class="btn-primary w-full !py-3 text-base" @click="start">开始专注 </button>
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
          <div class="text-xl font-black text-primary-500">{{ store.todayPomodoro.count ? (store.todayPomodoro.minutes / store.todayPomodoro.count).toFixed(1) : '0.0' }}分</div>
          <div class="text-[11px] text-slate-400">平均时长</div>
        </div>
      </div>

      <!-- 最近完成：今日番茄明细（独立板块，位于最近中断上方） -->
      <div class="card">
        <div class="section-title">最近完成（{{ todayRecordsSorted.length }} 个/今日）</div>
        <div v-if="!todayRecordsSorted.length" class="text-xs text-slate-400 dark:text-slate-500 text-center py-3">今日还没有完成的番茄</div>
        <div v-else class="max-h-48 overflow-y-auto">
          <div v-for="r in todayRecordsSorted" :key="r.id"
            class="text-xs py-1.5 flex items-center gap-2 text-slate-500 border-t border-slate-100 dark:border-slate-700 first:border-t-0 cursor-default"
            @dblclick="startEdit(r)">
            <template v-if="editingId === r.id">
              <input v-model="editingText" v-focus maxlength="50" class="input !py-1 !text-xs flex-1"
                @dblclick.stop @keydown.enter="onEditEnter" @keyup.esc="cancelEdit" @blur="saveEdit" />
            </template>
            <template v-else>
              <span class="opacity-60 whitespace-nowrap">{{ fmtClock(r.time) }}</span>
              <span class="flex-1 truncate" :class="r.description ? '' : 'italic opacity-50'">{{ r.description || '未命名' }}</span>
              <span v-if="r.source === 'party'" class="px-1.5 py-0.5 rounded-full bg-primary-50 dark:bg-primary-900/40 text-primary-500 text-[10px] whitespace-nowrap">开黑·{{ r.partnerName }}</span>
              <span class="whitespace-nowrap">{{ r.minutes }} 分钟</span>
            </template>
          </div>
        </div>
      </div>

      <div v-if="recentInterruptions.length" class="card">
        <div class="section-title">最近中断（{{ store.todayPomodoro.interruptions }} 次/今日）</div>
        <div v-for="(it, i) in recentInterruptions" :key="i" class="text-xs py-1 flex gap-2 text-slate-500">
          <span class="opacity-60">{{ it.date }}</span><span>{{ it.reason }}</span>
        </div>
      </div>
    </div>

    <!-- 计时中（沉浸式全屏）：大时钟距顶 1/4，番茄钟弱化至右上角，名言紧随大时钟，控制按钮沉底 -->
    <div v-else class="absolute inset-0 z-10" :class="bgUrl || phase === 'focus' ? 'text-white' : 'text-slate-800 dark:text-slate-100'">
      <!-- 番茄钟（右上角弱化展示，减少干扰） -->
      <div class="absolute top-4 right-4 text-right opacity-75">
        <div class="text-[11px] tracking-widest">{{ phase === 'focus' ? '专注中' : '休息中' }}</div>
        <div class="text-2xl font-mono font-bold tabular-nums">{{ display }}</div>
      </div>

      <!-- 大号实时时钟：距页面顶部 1/4 -->
      <div class="absolute inset-x-0 top-1/4 px-6 text-center">
        <div class="text-6xl md:text-8xl font-mono font-black tabular-nums tracking-wider drop-shadow-lg">{{ clockText }}</div>
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
        :class="controlsVisible ? 'opacity-100 translate-y-0 pointer-events-auto' : 'opacity-0 translate-y-4 pointer-events-none'"
      >
        <button v-if="running" class="btn backdrop-blur px-6" :class="bgUrl || phase === 'focus' ? 'bg-white/20 text-white' : 'bg-black/5 text-inherit'" @click="pause">⏸ 暂停</button>
        <button v-else class="btn backdrop-blur px-6" :class="bgUrl || phase === 'focus' ? 'bg-white/20 text-white' : 'bg-black/5 text-inherit'" @click="start">▶ 继续</button>
        <button v-if="phase === 'focus'" class="btn backdrop-blur px-6" :class="bgUrl || phase === 'focus' ? 'bg-white/20 text-white' : 'bg-black/5 text-inherit'" @click="showInterrupt = true">被打断</button>
        <button class="btn bg-red-500/80 text-white px-6" @click="giveUp">结束</button>
      </div>
    </div>

    <!-- 中断原因弹窗 -->
    <Teleport to="body">
      <div v-if="showInterrupt" class="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-6">
        <div class="card max-w-xs w-full text-slate-800 dark:text-slate-100">
          <h3 class="font-bold mb-3">记录中断原因</h3>
          <input v-model="interruptReason" class="input" placeholder="如：看手机、有人打扰…" @keyup.enter="submitInterrupt" />
          <div class="flex gap-2 mt-4 justify-end">
            <button class="btn-ghost" @click="showInterrupt = false">取消</button>
            <button class="btn-primary" @click="submitInterrupt">保存</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
