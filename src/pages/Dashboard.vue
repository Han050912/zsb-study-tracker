<script setup lang="ts">
import { computed, inject, onUnmounted, ref } from 'vue'
import { useAppStore } from '../stores/app'
import { today, formatMinutes } from '../utils/date'
import { subjectLabel } from '../utils/subject'
import { DEFAULT_QUOTES } from '../data/defaults'
import Heatmap from '../components/Heatmap.vue'
import ProgressRing from '../components/ProgressRing.vue'
import Modal from '../components/Modal.vue'
import TodoTimeFields from '../components/TodoTimeFields.vue'
import PostComposer from '../components/community/PostComposer.vue'
import LearningPathCard from '../components/LearningPathCard.vue'
import { notifyPermission, requestNotifyPermission } from '../services/notify'
import type { Todo } from '../types'
import dayjs from 'dayjs'

const store = useAppStore()
const toast = inject<(m: string) => void>('toast', () => {})

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

// ---- 快捷入口折叠 ----
const showQuickLinks = ref(false)

// ---- 待办新增：点击「添加」后弹出时间选择器（仅时:分，日期固定为当日）----
const newTodo = ref('')
const showAddSchedule = ref(false)
const addStart = ref('')
const addDue = ref('')

function openAddSchedule() {
  if (!newTodo.value.trim()) return toast('请先输入待办内容')
  addStart.value = ''
  addDue.value = ''
  showAddSchedule.value = true
}
function confirmAddTodo() {
  const startAt = timeToTodayTs(addStart.value)
  const dueAt = timeToTodayTs(addDue.value)
  if (startAt && dueAt && dueAt < startAt) return toast('最晚截止时间不能早于开始时间')
  ensureNotifyPermission(!!startAt || !!dueAt)
  store.addTodo(newTodo.value.trim(), { startAt, dueAt })
  newTodo.value = ''
  showAddSchedule.value = false
  // 两个时间都没填：提示可能无法收到提醒，但仍正常添加（均为可选项）
  toast(startAt || dueAt ? '已添加待办' : '未设定时间，可能会无法收到待办通知')
}

// ---- 修改既有待办的开始 / 最晚截止时间（同样仅限当日，不允许跨日）----
const scheduleEditId = ref('')
const editStart = ref('')
const editDue = ref('')

function openSchedule(t: Todo) {
  scheduleEditId.value = t.id
  editStart.value = t.startAt ? dayjs(t.startAt).format('HH:mm') : ''
  editDue.value = t.dueAt ? dayjs(t.dueAt).format('HH:mm') : ''
}
function saveSchedule() {
  const startAt = timeToTodayTs(editStart.value)
  const dueAt = timeToTodayTs(editDue.value)
  if (startAt && dueAt && dueAt < startAt) return toast('最晚截止时间不能早于开始时间')
  ensureNotifyPermission(!!startAt || !!dueAt)
  store.setTodoSchedule(scheduleEditId.value, { startAt: startAt ?? null, dueAt: dueAt ?? null })
  scheduleEditId.value = ''
  toast('已更新待办时间')
}

/** "HH:mm" 字符串 → 当日时间戳（秒/毫秒归零）；空值/非法值返回 undefined。日期强制为今日，不可跨日 */
function timeToTodayTs(v: string): number | undefined {
  if (!v) return undefined
  const [h, m] = v.split(':').map(Number)
  if (Number.isNaN(h) || Number.isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) return undefined
  return dayjs().hour(h).minute(m).second(0).millisecond(0).valueOf()
}

/** 首次为待办设定时间时申请通知权限，确保到点能弹出系统通知 */
async function ensureNotifyPermission(scheduled: boolean) {
  if (!scheduled || notifyPermission() !== 'default') return
  if (await requestNotifyPermission() === 'denied') toast('浏览器已拒绝通知权限，到点将改用页面内提示')
}

