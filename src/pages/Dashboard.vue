<script setup lang="ts">
import EmptyState from '../shared/components/EmptyState.vue'
import { computed, onUnmounted, ref } from 'vue'
import { useToast } from '../composables/useToast'
import { useConfirm } from '../composables/useConfirm'
import { useAppStore } from '../stores/app'
import { formatMinutes } from '../utils/date'
import { subjectLabel } from '../utils/subject'
import { DEFAULT_QUOTES } from '../data/defaults'
import Heatmap from '../components/Heatmap.vue'
import ExamAnswerStrip from '../components/ExamAnswerStrip.vue'
import DashboardCompanions from '../components/DashboardCompanions.vue'
import NavIcon from '../components/NavIcon.vue'
import { masteryOverview } from '../utils/studyOverview'
import { Play, GripVertical, Pencil, Trash2, ChevronUp, ChevronDown, ArrowRight } from '@lucide/vue'
import SubjectIcon from '../components/SubjectIcon.vue'
import Modal from '../components/Modal.vue'
import TodoTimeFields from '../components/TodoTimeFields.vue'
import PostComposer from '../components/community/PostComposer.vue'
import LearningPathCard from '../components/LearningPathCard.vue'
import { notifyPermission, requestNotifyPermission } from '../services/notify'
import type { Todo } from '../types'
import dayjs from 'dayjs'

const store = useAppStore()
const toast = useToast()
const confirm = useConfirm()

const quote = computed(() => {
  const list = store.settings.quotes.length ? store.settings.quotes : DEFAULT_QUOTES
  const idx = Math.floor(Date.now() / 86400000) % list.length
  return list[idx]
})

const todayDoneTodos = computed(() => store.todayTodos.filter((t) => t.done).length)

const nextTodo = computed(() => store.todayTodos.find((t) => !t.done))
const subjectOverviews = computed(() =>
  store.subjects.map((subject) => ({
    subject,
    ...masteryOverview(subject),
    pendingErrors: store.errorQuestions.filter((q) => q.subjectId === subject.id && !q.mastered).length,
    lastExam: store.exams
      .filter((exam) => exam.subjectId === subject.id)
      .sort((a, b) => b.date.localeCompare(a.date))[0]
  }))
)
function subjectRoute(id: string) {
  return id === 'math' || id === 'english' ? `/${id}` : `/subject/${id}`
}
function moveTodo(id: string, direction: number) {
  const ids = store.todayTodos.map((todo) => todo.id)
  const index = ids.indexOf(id)
  const target = index + direction
  if (target < 0 || target >= ids.length) return
  ;[ids[index], ids[target]] = [ids[target], ids[index]]
  store.reorderTodos(ids)
  toast(`任务已移至第 ${target + 1} 项`)
}
function toggleTodo(todo: Todo) {
  store.toggleTodo(todo.id)
  toast(todo.done ? '任务已完成' : '任务已恢复')
}

async function deleteTodo(todo: Todo) {
  if (!(await confirm(`删除任务「${todo.text}」？删除后无法恢复。`, { danger: true }))) return
  store.deleteTodo(todo.id)
  toast('任务已删除')
}

// ---- 修改任务内容；取消编辑不写入任务，提醒和完成记录由 store 保留 ----
const titleEditId = ref('')
const editTitle = ref('')
const titleEditError = ref('')
function openTitleEdit(todo: Todo) {
  titleEditId.value = todo.id
  editTitle.value = todo.text
  titleEditError.value = ''
}
function saveTodoTitle() {
  const title = editTitle.value.trim()
  if (!title) {
    titleEditError.value = '请填写任务内容'
    return
  }
  if (!store.todos.some((todo) => todo.id === titleEditId.value)) {
    titleEditError.value = '任务已不存在，请关闭弹窗后重试'
    return
  }
  store.updateTodo(titleEditId.value, title)
  titleEditId.value = ''
  toast('任务内容已更新')
}

// ---- 快捷入口折叠 ----
const showQuickLinks = ref(false)

