<script setup lang="ts">
import { computed, inject, onMounted, onUnmounted, ref } from 'vue'
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

// ---- 白噪音（WebAudio 合成，柔和版：布朗噪声打底 + 滤波塑形 + 淡入淡出防爆音） ----
interface NoiseDef {
  key: string
  label: string
  /** 返回滤波链的入口与出口节点 + 目标音量；调用方负责 source→input、output→gain */
  build: (ctx: AudioContext) => { input: AudioNode; output: AudioNode; gainValue: number }
}
const noiseType = ref('')
let audioCtx: AudioContext | null = null
let noiseSource: AudioBufferSourceNode | null = null
let noiseGain: GainNode | null = null
let noiseLfo: OscillatorNode | null = null

/** 生成布朗噪声缓冲（比白噪声柔和，无刺耳高频） */
function brownBuffer(ctx: AudioContext): AudioBuffer {
  const len = ctx.sampleRate * 4
  const buffer = ctx.createBuffer(1, len, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  let last = 0
  for (let i = 0; i < len; i++) {
    const white = Math.random() * 2 - 1
    last = (last + 0.02 * white) / 1.02
    data[i] = last * 2.2 // 适度放大，后续由增益级统一压到柔和音量
  }
  return buffer
}

function chain(ctx: AudioContext, ...filters: [BiquadFilterType, number, number?][]) {
  const input = ctx.createGain()
  let node: AudioNode = input
  for (const [type, freq, q] of filters) {
    const f = ctx.createBiquadFilter()
    f.type = type
    f.frequency.value = freq
    if (q !== undefined) f.Q.value = q
    node.connect(f)
    node = f
  }
  return { input, output: node }
}

const NOISES: NoiseDef[] = [
  {
    key: 'rain', label: '🌧 雨声',
    build: (ctx) => {
      // 低通去尖锐 + 高通去隆隆声，雨中频柔和
      const c = chain(ctx, ['lowpass', 1400], ['highpass', 320])
      return { input: c.input, output: c.output, gainValue: 0.14 }
    }
  },
  {
    key: 'wave', label: '🌊 海浪',
    build: (ctx) => {
      // 低频涌动 + 慢速 LFO 调制音量，模拟海浪起伏
      const c = chain(ctx, ['lowpass', 420])
      return { input: c.input, output: c.output, gainValue: 0.16 }
    }
  },
  {
    key: 'forest', label: '🌲 森林',
    build: (ctx) => {
      // 窄带高频轻响，像风吹过树叶
      const c = chain(ctx, ['bandpass', 2600, 0.4])
      return { input: c.input, output: c.output, gainValue: 0.07 }
    }
  },
  {
    key: 'cafe', label: '☕ 咖啡馆',
    build: (ctx) => {
      // 中频闷响声场，模拟远处人声嘈杂感（压低音量避免吵）
      const c = chain(ctx, ['bandpass', 700, 0.7], ['lowpass', 1600])
      return { input: c.input, output: c.output, gainValue: 0.1 }
    }
  }
]

function toggleNoise(key: string) {
  if (noiseType.value === key) { stopNoise(); return }
  stopNoise()
  noiseType.value = key
  const def = NOISES.find(n => n.key === key)!
  audioCtx = audioCtx || new AudioContext()
  if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {})

  const { input, output, gainValue } = def.build(audioCtx)
  noiseSource = audioCtx.createBufferSource()
  noiseSource.buffer = brownBuffer(audioCtx)
  noiseSource.loop = true

  noiseGain = audioCtx.createGain()
  noiseGain.gain.value = 0
  // 1.2s 淡入，消除爆音
  noiseGain.gain.linearRampToValueAtTime(gainValue, audioCtx.currentTime + 1.2)

  // 海浪额外叠加音量 LFO（0.12Hz 慢速涌动）
  if (key === 'wave') {
    noiseLfo = audioCtx.createOscillator()
    noiseLfo.frequency.value = 0.12
    const lfoGain = audioCtx.createGain()
    lfoGain.gain.value = gainValue * 0.45
    noiseLfo.connect(lfoGain).connect(noiseGain.gain)
    noiseLfo.start()
  }

  noiseSource.connect(input)
  output.connect(noiseGain)
  noiseGain.connect(audioCtx.destination)
  noiseSource.start()
  pickBackground(key)
}

