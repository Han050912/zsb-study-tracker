<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useToast } from '../../composables/useToast'
import { useAppStore } from '../../stores/app'
import { today } from '../../utils/date'

const props = defineProps<{ subjectId: string }>()
const store = useAppStore()
const toast = useToast()

const subject = computed(() => store.subjectMap[props.subjectId])

const subjectRecords = computed(() =>
  store.records
    .filter((r) => r.subjectId === props.subjectId)
    .slice()
    .reverse()
)

// ---- 学习记录（含计时器） ----
const recMinutes = ref(30)
const recChapter = ref('')
const recTopic = ref('')
const recNote = ref('')
const timerRunning = ref(false)
const timerSeconds = ref(0)
let timerHandle: ReturnType<typeof setInterval> | null = null
/** 当前计时段的起始时间戳（Date.now()），恢复计时后重新赋值 */
let timerStartTimestamp = 0
/** 暂停前已累计的秒数，恢复计时后与新的时间差累加 */
let timerPausedElapsed = 0

/** 基于起始时间戳计算已用秒数（同 Pomodoro.tick），后台节流 / 锁屏恢复后仍是真实时长 */
function tickTimer() {
  timerSeconds.value = timerPausedElapsed + Math.floor((Date.now() - timerStartTimestamp) / 1000)
}

/** 页面从后台恢复可见时立即校准显示 */
function handleVisibilityChange() {
  if (!document.hidden && timerRunning.value) tickTimer()
}

function startTimer() {
  timerStartTimestamp = Date.now()
  timerRunning.value = true
  timerHandle = setInterval(tickTimer, 1000)
}
function pauseTimer() {
  if (!timerRunning.value) return
  timerRunning.value = false
  if (timerHandle) {
    clearInterval(timerHandle)
    timerHandle = null
  }
  timerPausedElapsed += Math.floor((Date.now() - timerStartTimestamp) / 1000)
  timerSeconds.value = timerPausedElapsed
}
function stopTimer() {
  pauseTimer()
  recMinutes.value = Math.max(1, Math.round(timerPausedElapsed / 60))
  timerPausedElapsed = 0
  timerSeconds.value = 0
  toast(`计时结束：${recMinutes.value} 分钟`)
}
function fmtTimer(s: number) {
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

function addRecord() {
  if (recMinutes.value <= 0) return
  store.addRecord({
    subjectId: props.subjectId,
    date: today(),
    minutes: recMinutes.value,
    chapterId: recChapter.value || undefined,
    topic: recTopic.value || undefined,
    note: recNote.value || undefined
  })
  recNote.value = ''
  toast(`已记录 ${recMinutes.value} 分钟学习 +积分`)
}

onMounted(() => {
  document.addEventListener('visibilitychange', handleVisibilityChange)
})
onUnmounted(() => {
  if (timerHandle) clearInterval(timerHandle)
  document.removeEventListener('visibilitychange', handleVisibilityChange)
})
</script>

<template>
  <div class="card space-y-3">
    <div class="section-title">记录本次学习</div>
    <!-- 计时器 -->
    <div class="flex items-center justify-center gap-3 py-2">
      <span class="text-3xl font-mono font-bold tabular-nums" :class="timerRunning ? 'text-emerald-500' : ''">{{
        fmtTimer(timerSeconds)
      }}</span>
      <button v-if="!timerRunning" class="btn-primary" @click="startTimer">▶ 开始</button>
      <button v-else class="btn-ghost" @click="pauseTimer">⏸ 暂停</button>
      <button class="btn-danger" :disabled="!timerSeconds" @click="stopTimer">⏹ 结束</button>
    </div>
    <div class="grid grid-cols-2 gap-3">
      <div>
        <label class="label">时长（分钟）</label>
        <input v-model.number="recMinutes" type="number" min="1" class="input" />
      </div>
      <div>
        <label class="label">章节</label>
        <select v-model="recChapter" class="input">
          <option value="">不限</option>
          <option v-for="ch in subject.chapters" :key="ch.id" :value="ch.id">{{ ch.name }}</option>
        </select>
      </div>
    </div>
    <div>
      <label class="label">知识点 / 备注</label>
      <input v-model="recNote" class="input" placeholder="例如：洛必达法则错题整理" />
    </div>
    <button class="btn-primary w-full" @click="addRecord">保存记录（+积分）</button>
  </div>
  <div class="card">
    <div class="section-title">历史记录</div>
    <div v-if="!subjectRecords.length" class="text-xs text-slate-400 text-center py-3">暂无记录</div>
    <div class="space-y-1.5 max-h-72 overflow-y-auto">
      <div v-for="r in subjectRecords" :key="r.id" class="flex items-center gap-2 text-sm group">
        <span class="text-xs text-slate-400 w-20 shrink-0">{{ r.date }}</span>
        <span class="font-medium w-16 shrink-0" :style="{ color: subject.color }">{{ r.minutes }}分钟</span>
        <span class="flex-1 text-slate-500 truncate text-xs">{{ r.note || '—' }}</span>
        <button class="opacity-0 group-hover:opacity-100 text-red-400 text-xs" @click="store.deleteRecord(r.id)">
          删除
        </button>
      </div>
    </div>
  </div>
</template>
