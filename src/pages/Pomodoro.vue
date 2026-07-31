<script setup lang="ts">
import { computed, inject, onUnmounted, ref } from 'vue'
import { useAppStore } from '../stores/app'
import { formatMinutes } from '../utils/date'

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

const display = computed(() => {
  const s = mode.value === 'countdown' && phase.value !== 'idle'
    ? Math.max(0, (phase.value === 'focus' ? focusMinutes.value : breakMinutes.value) * 60 - seconds.value)
    : seconds.value
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
})

const progress = computed(() => {
  if (phase.value === 'idle') return 0
  const total = (phase.value === 'focus' ? focusMinutes.value : breakMinutes.value) * 60
  return mode.value === 'countdown' ? seconds.value / total : 0
})

function tick() {
  seconds.value++
  if (mode.value === 'countdown') {
    const total = (phase.value === 'focus' ? focusMinutes.value : breakMinutes.value) * 60
    if (seconds.value >= total) completePhase()
  }
}

function start() {
  if (phase.value === 'idle') {
    phase.value = 'focus'
    seconds.value = 0
    document.documentElement.requestFullscreen?.().catch(() => {})
  }
  running.value = true
  handle = setInterval(tick, 1000)
}

function pause() {
  running.value = false
  if (handle) clearInterval(handle)
}

function completePhase() {
  pause()
  if (phase.value === 'focus') {
    store.recordPomodoro(focusMinutes.value)
    toast(`🍅 完成一个番茄钟！+5 积分`)
    phase.value = 'break'
    seconds.value = 0
    if (mode.value === 'countdown') start()
  } else {
    phase.value = 'idle'
    seconds.value = 0
    toast('休息结束，继续加油！')
  }
}