function stopNoise() {
  if (noiseGain && audioCtx) {
    // 0.6s 淡出，避免突兀静音
    const g = noiseGain
    g.gain.cancelScheduledValues(audioCtx.currentTime)
    g.gain.setValueAtTime(g.gain.value, audioCtx.currentTime)
    g.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.6)
    const src = noiseSource
    const lfo = noiseLfo
    setTimeout(() => { try { src?.stop() } catch { /* 已停止 */ }; try { lfo?.stop() } catch { /* 已停止 */ } }, 700)
  }
  noiseSource = null
  noiseGain = null
  noiseLfo = null
  noiseType.value = ''
  bgUrl.value = ''
}

// ---- 背景图（每种白噪音匹配主题图集，随机选取且避免与上一张重复；加载失败降级为渐变） ----
const BG_IMAGES: Record<string, string[]> = {
  rain: [
    'https://images.unsplash.com/photo-1428592953211-077101b2021b?auto=format&fit=crop&w=1920&q=80',
    'https://images.unsplash.com/photo-1519692933481-e162a57d6721?auto=format&fit=crop&w=1920&q=80',
    'https://images.unsplash.com/photo-1534274988757-a28bf1a57c17?auto=format&fit=crop&w=1920&q=80'
  ],
  wave: [
    'https://images.unsplash.com/photo-1505118380757-91f5f5632de0?auto=format&fit=crop&w=1920&q=80',
    'https://images.unsplash.com/photo-1439405326854-014607f694d7?auto=format&fit=crop&w=1920&q=80',
    'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1920&q=80'
  ],
  forest: [
    'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?auto=format&fit=crop&w=1920&q=80',
    'https://images.unsplash.com/photo-1448375240586-882707db888b?auto=format&fit=crop&w=1920&q=80',
    'https://images.unsplash.com/photo-1511497584788-876760111969?auto=format&fit=crop&w=1920&q=80'
  ],
  cafe: [
    'https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?auto=format&fit=crop&w=1920&q=80',
    'https://images.unsplash.com/photo-1521017432531-fbd92d768814?auto=format&fit=crop&w=1920&q=80',
    'https://images.unsplash.com/photo-1554118811-1e0d58224f24?auto=format&fit=crop&w=1920&q=80'
  ]
}
const bgUrl = ref('')
let lastBg = ''

function pickBackground(key: string) {
  const pool = BG_IMAGES[key] || []
  if (!pool.length) { bgUrl.value = ''; return }
  // 尽量避免与上一张重复
  let candidates = pool.filter(u => u !== lastBg)
  if (!candidates.length) candidates = pool
  const url = candidates[Math.floor(Math.random() * candidates.length)]
  // 预加载：成功才切换背景，失败保持渐变（降级方案）
  const img = new Image()
  img.onload = () => { if (noiseType.value === key) { bgUrl.value = url; lastBg = url } }
  img.onerror = () => { bgUrl.value = '' }
  img.src = url
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
})
onUnmounted(() => {
  pause()
  stopNoise()
  if (clockHandle) clearInterval(clockHandle)
})

const recentInterruptions = computed(() => store.pomodoro.interruptions.slice(-5).reverse())
const totalSessions = computed(() => Object.values(store.pomodoro.daily).reduce((s, d) => s + d.count, 0))
const totalFocusMin = computed(() => Object.values(store.pomodoro.daily).reduce((s, d) => s + d.minutes, 0))
</script>

