<script setup lang="ts">
import { computed, inject, onUnmounted, ref } from 'vue'
import { useAppStore } from '../stores/app'
import { today, formatMinutes } from '../utils/date'
import { DEFAULT_QUOTES } from '../data/defaults'
import Heatmap from '../components/Heatmap.vue'
import ProgressRing from '../components/ProgressRing.vue'
import Modal from '../components/Modal.vue'
import dayjs from 'dayjs'

const store = useAppStore()
const toast = inject<(m: string) => void>('toast', () => {})

const showMore = ref(false)

const quote = computed(() => {
  const list = store.settings.quotes.length ? store.settings.quotes : DEFAULT_QUOTES
  const idx = Math.floor(Date.now() / 86400000) % list.length
  return list[idx]
})

const todayDoneTodos = computed(() => store.todayTodos.filter(t => t.done).length)

function subjectPercent(subjectId: string) {
  const s = store.subjectMap[subjectId]
  if (!s) return 0
  const topics = s.chapters.flatMap(c => c.topics)
  if (!topics.length) {
    // 无章节时用学习记录天数衡量
    const days = new Set(store.records.filter(r => r.subjectId === subjectId).map(r => r.date)).size
    return Math.min(100, days * 5)
  }
  const sum = topics.reduce((acc, t) => acc + (s.mastery[t] || 0), 0)
  return (sum / (topics.length * 5)) * 100
}

const newTodo = ref('')
function addTodo() {
  if (!newTodo.value.trim()) return
  store.addTodo(newTodo.value.trim())
  newTodo.value = ''
  toast('已添加待办')
}

const goalPercent = computed(() => Math.min(100, (store.todayMinutes / store.settings.dailyGoalMinutes) * 100))

// ---- 热力图点击：当日学习总时长明细 ----
const heatDate = ref('')
const heatRecords = computed(() => store.records.filter(r => r.date === heatDate.value))
const heatTotal = computed(() => heatRecords.value.reduce((s, r) => s + r.minutes, 0))

/** 待办完成时间格式化（HH:mm） */
function fmtCompletedAt(ts?: number | null) {
  return ts ? dayjs(ts).format('HH:mm') : ''
}

// ===== 待办拖拽排序（Pointer 事件，统一支持桌面鼠标与移动端触摸）=====
const listRef = ref<HTMLElement | null>(null)
/** 拖拽中的待办 id；null 表示当前未拖拽 */
const draggingId = ref<string | null>(null)
/** 插入边界处的卡片 id（松手后拖到它前面），用于高亮提示 */
const overId = ref<string | null>(null)
/** 拖拽卡片垂直位移像素，配合 transform 让卡片跟手移动 */
const dragShift = ref(0)
const pointerStartY = ref(0)
/** 插入位（在「排除被拖拽项」列表中的下标）；-1 表示尚未移动 */
let insertIndex = -1
/** 是否发生了有效位移（区分「点击手柄」与「真实拖拽」，空拖不提交排序） */
let dragMoved = false

function todoItemEls(): HTMLElement[] {
  return listRef.value ? Array.from(listRef.value.querySelectorAll<HTMLElement>('[data-todo-item]')) : []
}

function onPointerDown(e: PointerEvent, id: string) {
  // 捕获指针，保证移出手柄/浏览器窗口后仍能收到 move/up（含触摸）
  ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
  draggingId.value = id
  overId.value = null
  insertIndex = -1
  dragMoved = false
  pointerStartY.value = e.clientY
  dragShift.value = 0
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointercancel', onPointerCancel)
}

function onPointerMove(e: PointerEvent) {
  if (!draggingId.value) return
  const delta = e.clientY - pointerStartY.value
  if (Math.abs(delta) > 4) dragMoved = true
  dragShift.value = delta
  // 计算插入位：指针在某卡片中线以上 → 插到它前面；全部越过 → 插到末尾
  const others = todoItemEls().filter(el => el.dataset.todoItem !== draggingId.value)
  insertIndex = others.length
  overId.value = null
  for (let i = 0; i < others.length; i++) {
    const rect = others[i].getBoundingClientRect()
    if (e.clientY < rect.top + rect.height / 2) {
      insertIndex = i
      overId.value = others[i].dataset.todoItem!
      break
    }
  }
}

