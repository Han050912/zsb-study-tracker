<script setup lang="ts">
/**
 * 全屏自习室（会话进行中）：壁纸轮播 + 系统时钟/番茄倒计时 + 对方状态 + 底部自动隐藏控制条。
 * 计时状态直接读写 studyTimer store（跨路由单例）；返回拦截（路由守卫/离开弹窗）留页面层，此处仅上抛 back 意图。
 * 壁纸轮播由页面层管理（生命周期跨会话，见 useWallpaperRotation），bgUrl 以 prop 传入；
 * 仅在 session 存在时由页面挂载，挂载即展示控制条（3 秒无操作自动隐藏）。
 */
import { onMounted, onUnmounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useClock } from '../../composables/useClock'
import { useConfirm } from '../../composables/useConfirm'
import { useStudyTimerStore } from '../../stores/studyTimer'
import UserAvatar from '../community/UserAvatar.vue'

type Phase = 'idle' | 'focus' | 'done'

defineProps<{ bgUrl: string }>()

const emit = defineEmits<{ back: [] }>()

const confirm = useConfirm()
const timer = useStudyTimerStore()
const { session, phase, running, myMinutes, onlineSeconds, display } = storeToRefs(timer)

// ---- 实时系统时钟 ----
const { clockText, dateText } = useClock()

const PHASE_TEXT: Record<Phase, string> = { idle: '准备开始', focus: '专注中', done: '已完成' }
const STATE_TEXT: Record<Phase, string> = { idle: '未开始', focus: '专注中', done: '已完成' }
const STATE_CLS: Record<Phase, string> = {
  idle: 'opacity-70',
  focus: 'text-emerald-300',
  done: 'text-emerald-400'
}

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

// ---- 控制按钮自动隐藏 ----
const controlsVisible = ref(true)
let hideControlsTimer: ReturnType<typeof setTimeout> | null = null

function handleMouseMove(e: MouseEvent) {
  const threshold = 100
  if (e.clientY > window.innerHeight - threshold) {
    controlsVisible.value = true
    if (hideControlsTimer) {
      clearTimeout(hideControlsTimer)
      hideControlsTimer = null
    }
  } else if (controlsVisible.value) {
    if (!hideControlsTimer)
      hideControlsTimer = setTimeout(() => {
        controlsVisible.value = false
      }, 3000)
  }
}

async function handleEndBtn() {
  if (!(await confirm('结束本次自习？双方将退出自习室。'))) return
  timer.endSession()
}

onMounted(() => {
  window.addEventListener('mousemove', handleMouseMove)
  // 进场先展示控制条，3 秒无操作自动隐藏
  hideControlsTimer = setTimeout(() => {
    controlsVisible.value = false
  }, 3000)
})

onUnmounted(() => {
  if (hideControlsTimer) clearTimeout(hideControlsTimer)
  window.removeEventListener('mousemove', handleMouseMove)
})
</script>