// 每 30s 推进一次「当前时间」，让截止徽标能自动切换为逾期样式
const now = ref(Date.now())
const nowTimer = setInterval(() => { now.value = Date.now() }, 30_000)
onUnmounted(() => clearInterval(nowTimer))

/** 待办时间展示：当天只显示 HH:mm，跨天带上日期 */
function fmtTodoTime(ts: number) {
  const d = dayjs(ts)
  return d.isSame(dayjs(), 'day') ? d.format('HH:mm') : d.format('MM-DD HH:mm')
}
/** 已过最晚截止时间且未完成 */
function isOverdue(t: Todo) {
  return !!t.dueAt && !t.done && t.dueAt <= now.value
}

const goalPercent = computed(() => {
  const goal = store.settings.dailyGoalMinutes
  return goal > 0 ? Math.min(100, (store.todayMinutes / goal) * 100) : 0
})

// ---- 分享打卡到社区广场 ----
const showComposer = ref(false)
const composerContent = ref('')

/** 聚合今日学习数据生成打卡帖预设内容 */
function openCheckinShare() {
  if (!store.todayRecords.length && !store.todayPomodoro.count) {
    toast('今天还没有学习记录，先学习一会儿再来打卡吧')
    return
  }
  const bySubject: Record<string, number> = {}
  for (const r of store.todayRecords) bySubject[r.subjectId] = (bySubject[r.subjectId] || 0) + r.minutes
  const subjectParts = Object.entries(bySubject)
    .map(([sid, min]) => `${store.subjectMap[sid]?.name || '未知科目'} ${formatMinutes(min)}`)
    .join('、')
  composerContent.value = [
    '今日学习打卡',
    subjectParts ? `${subjectParts}` : '',
    `共 ${formatMinutes(store.todayMinutes)} · ${store.todayPomodoro.count} 个番茄钟 · 连续 ${store.gamification.streak} 天`
  ].filter(Boolean).join('\n')
  showComposer.value = true
}

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
        <h1 class="page-title">你好，{{ store.settings.userName }} </h1>
        <p class="text-xs text-slate-400 mt-0.5">{{ today() }} · 连续学习 {{ store.gamification.streak }} 天</p>
      </div>
      <div class="text-right">
        <div class="text-xs text-slate-400">{{ store.level.name }}学者</div>
        <div class="text-sm font-bold text-primary-500">{{ store.gamification.points }} 积分</div>
        <button class="btn-ghost !text-xs !px-2 !py-1 mt-1" @click="openCheckinShare">分享打卡</button>
      </div>
    </div>

    <!-- 倒计时 + 名言 -->
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <div class="card bg-gradient-to-br from-primary-500 to-indigo-600 !text-white border-0">
        <div class="text-xs opacity-80">距离专升本考试</div>
        <div v-if="store.examCountdown !== null" class="mt-1">
          <template v-if="store.examCountdown > 0">
            <span class="text-4xl font-black">{{ store.examCountdown }}</span><span class="ml-1">天</span>
          </template>
          <div v-else class="text-2xl font-black">就是今天，加油！</div>
        </div>
        <RouterLink v-else to="/settings" class="text-sm underline opacity-90 mt-2 inline-block">去设置考试日期 →</RouterLink>
        <div class="text-xs opacity-80 mt-2">{{ store.examCountdown === 0 ? '沉着应考，你付出的每一分努力都算数！' : '坚持到底，就是胜利！' }}</div>
      </div>
      <div class="card flex flex-col justify-center">
        <div class="text-xs text-slate-400 mb-1">今日名言</div>
        <p class="text-sm font-medium leading-relaxed">{{ quote }}</p>
      </div>
    </div>

    <!-- 周学习计划（学习路径推荐） -->
    <LearningPathCard />

    <!-- 今日概览 -->
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <div class="card !p-3 text-center">
        <div class="text-2xl font-black text-primary-500">{{ formatMinutes(store.todayMinutes) }}</div>
        <div class="text-[11px] text-slate-400 mt-0.5">今日学习时长</div>
        <div class="w-full h-1.5 bg-slate-100 dark:bg-slate-700 rounded-full mt-2 overflow-hidden">
          <div class="h-full bg-primary-400 rounded-full transition-all duration-700" :style="{ width: goalPercent + '%' }"></div>
        </div>
        <div class="text-[10px] text-slate-400 mt-1">目标 {{ formatMinutes(store.settings.dailyGoalMinutes) }}</div>
      </div>
      <div class="card !p-3 text-center">
        <div class="text-2xl font-black text-emerald-500">{{ todayDoneTodos }}/{{ store.todayTodos.length }}</div>
        <div class="text-[11px] text-slate-400 mt-0.5">今日待办完成</div>
      </div>
      <div class="card !p-3 text-center">
        <div class="text-2xl font-black text-orange-500">{{ store.todayPomodoro.count }}</div>
        <div class="text-[11px] text-slate-400 mt-0.5">今日番茄钟</div>
        <div class="text-[10px] text-slate-400">平均 {{ store.todayPomodoro.count ? (store.todayPomodoro.minutes / store.todayPomodoro.count).toFixed(1) : '0.0' }} 分/个</div>
      </div>
      <div class="card !p-3 text-center">
        <div class="text-2xl font-black text-purple-500">{{ store.gamification.streak }}</div>
        <div class="text-[11px] text-slate-400 mt-0.5">连续学习天数</div>
      </div>
    </div>

    <!-- 待办 + 进度环 -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div class="card">
        <div class="section-title">今日待办</div>
        <div class="flex gap-2 mb-3">
          <input v-model="newTodo" class="input" placeholder="添加今日学习任务，回车确认" @keyup.enter="openAddSchedule" />
          <button class="btn-primary shrink-0" @click="openAddSchedule">添加</button>
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
            <!-- 拖拽手柄：pointerdown 触发拖拽，桌面/移动端通用 -->
            <span data-drag-handle
              class="cursor-grab active:cursor-grabbing text-slate-300 hover:text-slate-500 dark:hover:text-slate-300 touch-none shrink-0"
              title="拖动排序"
              @pointerdown="onPointerDown($event, t.id)">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="18" r="1"/></svg>
            </span>
            <input type="checkbox" :checked="t.done" class="w-4 h-4 accent-primary-500" @change="store.toggleTodo(t.id)" />
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-1.5 flex-wrap">
                <span class="text-sm leading-5 transition-colors duration-200"
                  :class="t.done ? 'line-through text-slate-400 dark:text-slate-500 decoration-slate-300 dark:decoration-slate-600' : 'text-slate-700 dark:text-slate-200'">
                  {{ t.text }}
                </span>
                <span v-if="t.done && t.completedAt"
                  class="inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-px rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-300 tabular-nums">
                  <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
                  完成于 {{ fmtCompletedAt(t.completedAt) }}
                </span>
              </div>
              <div v-if="t.startAt || t.dueAt" class="flex flex-wrap items-center gap-1.5 mt-1">
                <button v-if="t.startAt" type="button"
                  class="inline-flex items-center gap-1 text-[10px] font-medium pl-1.5 pr-2 py-0.5 rounded-full bg-sky-50 text-sky-600 dark:bg-sky-900/30 dark:text-sky-300 tabular-nums transition-all duration-150 hover:bg-sky-100 hover:shadow-sm hover:shadow-sky-100 dark:hover:bg-sky-900/50 active:scale-95"
                  title="点击修改时间" @click="openSchedule(t)">
                  <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="6 3 20 12 6 21 6 3"/></svg>
                  {{ fmtTodoTime(t.startAt) }} 开始
                </button>
                <button v-if="t.dueAt" type="button"
                  class="inline-flex items-center gap-1 text-[10px] pl-1.5 pr-2 py-0.5 rounded-full tabular-nums transition-all duration-150 active:scale-95"
                  :class="isOverdue(t)
                    ? 'font-semibold bg-rose-50 text-rose-600 ring-1 ring-rose-200 dark:bg-rose-900/30 dark:text-rose-300 dark:ring-rose-800 hover:bg-rose-100 hover:shadow-sm hover:shadow-rose-100 dark:hover:bg-rose-900/50'
                    : 'font-medium bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-300 hover:bg-amber-100 hover:shadow-sm hover:shadow-amber-100 dark:hover:bg-amber-900/50'"
                  title="点击修改时间" @click="openSchedule(t)">
                  <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22"/><path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"/></svg>
                  最晚 {{ fmtTodoTime(t.dueAt) }}
                  <span v-if="isOverdue(t)" class="inline-flex items-center gap-1">
                    <span class="w-1 h-1 rounded-full bg-rose-500 animate-pulse"></span>已逾期未完成
                  </span>
                </button>
              </div>
            </div>
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
            <span class="text-xs">{{ subjectLabel(s) }}</span>
          </RouterLink>
        </div>
      </div>
    </div>

    <!-- 热力图 -->
    <div class="card">
      <div class="section-title">学习热力图（近 {{ 20 }} 周）</div>
      <Heatmap :data="store.minutesByDate" @select="d => heatDate = d" />
      <p class="text-[10px] text-slate-400 mt-2">点击日期格子可查看当日学习总时长明细</p>
    </div>

    <!-- 快捷入口（默认折叠，点击展开） -->
    <div>
      <button
        class="w-full flex items-center justify-center gap-1.5 py-2 text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
        :aria-expanded="showQuickLinks"
        @click="showQuickLinks = !showQuickLinks">
        <span>快捷入口</span>
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
          class="transition-transform duration-200" :class="showQuickLinks ? 'rotate-180' : ''">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>
      <div v-if="showQuickLinks" class="grid grid-cols-4 sm:grid-cols-8 gap-2">
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
    </div>

    <!-- 热力图当日学习明细弹窗 -->
    <!-- 新增待办：开始 / 最晚截止时间选择器（仅时:分，日期固定为当日）-->
    <Modal title="设定待办时间" :show="showAddSchedule" @close="showAddSchedule = false">
      <TodoTimeFields v-model:start="addStart" v-model:due="addDue"
        hint="时间均为「当日」的时刻，待办须在今日完成；两项均为选填。" />
      <template #footer>
        <button class="btn-ghost" @click="showAddSchedule = false">取消</button>
        <button class="btn-primary" @click="confirmAddTodo">添加</button>
      </template>
    </Modal>

    <!-- 修改既有待办的开始 / 最晚截止时间（同样仅限当日，不允许跨日）-->
    <Modal title="待办时间设置" :show="!!scheduleEditId" @close="scheduleEditId = ''">
      <TodoTimeFields v-model:start="editStart" v-model:due="editDue" />
      <template #footer>
        <button class="btn-ghost" @click="scheduleEditId = ''">取消</button>
        <button class="btn-primary" @click="saveSchedule">保存</button>
      </template>
    </Modal>

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
            <span class="font-medium">{{ subjectLabel(store.subjectMap[r.subjectId], '已删除科目') }}</span>
            <span class="flex-1 text-xs text-slate-400 truncate">{{ r.note || '—' }}</span>
            <span class="font-semibold shrink-0" :style="{ color: store.subjectMap[r.subjectId]?.color || '#94a3b8' }">{{ formatMinutes(r.minutes) }}</span>
          </div>
        </div>
      </div>
    </Modal>

    <!-- 分享打卡到社区广场 -->
    <PostComposer v-model:show="showComposer" type="checkin" :preset-content="composerContent"
      :preset-tags="['#每日打卡']" ref-type="record" :ref-id="today()" />
  </div>
</template>