/** 结束拖拽；commit 为 false（pointercancel）时仅还原状态，不提交排序 */
function finishDrag(commit: boolean) {
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('pointercancel', onPointerCancel)
  const id = draggingId.value
  if (commit && id && dragMoved && insertIndex >= 0) {
    const all = todoItemEls().map(el => el.dataset.todoItem!)
    const from = all.indexOf(id)
    if (from >= 0 && insertIndex !== from) {
      const rest = all.filter(x => x !== id)
      rest.splice(insertIndex, 0, id)
      store.reorderTodos(rest)
    }
  }
  draggingId.value = null
  overId.value = null
  dragShift.value = 0
  insertIndex = -1
  dragMoved = false
}

function onPointerUp() { finishDrag(true) }
function onPointerCancel() { finishDrag(false) }

// 组件卸载（拖拽中切路由等极端情况）兜底清理 window 监听器，防止泄漏
onUnmounted(() => {
  if (draggingId.value) finishDrag(false)
})
</script>

<template>
  <div class="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
    <!-- 头部 -->
    <div class="flex items-center justify-between">
      <div>
        <h1 class="page-title">你好，{{ store.settings.userName }} 👋</h1>
        <p class="text-xs text-slate-400 mt-0.5">{{ today() }}</p>
      </div>
      <div class="text-right">
        <div class="text-xs text-slate-400">{{ store.level.name }}学者</div>
        <div class="text-sm font-bold text-primary-500">{{ store.gamification.points }} 积分</div>
      </div>
    </div>

    <!-- 核心聚焦区：进度环 + 指标 -->
    <div class="card flex flex-col sm:flex-row items-center gap-4 py-6">
      <ProgressRing :percent="goalPercent" :color="'var(--color-primary-500)'" :size="120" />
      <div class="flex-1 space-y-3 text-sm">
        <div class="flex items-center gap-2">
          <span class="text-slate-400">今日专注</span>
          <span class="text-2xl font-black text-primary-500">{{ formatMinutes(store.todayMinutes) }}</span>
          <span class="text-xs text-slate-400">/ {{ formatMinutes(store.settings.dailyGoalMinutes) }} 目标</span>
        </div>
        <div class="flex flex-wrap gap-3">
          <span class="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-orange-50 dark:bg-orange-900/20 text-orange-600 text-xs font-medium">
            🔥 连续打卡 {{ store.gamification.streak }} 天
          </span>
          <span class="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-purple-50 dark:bg-purple-900/20 text-purple-600 text-xs font-medium">
            🏆 {{ store.level.name }}学者
          </span>
          <span class="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 text-xs font-medium">
            🍅 {{ store.todayPomodoro.count }} 个番茄
          </span>
        </div>
      </div>
    </div>

    <!-- 热力图 -->
    <div class="card">
      <div class="section-title">🔥 学习热力图（近 {{ 20 }} 周）</div>
      <Heatmap :data="store.minutesByDate" @select="d => heatDate = d" />
      <p class="text-[10px] text-slate-400 mt-2">点击日期格子可查看当日学习总时长明细</p>
    </div>

    <!-- 折叠切换 -->
    <button class="w-full text-center text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 py-2 transition-colors"
      @click="showMore = !showMore">
      {{ showMore ? '收起更多 ▲' : '展开更多 ▼' }}
    </button>

    <!-- 次要内容：倒计时+名言、待办+进度环、快捷入口 -->
    <template v-if="showMore">
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div class="card bg-gradient-to-br from-primary-500 to-indigo-600 !text-white border-0">
          <div class="text-xs opacity-80">🎯 距离专升本考试</div>
          <div v-if="store.examCountdown !== null" class="mt-1">
            <span class="text-4xl font-black">{{ store.examCountdown }}</span><span class="ml-1">天</span>
          </div>
          <RouterLink v-else to="/settings" class="text-sm underline opacity-90 mt-2 inline-block">去设置考试日期 →</RouterLink>
          <div class="text-xs opacity-80 mt-2">坚持到底，就是胜利！</div>
        </div>
        <div class="card flex flex-col justify-center">
          <div class="text-xs text-slate-400 mb-1">📜 今日名言</div>
          <p class="text-sm font-medium leading-relaxed">{{ quote }}</p>
        </div>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div class="card">
          <div class="section-title">📋 今日待办</div>
          <div class="flex gap-2 mb-3">
            <input v-model="newTodo" class="input" placeholder="添加今日学习任务，回车确认" @keyup.enter="addTodo" />
            <button class="btn-primary shrink-0" @click="addTodo">添加</button>
          </div>
          <div v-if="!store.todayTodos.length" class="text-xs text-slate-400 py-4 text-center">暂无待办，添加一个吧～</div>
          <div ref="listRef" class="space-y-1.5">
            <div v-for="t in store.todayTodos" :key="t.id"
              :data-todo-item="t.id"
              class="flex items-center gap-2 rounded-lg px-2 py-1.5 group hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors select-none"
              :class="{
                'opacity-40': draggingId === t.id,
                'ring-2 ring-primary-400 bg-primary-50 dark:bg-primary-900/30': overId === t.id && draggingId && draggingId !== t.id,
                'shadow-lg scale-[1.02] cursor-grabbing bg-white dark:bg-slate-800 z-10': draggingId === t.id
              }"
              :style="draggingId === t.id ? { transform: `translateY(${dragShift}px)` } : {}">
              <span data-drag-handle
                class="cursor-grab active:cursor-grabbing text-slate-300 hover:text-slate-500 dark:hover:text-slate-300 touch-none shrink-0"
                title="拖动排序"
                @pointerdown="onPointerDown($event, t.id)">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="18" r="1"/></svg>
              </span>
              <input type="checkbox" :checked="t.done" class="w-4 h-4 accent-primary-500" @change="store.toggleTodo(t.id)" />
              <span class="flex-1 text-sm" :class="t.done ? 'line-through text-slate-400' : ''">
                {{ t.text }}
                <span v-if="t.done && t.completedAt" class="ml-1 inline-block text-[10px] text-emerald-500">完成于 {{ fmtCompletedAt(t.completedAt) }}</span>
              </span>
              <button class="opacity-0 group-hover:opacity-100 text-xs text-red-400 shrink-0" title="删除" @click="store.deleteTodo(t.id)">×</button>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="section-title">⭕ 科目掌握进度</div>
          <div class="flex flex-wrap gap-4 justify-center py-2">
            <RouterLink v-for="s in store.subjects" :key="s.id"
              :to="s.id === 'math' ? '/math' : s.id === 'english' ? '/english' : `/subject/${s.id}`"
              class="flex flex-col items-center gap-1">
              <ProgressRing :percent="subjectPercent(s.id)" :color="s.color" :size="76" :label="s.name" />
              <span class="text-xs">{{ s.icon }} {{ s.name }}</span>
            </RouterLink>
          </div>
        </div>
      </div>

      <div class="grid grid-cols-4 sm:grid-cols-8 gap-2">
        <RouterLink v-for="q in [
          { to: '/pomodoro', icon: '🍅', label: '专注' }, { to: '/daily-summary', icon: '📝', label: '总结' },
          { to: '/error-book', icon: '📕', label: '错题' }, { to: '/habits', icon: '✅', label: '习惯' },
          { to: '/statistics', icon: '📊', label: '统计' }, { to: '/rewards', icon: '🏆', label: '成就' },
          { to: '/materials', icon: '📚', label: '资料' }, { to: '/settings', icon: '⚙️', label: '设置' }
        ]" :key="q.to" :to="q.to" class="card !p-3 flex flex-col items-center gap-1 hover:shadow-md transition-shadow">
          <span class="text-xl">{{ q.icon }}</span>
          <span class="text-[11px] text-slate-500 dark:text-slate-400">{{ q.label }}</span>
        </RouterLink>
      </div>
    </template>

    <!-- 热力图当日学习明细弹窗 -->
    <Modal :title="`${heatDate} 学习明细`" :show="!!heatDate" @close="heatDate = ''">
      <div class="space-y-3">
        <div class="flex items-center justify-between bg-primary-50 dark:bg-primary-900/30 rounded-xl px-4 py-3">
          <span class="text-sm text-slate-500 dark:text-slate-400">当日学习总时长</span>
          <span class="text-xl font-black text-primary-500">{{ formatMinutes(heatTotal) }}</span>
        </div>
        <div v-if="!heatRecords.length" class="text-xs text-slate-400 text-center py-4">当日暂无学习记录</div>
        <div v-else class="space-y-2">
          <div v-for="r in heatRecords" :key="r.id" class="flex items-center gap-2 text-sm border border-slate-100 dark:border-slate-700 rounded-xl px-3 py-2">
            <span class="w-2.5 h-2.5 rounded-full shrink-0" :style="{ background: store.subjectMap[r.subjectId]?.color || '#94a3b8' }"></span>
            <span class="font-medium">{{ store.subjectMap[r.subjectId]?.icon }} {{ store.subjectMap[r.subjectId]?.name || '已删除科目' }}</span>
            <span class="flex-1 text-xs text-slate-400 truncate">{{ r.note || '—' }}</span>
            <span class="font-semibold shrink-0" :style="{ color: store.subjectMap[r.subjectId]?.color || '#94a3b8' }">{{ formatMinutes(r.minutes) }}</span>
          </div>
        </div>
      </div>
    </Modal>
  </div>
</template>
