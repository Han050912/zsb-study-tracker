<script setup lang="ts">
import { ArrowLeft } from '@lucide/vue'
import IconAction from '../../shared/components/IconAction.vue'
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
  focus: '',
  done: ''
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
        hideControls()
      }, 3000)
  }
}

function hideControls() {
  hideControlsTimer = null
  if (!document.activeElement?.closest('.partner-room-controls')) controlsVisible.value = false
}
function showControls() {
  controlsVisible.value = true
  if (hideControlsTimer) clearTimeout(hideControlsTimer)
  hideControlsTimer = null
}

async function handleEndBtn() {
  if (!(await confirm('结束本次自习？双方将退出自习室。'))) return
  await timer.endSession()
}

onMounted(() => {
  window.addEventListener('mousemove', handleMouseMove)
  window.addEventListener('keydown', showControls)
  window.addEventListener('focusin', showControls)
  // 进场先展示控制条，3 秒无操作自动隐藏
  hideControlsTimer = setTimeout(hideControls, 3000)
})

onUnmounted(() => {
  if (hideControlsTimer) clearTimeout(hideControlsTimer)
  window.removeEventListener('mousemove', handleMouseMove)
  window.removeEventListener('keydown', showControls)
  window.removeEventListener('focusin', showControls)
})
</script>

<template>
  <div
    v-if="session"
    class="min-h-screen relative flex flex-col items-center justify-center p-6 transition-colors duration-200 overflow-hidden"
    :class="bgUrl ? 'text-white' : 'bg-canvas text-ink'"
  >
    <!-- 壁纸 + 遮罩（加载失败时 bgUrl 为空，自动降级为上方渐变） -->
    <template v-if="bgUrl">
      <img
        :src="bgUrl"
        alt=""
        class="absolute inset-0 w-full h-full object-cover transition-opacity duration-200 pointer-events-none"
      />
      <div class="absolute inset-0 timer-wallpaper-shade pointer-events-none"></div>
    </template>

    <div class="absolute top-16 inset-x-4 text-center text-sm" role="status" aria-live="polite">
      <span>{{
        {
          connecting: '连接中',
          connected: '已连接',
          reconnecting: '重连中 · 数据可能延迟',
          offline: '已离线 · 本地计时仍在继续'
        }[timer.connection]
      }}</span>
      <button v-if="timer.connection === 'offline'" class="ml-2 underline min-h-11" @click="timer.reconnect()">
        重新连接
      </button>
      <p v-if="timer.endError" class="mt-2" role="alert">{{ timer.endError }}</p>
    </div>
    <!-- 左上角：返回（不结束会话，稍后可继续） -->
    <span class="absolute top-4 left-4 z-10 text-sm min-h-11 hover:underline arrow-action" @click="emit('back')">
      <IconAction :icon="ArrowLeft" label="返回" :class="bgUrl ? 'arrow-on-overlay' : ''" @click="emit('back')" /> 返回
    </span>

    <!-- 右上角：对方状态（弱化展示，减少干扰） -->
    <div class="absolute top-4 right-4 z-10 flex items-center gap-2 opacity-90">
      <UserAvatar :name="session.partnerName" :avatar="session.partnerAvatar" size="sm" />
      <div class="text-right">
        <div class="text-xs font-semibold leading-tight">{{ session.partnerName }}</div>
        <div class="text-xs leading-tight" :class="STATE_CLS[session.partnerState]">
          {{ STATE_TEXT[session.partnerState] }} · {{ formatDuration(session.partnerOnlineSeconds) }}
        </div>
      </div>
    </div>

    <!-- 中央：系统时钟 + 番茄倒计时 + 双方在线时长监督 -->
    <div class="relative w-full max-w-2xl px-2 pt-28 pb-48 text-center z-10">
      <div class="text-sm font-data text-inherit">
        {{ clockText }}
      </div>
      <div class="mt-1 text-sm opacity-70">{{ dateText }}</div>

      <div class="mt-6 text-sm tracking-widest opacity-85" :class="bgUrl ? '' : 'opacity-70'">
        {{ phase === 'focus' && !running ? '已暂停' : PHASE_TEXT[phase] }} ·
        {{ session.mode === 'countup' ? '本次已专注' : '本次剩余' }}
      </div>
      <div class="text-6xl md:text-8xl font-data font-bold tabular-nums tracking-tight my-4">{{ display }}</div>

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
          <div class="text-xs opacity-70">我的在线</div>
          <div class="font-data font-bold tabular-nums text-xl">{{ formatDuration(onlineSeconds) }}</div>
        </div>
        <div class="opacity-50">·</div>
        <div class="opacity-90">
          <div class="text-xs opacity-70">{{ session.partnerName }}在线</div>
          <div class="font-data font-bold tabular-nums text-xl">
            {{ formatDuration(session.partnerOnlineSeconds) }}
          </div>
        </div>
      </div>

      <div class="mt-2 text-xs opacity-70">
        与「{{ session.partnerName }}」一起自习 · 我的累计专注 {{ myMinutes }} 分钟
      </div>
    </div>

    <!-- 底部控制按钮（鼠标滑至底部唤起，3 秒无操作自动隐藏） -->
    <div
      class="partner-room-controls absolute bottom-6 inset-x-0 flex flex-col items-center gap-3 px-6 z-10 transition-[opacity,transform] duration-200 ease-out"
      :class="
        controlsVisible
          ? 'opacity-100 translate-y-0 pointer-events-auto'
          : 'opacity-0 translate-y-4 pointer-events-none'
      "
    >
      <input
        v-model="timer.taskDescription"
        maxlength="50"
        aria-label="本次自习任务"
        class="input w-full max-w-md text-center"
        :class="bgUrl ? 'timer-wallpaper-control' : ''"
        placeholder="本次专注的任务（选填）"
      />
      <div class="flex flex-wrap gap-2 justify-center">
        <template v-if="phase !== 'done'">
          <button
            v-if="running"
            class="btn backdrop-blur px-4"
            :class="bgUrl ? 'timer-wallpaper-control' : 'bg-surface border border-line text-ink'"
            @click="timer.pause"
          >
            暂停
          </button>
          <button
            v-else
            class="btn backdrop-blur px-4"
            :class="bgUrl ? 'timer-wallpaper-control' : 'bg-surface border border-line text-ink'"
            @click="timer.start"
          >
            {{ phase === 'idle' ? '开始专注' : '继续专注' }}
          </button>
        </template>
        <span v-else class="text-sm opacity-80 self-center">等待对方完成…</span>
        <button
          v-if="phase === 'focus' && session.mode === 'countup'"
          class="btn-primary px-4"
          :class="bgUrl ? 'timer-wallpaper-control' : ''"
          @click="timer.finishFocus"
        >
          完成专注
        </button>
        <button
          class="btn-danger px-4"
          :class="bgUrl ? 'timer-wallpaper-control' : ''"
          :disabled="timer.ending"
          @click="handleEndBtn"
        >
          {{ timer.ending ? '结束中…' : '结束自习' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
@media (hover: none), (pointer: coarse) {
  .partner-room-controls {
    opacity: 1;
    transform: none;
    pointer-events: auto;
  }
}
.partner-room-controls:focus-within {
  opacity: 1;
  transform: none;
  pointer-events: auto;
}
</style>