// ---- 任务新增：点击「添加」后弹出时间选择器（仅时:分，日期固定为当日）----
const newTodo = ref('')
const showAddSchedule = ref(false)
const addStart = ref('')
const addDue = ref('')

function openAddSchedule() {
  if (!newTodo.value.trim()) return toast('请先输入任务内容')
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
  toast(startAt || dueAt ? '任务已添加，已设置提醒' : '任务已添加，未设置提醒')
}

// ---- 修改既有任务的开始 / 最晚截止时间（同样仅限当日，不允许跨日）----
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
  toast('已更新任务时间')
}

/** "HH:mm" 字符串 → 当日时间戳（秒/毫秒归零）；空值/非法值返回 undefined。日期强制为今日，不可跨日 */
function timeToTodayTs(v: string): number | undefined {
  if (!v) return undefined
  const [h, m] = v.split(':').map(Number)
  if (Number.isNaN(h) || Number.isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) return undefined
  return dayjs().hour(h).minute(m).second(0).millisecond(0).valueOf()
}

/** 首次为任务设定时间时申请通知权限，确保到点能弹出系统通知 */
async function ensureNotifyPermission(scheduled: boolean) {
  if (!scheduled || notifyPermission() !== 'default') return
  if ((await requestNotifyPermission()) === 'denied') toast('浏览器已拒绝通知权限，到点将改用页面内提示')
}

// 每 30s 推进一次「当前时间」，让截止徽标能自动切换为逾期样式
const now = ref(Date.now())
const nowTimer = setInterval(() => {
  now.value = Date.now()
}, 30_000)
onUnmounted(() => clearInterval(nowTimer))

/** 任务时间展示：当天只显示 HH:mm，跨天带上日期 */
function fmtTodoTime(ts: number) {
  const d = dayjs(ts)
  return d.isSame(dayjs(), 'day') ? d.format('HH:mm') : d.format('MM-DD HH:mm')
}
/** 已过最晚截止时间且未完成 */
function isOverdue(t: Todo) {
  return !!t.dueAt && !t.done && t.dueAt <= now.value
}

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
  ]
    .filter(Boolean)
    .join('\n')
  showComposer.value = true
}

// ---- 热力图点击：当日学习总时长明细 ----
const heatDate = ref('')
const heatRecords = computed(() => store.records.filter((r) => r.date === heatDate.value))
const heatTotal = computed(() => heatRecords.value.reduce((s, r) => s + r.minutes, 0))

/** 任务完成时间格式化（HH:mm） */
function fmtCompletedAt(ts?: number | null) {
  return ts ? dayjs(ts).format('HH:mm') : ''
}