<template>
  <div class="min-h-screen relative flex flex-col items-center justify-center p-6 transition-colors duration-700 overflow-hidden"
    :class="bgUrl ? 'text-white' : phase === 'focus' ? 'bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-950 text-white' : phase === 'break' ? 'bg-gradient-to-br from-emerald-50 to-teal-100 dark:from-emerald-950 dark:to-teal-900' : ''">

    <!-- 背景图 + 遮罩（图片加载失败时 bgUrl 为空，自动降级为上方渐变） -->
    <template v-if="bgUrl">
      <img :src="bgUrl" alt="" class="absolute inset-0 w-full h-full object-cover transition-opacity duration-1000" />
      <div class="absolute inset-0 bg-gradient-to-b from-black/55 via-black/35 to-black/60"></div>
    </template>

    <RouterLink to="/" class="absolute top-4 left-4 z-10 text-sm opacity-60 hover:opacity-100">← 返回首页</RouterLink>

    <!-- 实时时钟（右上角） -->
    <div class="absolute top-4 right-4 z-10 text-right" :class="bgUrl || phase === 'focus' ? 'text-white' : ''">
      <div class="text-2xl font-mono font-bold tabular-nums tracking-wider">{{ clockText }}</div>
      <div class="text-[11px] opacity-70">{{ dateText }}</div>
    </div>

    <!-- 配置 -->
    <div v-if="phase === 'idle'" class="relative z-10 w-full max-w-md space-y-4">
      <h1 class="text-2xl font-bold text-center" :class="bgUrl ? 'text-white' : ''">🍅 番茄专注</h1>
      <div class="card space-y-3" :class="bgUrl ? '!bg-white/10 !border-white/20 backdrop-blur-md text-white' : ''">
        <div class="flex gap-2">
          <button class="flex-1 btn" :class="mode === 'countdown' ? 'bg-primary-500 text-white' : bgUrl ? 'bg-white/15 text-white' : 'bg-slate-100 dark:bg-slate-700'" @click="mode = 'countdown'">⏳ 倒计时</button>
          <button class="flex-1 btn" :class="mode === 'countup' ? 'bg-primary-500 text-white' : bgUrl ? 'bg-white/15 text-white' : 'bg-slate-100 dark:bg-slate-700'" @click="mode = 'countup'">⏱ 正计时</button>
        </div>
        <div v-if="mode === 'countdown'" class="grid grid-cols-2 gap-3">
          <div><label class="label" :class="bgUrl ? '!text-white/70' : ''">专注（分钟）</label><input v-model.number="focusMinutes" type="number" min="1" max="120" class="input" :class="bgUrl ? '!bg-white/15 !border-white/25 !text-white' : ''" /></div>
          <div><label class="label" :class="bgUrl ? '!text-white/70' : ''">休息（分钟）</label><input v-model.number="breakMinutes" type="number" min="1" max="30" class="input" :class="bgUrl ? '!bg-white/15 !border-white/25 !text-white' : ''" /></div>
        </div>
        <button class="btn-primary w-full !py-3 text-base" @click="start">开始专注 🚀</button>
      </div>

      <!-- 白噪音 -->
      <div class="card" :class="bgUrl ? '!bg-white/10 !border-white/20 backdrop-blur-md' : ''">
        <div class="section-title" :class="bgUrl ? '!text-white/90' : ''">🎵 白噪音（选择后自动匹配主题背景）</div>
        <div class="grid grid-cols-4 gap-2">
          <button v-for="n in NOISES" :key="n.key" class="btn !text-xs !py-2"
            :class="noiseType === n.key ? 'bg-primary-500 text-white' : bgUrl ? 'bg-white/15 text-white' : 'bg-slate-100 dark:bg-slate-700'"
            @click="toggleNoise(n.key)">{{ n.label }}</button>
        </div>
      </div>

      <!-- 名言点缀 -->
      <div class="text-center cursor-pointer select-none" title="点击换一句" @click="randomQuote">
        <p class="text-xs italic" :class="bgUrl ? 'text-white/80' : 'text-slate-400'">「{{ quote.text }}」</p>
        <p v-if="quote.author" class="text-[10px] mt-0.5" :class="bgUrl ? 'text-white/50' : 'text-slate-300 dark:text-slate-500'">—— {{ quote.author }}</p>
      </div>

      <!-- 统计 -->
      <div class="grid grid-cols-3 gap-3">
        <div class="card !p-3 text-center" :class="bgUrl ? '!bg-white/10 !border-white/20 backdrop-blur-md' : ''">
          <div class="text-xl font-black" :class="bgUrl ? 'text-white' : 'text-primary-500'">{{ store.todayPomodoro.count }}</div>
          <div class="text-[11px]" :class="bgUrl ? 'text-white/60' : 'text-slate-400'">今日番茄</div>
        </div>
        <div class="card !p-3 text-center" :class="bgUrl ? '!bg-white/10 !border-white/20 backdrop-blur-md' : ''">
          <div class="text-xl font-black" :class="bgUrl ? 'text-white' : 'text-primary-500'">{{ formatMinutes(store.todayPomodoro.minutes) }}</div>
          <div class="text-[11px]" :class="bgUrl ? 'text-white/60' : 'text-slate-400'">今日专注</div>
        </div>
        <div class="card !p-3 text-center" :class="bgUrl ? '!bg-white/10 !border-white/20 backdrop-blur-md' : ''">
          <div class="text-xl font-black" :class="bgUrl ? 'text-white' : 'text-primary-500'">{{ totalSessions ? Math.round(totalFocusMin / totalSessions) : 0 }}分</div>
          <div class="text-[11px]" :class="bgUrl ? 'text-white/60' : 'text-slate-400'">平均时长</div>
        </div>
      </div>

      <div v-if="recentInterruptions.length" class="card" :class="bgUrl ? '!bg-white/10 !border-white/20 backdrop-blur-md' : ''">
        <div class="section-title" :class="bgUrl ? '!text-white/90' : ''">⚠️ 最近中断（{{ store.todayPomodoro.interruptions }} 次/今日）</div>
        <div v-for="(it, i) in recentInterruptions" :key="i" class="text-xs py-1 flex gap-2" :class="bgUrl ? 'text-white/70' : 'text-slate-500'">
          <span class="opacity-60">{{ it.date }}</span><span>{{ it.reason }}</span>
        </div>
      </div>
    </div>

    <!-- 计时中（沉浸式）；休息阶段无背景图时为浅绿渐变，用深色文字保证可读性 -->
    <div v-else class="relative z-10 text-center" :class="bgUrl || phase === 'focus' ? 'text-white' : 'text-slate-800 dark:text-slate-100'">
      <div class="text-sm mb-2 opacity-80 tracking-widest">{{ phase === 'focus' ? '🎯 专注中，保持！' : '☕ 休息一下' }}</div>
      <div class="relative w-64 h-64 mx-auto">
        <svg viewBox="0 0 200 200" class="w-full h-full -rotate-90 drop-shadow-lg">
          <circle cx="100" cy="100" r="90" fill="none" stroke-width="6" :class="bgUrl || phase === 'focus' ? 'stroke-white/15' : 'stroke-slate-200'" />
          <circle cx="100" cy="100" r="90" fill="none" stroke-width="6" stroke-linecap="round"
            :stroke="phase === 'focus' ? '#f97316' : '#10b981'"
            stroke-dasharray="565" :stroke-dashoffset="565 * (1 - Math.min(1, progress))" class="transition-all duration-1000" />
        </svg>
        <div class="absolute inset-0 flex flex-col items-center justify-center gap-1">
          <span class="text-6xl font-mono font-black tabular-nums drop-shadow">{{ display }}</span>
          <span class="text-[11px] opacity-60 font-mono">{{ clockText }}</span>
        </div>
      </div>

      <!-- 名言点缀（点击换一句） -->
      <div class="mt-6 max-w-xs mx-auto cursor-pointer select-none" title="点击换一句" @click="randomQuote">
        <p class="text-xs italic leading-relaxed" :class="bgUrl || phase === 'focus' ? 'text-white/85' : 'text-slate-500'">「{{ quote.text }}」</p>
        <p v-if="quote.author" class="text-[10px] mt-0.5" :class="bgUrl || phase === 'focus' ? 'text-white/50' : 'text-slate-400'">—— {{ quote.author }}</p>
      </div>

      <div class="flex gap-3 justify-center mt-6">
        <button v-if="running" class="btn backdrop-blur px-6" :class="bgUrl || phase === 'focus' ? 'bg-white/20 text-white' : 'bg-black/5 text-inherit'" @click="pause">⏸ 暂停</button>
        <button v-else class="btn backdrop-blur px-6" :class="bgUrl || phase === 'focus' ? 'bg-white/20 text-white' : 'bg-black/5 text-inherit'" @click="start">▶ 继续</button>
        <button v-if="phase === 'focus'" class="btn backdrop-blur px-6" :class="bgUrl || phase === 'focus' ? 'bg-white/20 text-white' : 'bg-black/5 text-inherit'" @click="showInterrupt = true">⚠️ 被打断</button>
        <button class="btn bg-red-500/80 text-white px-6" @click="giveUp">结束</button>
      </div>
      <div class="flex gap-2 justify-center mt-6">
        <button v-for="n in NOISES" :key="n.key" class="text-xs px-2 py-1 rounded-full transition-colors"
          :class="[noiseType === n.key
            ? (bgUrl || phase === 'focus' ? 'bg-white/30 text-white' : 'bg-black/10 text-inherit')
            : (bgUrl || phase === 'focus' ? 'bg-white/10 text-white/60 hover:bg-white/20' : 'bg-black/5 text-slate-500 hover:bg-black/10')]"
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