<template>
  <div
    v-if="session"
    class="min-h-screen relative flex flex-col items-center justify-center p-6 transition-colors duration-700 overflow-hidden"
    :class="
      bgUrl
        ? 'text-white'
        : phase === 'focus'
          ? 'bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-950 text-white'
          : 'bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-900 dark:to-slate-800 text-slate-800 dark:text-slate-100'
    "
  >
    <!-- 壁纸 + 遮罩（加载失败时 bgUrl 为空，自动降级为上方渐变） -->
    <template v-if="bgUrl">
      <img
        :src="bgUrl"
        alt=""
        class="absolute inset-0 w-full h-full object-cover transition-opacity duration-1000 pointer-events-none"
      />
      <div class="absolute inset-0 bg-gradient-to-b from-black/55 via-black/35 to-black/60 pointer-events-none"></div>
    </template>

    <!-- 左上角：返回（不结束会话，稍后可继续） -->
    <button class="absolute top-4 left-4 z-10 text-sm opacity-60 hover:opacity-100" @click="emit('back')">
      ← 返回
    </button>

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
      <div class="text-6xl md:text-8xl font-mono font-black tabular-nums tracking-wider drop-shadow-lg">
        {{ clockText }}
      </div>
      <div class="mt-1 text-sm opacity-70">{{ dateText }}</div>

      <div class="mt-6 text-sm tracking-widest opacity-85" :class="bgUrl || phase === 'focus' ? '' : 'opacity-70'">
        {{ PHASE_TEXT[phase] }}
      </div>
      <div class="text-4xl md:text-5xl font-mono font-bold tabular-nums tracking-wider my-2">{{ display }}</div>

      <!-- 等待态：展示对方状态/进度 -->
      <div v-if="phase === 'done'" class="mt-4 text-sm">
        <div v-if="session.partnerState === 'focus'" class="opacity-90">
          <template v-if="session.mode === 'countup'"
            >搭子专注中 · 已进行 {{ formatDuration(session.partnerElapsedSeconds) }}</template
          >
          <template v-else
            >搭子专注中 · 剩余
            {{ formatDuration(Math.max(0, session.focusMinutes * 60 - session.partnerElapsedSeconds)) }}</template
          >
        </div>
        <div v-else-if="session.partnerState === 'idle'" class="opacity-90">搭子未开始</div>
      </div>

      <div class="mt-6 flex items-center justify-center gap-6 text-sm">
        <div class="opacity-90">
          <div class="text-[11px] opacity-70">我的在线</div>
          <div class="font-mono font-bold tabular-nums text-xl">{{ formatDuration(onlineSeconds) }}</div>
        </div>
        <div class="opacity-50">·</div>
        <div class="opacity-90">
          <div class="text-[11px] opacity-70">{{ session.partnerName }}在线</div>
          <div class="font-mono font-bold tabular-nums text-xl">
            {{ formatDuration(session.partnerOnlineSeconds) }}
          </div>
        </div>
      </div>

      <div class="mt-2 text-xs opacity-70">
        与「{{ session.partnerName }}」开黑中 · 我的累计专注 {{ myMinutes }} 分钟
      </div>
    </div>

    <!-- 底部控制按钮（鼠标滑至底部唤起，3 秒无操作自动隐藏） -->
    <div
      class="absolute bottom-8 inset-x-0 flex flex-col items-center gap-3 px-6 z-10 transition-all duration-500 ease-out"
      :class="
        controlsVisible
          ? 'opacity-100 translate-y-0 pointer-events-auto'
          : 'opacity-0 translate-y-4 pointer-events-none'
      "
    >
      <input
        v-model="timer.taskDescription"
        maxlength="50"
        class="input w-full max-w-md text-center backdrop-blur"
        :class="
          bgUrl || phase === 'focus' ? '!bg-white/10 !border-white/20 !text-white placeholder:!text-white/40' : ''
        "
        placeholder="本次专注的任务（选填）"
      />
      <div class="flex gap-3 justify-center">
        <template v-if="phase !== 'done'">
          <button
            v-if="running"
            class="btn backdrop-blur px-6"
            :class="bgUrl || phase === 'focus' ? 'bg-white/20 text-white' : 'bg-black/5 text-inherit'"
            @click="timer.pause"
          >
            ⏸ 暂停
          </button>
          <button
            v-else
            class="btn backdrop-blur px-6"
            :class="bgUrl || phase === 'focus' ? 'bg-white/20 text-white' : 'bg-black/5 text-inherit'"
            @click="timer.start"
          >
            ▶ 继续
          </button>
        </template>
        <span v-else class="text-sm opacity-80 self-center">等待对方完成…</span>
        <button
          v-if="phase === 'focus' && session.mode === 'countup'"
          class="btn bg-emerald-500/80 text-white px-6"
          @click="timer.finishFocus"
        >
          完成专注
        </button>
        <button class="btn bg-red-500/80 text-white px-6" @click="handleEndBtn">结束自习</button>
      </div>
    </div>
  </div>
</template>