// ===== 任务拖拽排序（Pointer 事件，统一支持桌面鼠标与移动端触摸）=====
const listRef = ref<HTMLElement | null>(null)
/** 拖拽中的任务 id；null 表示当前未拖拽 */
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
  const others = todoItemEls().filter((el) => el.dataset.todoItem !== draggingId.value)
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
    const all = todoItemEls().map((el) => el.dataset.todoItem!)
    const from = all.indexOf(id)
    if (from >= 0 && insertIndex !== from) {
      const rest = all.filter((x) => x !== id)
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

function onPointerUp() {
  finishDrag(true)
}
function onPointerCancel() {
  finishDrag(false)
}

// 组件卸载（拖拽中切路由等极端情况）兜底清理 window 监听器，防止泄漏
onUnmounted(() => {
  if (draggingId.value) finishDrag(false)
})
</script>

<template>
  <div class="study-page dashboard-page">
    <header class="study-page-heading">
      <div>
        <h1 class="page-title">今天的任务</h1>
        <p class="dashboard-date">{{ store.todayKey.replace(/-/g, '/') }} · {{ store.settings.userName }}的学习日</p>
      </div>
      <button class="btn-ghost" @click="openCheckinShare">分享打卡</button>
    </header>

    <section class="dashboard-next" aria-labelledby="next-task-title">
      <div class="min-w-0">
        <h2 id="next-task-title" class="dashboard-next-title">
          {{
            nextTodo ? `接下来：${nextTodo.text}` : store.todayTodos.length ? '今天的任务已完成' : '从一件具体的事开始'
          }}
        </h2>
        <p v-if="!nextTodo" class="dashboard-next-description">
          {{
            store.todayTodos.length
              ? '回看今天的错题，或为自己留一点休息时间。'
              : '在下方写下这次要学什么，再开始专注计时。'
          }}
        </p>
        <p class="dashboard-next-progress">
          任务已完成 {{ todayDoneTodos }}/{{ store.todayTodos.length }} 项 · 今天
          {{ store.todayPomodoro.count }} 个番茄钟<span v-if="store.todayPomodoro.count"
            >，平均 {{ (store.todayPomodoro.minutes / store.todayPomodoro.count).toFixed(1) }} 分钟</span
          >
        </p>
      </div>
      <RouterLink
        :to="{ path: '/pomodoro', query: nextTodo ? { task: nextTodo.text.slice(0, 50) } : {} }"
        class="btn-primary shrink-0"
        ><Play :size="16" aria-hidden="true" />开始番茄钟</RouterLink
      >
    </section>

    <div class="dashboard-workspace">
      <section class="card dashboard-tasks" aria-labelledby="today-list-title">
        <div class="study-section-heading">
          <h2 id="today-list-title" class="section-title !mb-0">任务清单</h2>
          <span class="text-xs text-muted">按你的顺序</span>
        </div>
        <form class="dashboard-add-task" @submit.prevent="openAddSchedule">
          <input v-model="newTodo" class="input" aria-label="今天要完成的任务" placeholder="例如：重做极限错题 5 道" />
          <button class="btn-primary shrink-0" :disabled="!newTodo.trim()">添加</button>
        </form>
        <EmptyState
          v-if="!store.todayTodos.length"
          title="今天还没有任务"
          description="写下一件能完成的事，再开始计时。"
        />
        <p v-if="store.todayTodos.length" id="todo-sort-hint" class="sr-only">
          拖动排序按钮，或聚焦按钮后按上下方向键调整任务顺序。
        </p>
        <div ref="listRef" class="space-y-1">
          <div
            v-for="t in store.todayTodos"
            :key="t.id"
            :data-todo-item="t.id"
            class="today-task"
            :class="{ 'is-done': t.done, 'is-over': overId === t.id && draggingId !== t.id }"
            :style="draggingId === t.id ? { transform: `translateY(${dragShift}px)`, zIndex: 1 } : {}"
          >
            <button
              type="button"
              data-drag-handle
              class="icon-button touch-none cursor-grab shrink-0"
              :aria-label="`调整任务顺序：${t.text}`"
              aria-describedby="todo-sort-hint"
              @pointerdown="onPointerDown($event, t.id)"
              @keydown.up.prevent="moveTodo(t.id, -1)"
              @keydown.down.prevent="moveTodo(t.id, 1)"
            >
              <GripVertical :size="16" aria-hidden="true" />
            </button>
            <input
              :id="`todo-${t.id}`"
              type="checkbox"
              :checked="t.done"
              class="w-5 h-5 shrink-0"
              @change="toggleTodo(t)"
            />
            <div class="flex-1 min-w-0">
              <label :for="`todo-${t.id}`" class="today-task-label">{{ t.text }}</label>
              <p v-if="t.done && t.completedAt" class="text-xs text-muted">
                完成于 {{ fmtCompletedAt(t.completedAt) }}
              </p>
              <button class="study-link text-xs" :class="{ 'text-correction': isOverdue(t) }" @click="openSchedule(t)">
                <template v-if="t.startAt">{{ fmtTodoTime(t.startAt) }} 开始 · </template>
                {{ t.dueAt ? `${fmtTodoTime(t.dueAt)} 截止` : t.startAt ? '调整时间' : '设置提醒'
                }}{{ isOverdue(t) ? ' · 已超时' : '' }}
              </button>
            </div>
            <button
              type="button"
              class="icon-button shrink-0"
              :aria-label="`编辑任务：${t.text}`"
              title="编辑任务"
              @click="openTitleEdit(t)"
            >
              <Pencil :size="15" aria-hidden="true" />
            </button>
            <button
              type="button"
              class="icon-button shrink-0"
              :aria-label="`删除任务：${t.text}`"
              @click="deleteTodo(t)"
            >
              <Trash2 :size="15" aria-hidden="true" />
            </button>
          </div>
        </div>
      </section>
      <section class="card dashboard-subjects" aria-labelledby="review-subject-title">
        <div class="study-section-heading">
          <h2 id="review-subject-title" class="section-title !mb-0">各科复习</h2>
          <RouterLink to="/error-book" class="text-xs arrow-link"
            >我的错题 <ArrowRight class="arrow-inline" :size="16" aria-hidden="true"
          /></RouterLink>
        </div>
        <p class="text-xs text-muted mb-2">自评反映你的判断；真题成绩单独记录。</p>
        <RouterLink
          v-for="item in subjectOverviews"
          :key="item.subject.id"
          :to="subjectRoute(item.subject.id)"
          class="subject-review-row"
        >
          <div class="dashboard-subject-line">
            <span class="font-bold text-sm"
              ><SubjectIcon :icon="item.subject.icon" class="mr-1" />{{ item.subject.name }}</span
            ><span class="text-xs" :class="item.pendingErrors ? 'text-correction' : 'text-muted'">{{
              item.pendingErrors ? `${item.pendingErrors} 道错题待复习` : '没有待复习错题'
            }}</span>
          </div>
          <p class="text-xs text-muted mt-1">
            {{
              !item.total
                ? '还没有知识点，添加后可自评'
                : item.rated
                  ? `已自评 ${item.rated}/${item.total} 个 · ${item.weak} 个低于 3 分`
                  : `尚未自评 · 共 ${item.total} 个知识点`
            }}
          </p>
          <p v-if="item.lastExam" class="text-xs mt-1">
            最近真题 {{ item.lastExam.score }}/{{ item.lastExam.totalScore }} 分
            <span class="text-muted">· {{ item.lastExam.date.slice(5) }}</span>
          </p>
        </RouterLink>
        <RouterLink v-if="!subjectOverviews.length" to="/settings" class="text-sm arrow-link"
          >先添加考试科目 <ArrowRight class="arrow-inline" :size="16" aria-hidden="true"
        /></RouterLink>
      </section>
    </div>

    <section class="dashboard-support" aria-label="安排与协作">
      <LearningPathCard />
      <DashboardCompanions />
    </section>

    <section class="dashboard-records" aria-labelledby="dashboard-records-title">
      <div class="dashboard-records-heading">
        <h2 id="dashboard-records-title" class="section-title !mb-0">学习记录</h2>
        <p class="text-sm text-muted">看见每天的积累，调整接下来的安排。</p>
      </div>
      <ExamAnswerStrip
        :today="store.todayKey"
        :exam-date="store.settings.examDate"
        :minutes="store.minutesByDate"
        :daily-goal="store.settings.dailyGoalMinutes"
        @select="heatDate = $event"
      />
      <div class="card dashboard-heatmap">
        <h3 class="section-title">近 20 周</h3>
        <Heatmap :data="store.minutesByDate" :end-date="store.todayKey" @select="(d) => (heatDate = d)" />
        <p class="dashboard-record-hint">点击日期查看学习明细；键盘方向键可切换日期。</p>
      </div>
    </section>

    <aside class="dashboard-greeting">
      <p class="text-sm">
        你好，{{ store.settings.userName }}。<span class="text-muted"
          >连续学习 {{ store.gamification.streak }} 天 · {{ store.level.name }}学者 ·
          {{ store.gamification.points }} 积分</span
        >
      </p>
      <p class="text-xs text-muted mt-1">今日名言 · {{ quote }}</p>
    </aside>

    <!-- 快捷入口（默认折叠，点击展开） -->
    <div>
      <button
        type="button"
        class="dashboard-quick-toggle"
        :aria-expanded="showQuickLinks"
        aria-controls="dashboard-quick-links"
        @click="showQuickLinks = !showQuickLinks"
      >
        <span>快捷入口</span>
        <ChevronUp v-if="showQuickLinks" :size="16" aria-hidden="true" />
        <ChevronDown v-else :size="16" aria-hidden="true" />
      </button>
      <div v-if="showQuickLinks" id="dashboard-quick-links" class="panel-reveal dashboard-quick-links">
        <RouterLink
          v-for="q in [
            { to: '/pomodoro', icon: 'Timer', label: '专注' },
            { to: '/daily-summary', icon: 'SquarePen', label: '总结' },
            { to: '/error-book', icon: 'BookMarked', label: '错题' },
            { to: '/habits', icon: 'ListChecks', label: '习惯' },
            { to: '/statistics', icon: 'ChartNoAxesColumn', label: '统计' },
            { to: '/rewards', icon: 'Award', label: '成就' },
            { to: '/materials', icon: 'Library', label: '资料' },
            { to: '/settings', icon: 'Settings', label: '设置' }
          ]"
          :key="q.to"
          :to="q.to"
          class="dashboard-quick-link"
        >
          <NavIcon :icon="q.icon" class="text-action" />
          <span>{{ q.label }}</span>
        </RouterLink>
      </div>
    </div>

    <Modal title="编辑任务" :show="!!titleEditId" @close="titleEditId = ''">
      <form id="todo-title-form" @submit.prevent="saveTodoTitle">
        <label for="todo-title" class="label">任务内容</label>
        <input
          id="todo-title"
          v-model="editTitle"
          class="input"
          data-autofocus
          :aria-invalid="!!titleEditError"
          aria-describedby="todo-title-error"
          @input="titleEditError = ''"
        />
        <p
          id="todo-title-error"
          role="alert"
          aria-atomic="true"
          class="text-sm text-correction"
          :class="{ 'mt-2': titleEditError }"
        >
          {{ titleEditError }}
        </p>
      </form>
      <template #footer>
        <button type="button" class="btn-ghost" @click="titleEditId = ''">取消</button>
        <button type="submit" form="todo-title-form" class="btn-primary">保存</button>
      </template>
    </Modal>

    <!-- 热力图当日学习明细弹窗 -->
    <!-- 新增任务：开始 / 最晚截止时间选择器（仅时:分，日期固定为当日）-->
    <Modal title="设定任务时间" :show="showAddSchedule" @close="showAddSchedule = false">
      <TodoTimeFields
        v-model:start="addStart"
        v-model:due="addDue"
        hint="时间均为「当日」的时刻，任务须在今日完成；两项均为选填。"
      />
      <template #footer>
        <button class="btn-ghost" @click="showAddSchedule = false">取消</button>
        <button class="btn-primary" @click="confirmAddTodo">添加</button>
      </template>
    </Modal>

    <!-- 修改既有任务的开始 / 最晚截止时间（同样仅限当日，不允许跨日）-->
    <Modal title="任务时间设置" :show="!!scheduleEditId" @close="scheduleEditId = ''">
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
          <span class="text-xl font-black text-action">{{ formatMinutes(heatTotal) }}</span>
        </div>
        <div v-if="!heatRecords.length" class="text-xs text-slate-400 text-center py-4">
          这天没有学习记录。之后完成学习，可在科目页记录。
        </div>
        <div v-else class="space-y-2">
          <div
            v-for="r in heatRecords"
            :key="r.id"
            class="flex items-center gap-2 text-sm border border-slate-100 dark:border-slate-700 rounded-xl px-3 py-2"
          >
            <span
              class="w-2.5 h-2.5 rounded-full shrink-0"
              :style="{ background: store.subjectMap[r.subjectId]?.color || '#94a3b8' }"
            ></span>
            <span class="font-medium">{{ subjectLabel(store.subjectMap[r.subjectId], '已删除科目') }}</span>
            <span class="flex-1 text-xs text-slate-400 truncate">{{ r.note || '—' }}</span>
            <span
              class="font-semibold shrink-0"
              :style="{ color: store.subjectMap[r.subjectId]?.color || '#94a3b8' }"
              >{{ formatMinutes(r.minutes) }}</span
            >
          </div>
        </div>
      </div>
    </Modal>

    <!-- 分享打卡到社区广场 -->
    <PostComposer
      v-model:show="showComposer"
      type="checkin"
      :preset-content="composerContent"
      :preset-tags="['#每日打卡']"
      ref-type="record"
      :ref-id="store.todayKey"
    />
  </div>