function giveUp() {
  pause()
  if (phase.value === 'focus' && mode.value === 'countup' && seconds.value >= 60) {
    store.recordPomodoro(Math.round(seconds.value / 60))
    toast(`已记录 ${Math.round(seconds.value / 60)} 分钟专注`)
  }
  phase.value = 'idle'
  seconds.value = 0
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

// ---- 白噪音（WebAudio 生成） ----
const noiseType = ref('')
let audioCtx: AudioContext | null = null
let noiseNode: AudioBufferSourceNode | null = null
let filterNode: BiquadFilterNode | null = null

const NOISES = [
  { key: 'rain', label: '🌧 雨声', freq: 1200, type: 'lowpass' as BiquadFilterType },
  { key: 'wave', label: '🌊 海浪', freq: 500, type: 'lowpass' as BiquadFilterType },
  { key: 'forest', label: '🌲 森林', freq: 3000, type: 'bandpass' as BiquadFilterType },
  { key: 'cafe', label: '☕ 咖啡馆', freq: 800, type: 'bandpass' as BiquadFilterType }
]

function toggleNoise(key: string) {
  if (noiseType.value === key) { stopNoise(); return }
  stopNoise()
  noiseType.value = key
  const def = NOISES.find(n => n.key === key)!
  audioCtx = audioCtx || new AudioContext()
  const len = audioCtx.sampleRate * 2
  const buffer = audioCtx.createBuffer(1, len, audioCtx.sampleRate)
  const data = buffer.getChannelData(0)
  let last = 0
  for (let i = 0; i < len; i++) {
    const white = Math.random() * 2 - 1
    last = (last + 0.02 * white) / 1.02 // 布朗噪声更柔和
    data[i] = last * 3
  }
  noiseNode = audioCtx.createBufferSource()
  noiseNode.buffer = buffer
  noiseNode.loop = true
  filterNode = audioCtx.createBiquadFilter()
  filterNode.type = def.type
  filterNode.frequency.value = def.freq
  const gain = audioCtx.createGain()
  gain.gain.value = 0.25
  noiseNode.connect(filterNode).connect(gain).connect(audioCtx.destination)
  noiseNode.start()
}
function stopNoise() {
  noiseNode?.stop()
  noiseNode = null
  noiseType.value = ''
}
onUnmounted(() => { pause(); stopNoise() })

const recentInterruptions = computed(() => store.pomodoro.interruptions.slice(-5).reverse())
const totalSessions = computed(() => Object.values(store.pomodoro.daily).reduce((s, d) => s + d.count, 0))
const totalFocusMin = computed(() => Object.values(store.pomodoro.daily).reduce((s, d) => s + d.minutes, 0))
</script>

<template>
  <div class="min-h-screen flex flex-col items-center justify-center p-6 transition-colors duration-700"
    :class="phase === 'focus' ? 'bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-950 text-white' : phase === 'break' ? 'bg-gradient-to-br from-emerald-50 to-teal-100 dark:from-emerald-950 dark:to-teal-900' : ''">

    <RouterLink to="/" class="absolute top-4 left-4 text-sm opacity-60 hover:opacity-100">← 返回首页</RouterLink>

    <!-- 配置 -->
    <div v-if="phase === 'idle'" class="w-full max-w-md space-y-4">
      <h1 class="text-2xl font-bold text-center">🍅 番茄专注</h1>
      <div class="card space-y-3">
        <div class="flex gap-2">
          <button class="flex-1 btn" :class="mode === 'countdown' ? 'bg-primary-500 text-white' : 'bg-slate-100 dark:bg-slate-700'" @click="mode = 'countdown'">⏳ 倒计时</button>
          <button class="flex-1 btn" :class="mode === 'countup' ? 'bg-primary-500 text-white' : 'bg-slate-100 dark:bg-slate-700'" @click="mode = 'countup'">⏱ 正计时</button>
        </div>
        <div v-if="mode === 'countdown'" class="grid grid-cols-2 gap-3">
          <div><label class="label">专注（分钟）</label><input v-model.number="focusMinutes" type="number" min="1" max="120" class="input" /></div>
          <div><label class="label">休息（分钟）</label><input v-model.number="breakMinutes" type="number" min="1" max="30" class="input" /></div>
        </div>
        <button class="btn-primary w-full !py-3 text-base" @click="start">开始专注 🚀</button>
      </div>

      <!-- 白噪音 -->
      <div class="card">
        <div class="section-title">🎵 白噪音</div>
        <div class="grid grid-cols-4 gap-2">
          <button v-for="n in NOISES" :key="n.key" class="btn !text-xs !py-2"
            :class="noiseType === n.key ? 'bg-primary-500 text-white' : 'bg-slate-100 dark:bg-slate-700'"
            @click="toggleNoise(n.key)">{{ n.label }}</button>
        </div>
      </div>

      <!-- 统计 -->
      <div class="grid grid-cols-3 gap-3">
        <div class="card !p-3 text-center"><div class="text-xl font-black text-primary-500">{{ store.todayPomodoro.count }}</div><div class="text-[11px] text-slate-400">今日番茄</div></div>
        <div class="card !p-3 text-center"><div class="text-xl font-black text-primary-500">{{ formatMinutes(store.todayPomodoro.minutes) }}</div><div class="text-[11px] text-slate-400">今日专注</div></div>
        <div class="card !p-3 text-center"><div class="text-xl font-black text-primary-500">{{ totalSessions ? Math.round(totalFocusMin / totalSessions) : 0 }}分</div><div class="text-[11px] text-slate-400">平均时长</div></div>
      </div>

      <div v-if="recentInterruptions.length" class="card">
        <div class="section-title">⚠️ 最近中断（{{ store.todayPomodoro.interruptions }} 次/今日）</div>
        <div v-for="(it, i) in recentInterruptions" :key="i" class="text-xs text-slate-500 py-1 flex gap-2">
          <span class="text-slate-400">{{ it.date }}</span><span>{{ it.reason }}</span>
        </div>
      </div>
    </div>

    <!-- 计时中 -->
    <div v-else class="text-center">
      <div class="text-sm mb-2 opacity-70">{{ phase === 'focus' ? '🎯 专注中，保持！' : '☕ 休息一下' }}</div>
      <div class="relative w-64 h-64 mx-auto">
        <svg viewBox="0 0 200 200" class="w-full h-full -rotate-90">
          <circle cx="100" cy="100" r="90" fill="none" stroke-width="6" class="stroke-white/10" :class="phase === 'break' ? '!stroke-slate-200' : ''" />
          <circle cx="100" cy="100" r="90" fill="none" stroke-width="6" stroke-linecap="round"
            :stroke="phase === 'focus' ? '#f97316' : '#10b981'"
            stroke-dasharray="565" :stroke-dashoffset="565 * (1 - Math.min(1, progress))" class="transition-all duration-1000" />
        </svg>
        <div class="absolute inset-0 flex items-center justify-center">
          <span class="text-6xl font-mono font-black tabular-nums">{{ display }}</span>
        </div>
      </div>
      <div class="flex gap-3 justify-center mt-8">
        <button v-if="running" class="btn bg-white/20 text-inherit backdrop-blur px-6" @click="pause">⏸ 暂停</button>
        <button v-else class="btn bg-white/20 text-inherit backdrop-blur px-6" @click="start">▶ 继续</button>
        <button v-if="phase === 'focus'" class="btn bg-white/20 text-inherit backdrop-blur px-6" @click="showInterrupt = true">⚠️ 被打断</button>
        <button class="btn bg-red-500/80 text-white px-6" @click="giveUp">结束</button>
      </div>
      <div class="flex gap-2 justify-center mt-6">
        <button v-for="n in NOISES" :key="n.key" class="text-xs px-2 py-1 rounded-full"
          :class="noiseType === n.key ? 'bg-white/30' : 'bg-white/10 opacity-60'"
          @click="toggleNoise(n.key)">{{ n.label }}</button>
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