</template>

<style scoped>
.dashboard-page {
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.dashboard-date {
  margin-top: 4px;
  color: var(--muted);
  font-size: 13px;
}
.dashboard-next {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 20px 24px;
  border: 1px solid var(--line);
  border-radius: var(--radius-card);
  background: var(--action-soft);
}
.dashboard-next-title {
  font-size: 18px;
  font-weight: 700;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.dashboard-next-description,
.dashboard-next-progress {
  margin-top: 6px;
  color: var(--muted);
  font-size: 13px;
}
.dashboard-workspace,
.dashboard-support {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr);
  align-items: start;
  gap: 20px;
}
.dashboard-workspace > *,
.dashboard-support > *,
.dashboard-records > * {
  min-width: 0;
}
.dashboard-add-task {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}
.dashboard-add-task .input {
  min-width: 0;
}
.today-task {
  min-height: 76px;
}
.today-task-label {
  font-size: 15px;
}
.dashboard-subject-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}
.subject-review-row {
  padding: 14px 0;
}
.dashboard-records {
  display: grid;
  gap: 16px;
  margin-top: 4px;
}
.dashboard-records-heading {
  display: flex;
  align-items: baseline;
  gap: 16px;
  flex-wrap: wrap;
  grid-column: 1 / -1;
}
.dashboard-record-hint {
  margin-top: 12px;
  color: var(--muted);
  font-size: 12px;
}
.dashboard-greeting {
  padding: 0;
}
.dashboard-quick-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  min-height: 44px;
  border-radius: var(--radius-control);
  color: var(--muted);
  font-size: 13px;
}
.dashboard-quick-toggle:hover,
.dashboard-quick-link:hover {
  color: var(--action);
  background: var(--action-soft);
}
.dashboard-quick-links {
  display: grid;
  grid-template-columns: repeat(8, minmax(0, 1fr));
  gap: 8px;
  padding-top: 8px;
}
.dashboard-quick-link {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 6px;
  min-height: 68px;
  border-radius: var(--radius-control);
  color: var(--muted);
  font-size: 13px;
  background: var(--surface);
}
@media (min-width: 1280px) {
  .dashboard-records {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    align-items: start;
  }
}
@media (max-width: 1023px) {
  .dashboard-workspace,
  .dashboard-support {
    grid-template-columns: minmax(0, 1fr);
    gap: 16px;
  }
  .dashboard-quick-links {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}
@media (max-width: 639px) {
  .dashboard-page {
    gap: 16px;
  }
  .dashboard-page > .study-page-heading {
    align-items: flex-start;
    flex-wrap: nowrap;
  }
  .dashboard-page > .study-page-heading .btn-ghost {
    flex-shrink: 0;
  }
  .dashboard-next {
    flex-direction: column;
    align-items: stretch;
    gap: 16px;
    padding: 16px;
  }
  .dashboard-next .btn-primary {
    width: 100%;
  }
  .dashboard-next-title {
    font-size: 17px;
  }
  .dashboard-records-heading {
    gap: 4px;
  }
  .dashboard-records-heading p {
    font-size: 13px;
  }
  .today-task {
    gap: 6px;
  }
  .today-task [data-drag-handle] {
    width: 32px;
    min-width: 32px;
  }
}
</style>
