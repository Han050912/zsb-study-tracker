<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'
import { useToast } from '../composables/useToast'
import { useConfirm } from '../composables/useConfirm'
import { useAppStore } from '../stores/app'
import { habitDone } from '../stores/app/habits'
import { habitValueError } from '../utils/studyValidation'
import { businessDate, today } from '../utils/date'
import Modal from '../components/Modal.vue'
import EmptyState from '../shared/components/EmptyState.vue'
import { prepareListLeave, resetEnteringItem } from '../utils/motion'
import type { Habit, HabitType } from '../types'
import { VOCAB_HABIT_ID, PROBLEM_HABIT_ID } from '../data/defaults'

const store = useAppStore()
const toast = useToast()
const confirm = useConfirm()

/** 输入框自动聚焦指令 */
const vFocus = { mounted: (el: HTMLElement) => el.focus() }

const showModal = ref(false)
const form = ref({ name: '', type: 'checkbox' as HabitType, target: 1, bad: false })

function add() {
  if (!showModal.value) return
  const name = form.value.name.trim()
  if (!name) {
    toast('请填写习惯名称')
    return
  }
  if (
    (form.value.type === 'count' || form.value.type === 'minutes') &&
    (!Number.isSafeInteger(form.value.target) || form.value.target <= 0)
  ) {
    toast('每日目标需为大于 0 的整数')
    return
  }
  store.addHabit({
    ...form.value,
    name,
    target: form.value.type === 'count' || form.value.type === 'minutes' ? form.value.target : undefined
  })
  showModal.value = false
  form.value = { name: '', type: 'checkbox', target: 1, bad: false }
  toast('习惯已添加')
}

/** 日期心跳：跨午夜后驱动热力缓存等按天计算的内容自动刷新 */
const dayTick = ref(today())
const dayTimer = setInterval(() => {
  dayTick.value = today()
}, 60000)
onUnmounted(() => clearInterval(dayTimer))

function record(h: Habit, value: number | string) {
  const normalized =
    h.type === 'count' || h.type === 'minutes'
      ? typeof value === 'string' && !value.trim()
        ? value
        : Number(value)
      : value
  const error = habitValueError(h.type, normalized)
  if (error) {
    toast(error)
    return
  }
  const hadMet = habitDone(h, h.records[today()])
  // 积分奖励/回收逻辑已内聚在 store.recordHabit 中（达标口径与 habitDone 一致）
  store.recordHabit(h.id, today(), normalized)
  if (h.bad) {
    toast('已更新今日发生记录')
    return
  }
  const met = habitDone(h, h.records[today()])
  if (met && !hadMet) toast('已打卡，今天的目标已完成')
  else if (met) toast('已打卡，今天的目标已完成')
  // 达标被取消（勾选撤销 / 记录清零、改小）：积分已由 store 回收，按状态更新提示
  else if (!met && hadMet) toast(h.type === 'checkbox' ? '已取消打卡' : '已更新，目前还未达到每日目标')
  else if (h.target && (h.type === 'count' || h.type === 'minutes'))
    toast(`已完成 ${Number(h.records[today()]) || 0}/${h.target}，未达标`)
  else toast('已记录')
}

const confirmingCheckin = ref(false)
async function toggleHabit(h: Habit) {
  if (confirmingCheckin.value) return
  const date = today()
  if (!h.records[date]) {
    record(h, 1)
    return
  }
  confirmingCheckin.value = true
  try {
    if (!(await confirm('取消今日打卡？对应的打卡积分也会收回。', { danger: true }))) return
    if (date !== today()) return toast('日期已切换，请确认今天的打卡状态后重试')
    if (h.records[date]) record(h, 0)
  } finally {
    confirmingCheckin.value = false
  }
}

// ---- 坏习惯「每日克制打卡」 ----
async function toggleCheckin(h: Habit) {
  if (confirmingCheckin.value) return
  const date = today()
  const checked = !!h.checkins?.[date]
  const value = h.records[date]
  confirmingCheckin.value = true
  try {
    if (checked && !(await confirm('取消今日克制打卡？', { danger: true }))) return
    if (
      !checked &&
      Number(value) > 0 &&
      !(await confirm('今日已有发生记录，克制打卡会清除这些次数，确定更改？', { danger: true }))
    )
      return
    if (date !== today()) return toast('日期已切换，请确认今天的打卡状态后重试')
    if (!!h.checkins?.[date] !== checked || h.records[date] !== value) return toast('打卡记录已更新，请重新确认')
    store.toggleBadHabitCheckin(h.id, date)
    toast(h.checkins?.[date] ? '今日已打卡' : '已取消今日克制打卡')
  } finally {
    confirmingCheckin.value = false
  }
}

// ---- 习惯目标编辑（「每日背单词」「每日做题」与设置页每日目标双向同步） ----
const editingTargetId = ref('')
const editingTargetValue = ref(1)
function startEditTarget(h: Habit) {
  editingTargetId.value = h.id
  editingTargetValue.value = h.target || 1
}
function saveTarget(h: Habit) {
  if (editingTargetId.value !== h.id) return
  if (!Number.isSafeInteger(editingTargetValue.value) || editingTargetValue.value <= 0) {
    toast('每日目标需为大于 0 的整数')
    return
  }
  store.updateHabitTarget(h.id, editingTargetValue.value)
  editingTargetId.value = ''
  toast('目标已更新' + (h.id === VOCAB_HABIT_ID || h.id === PROBLEM_HABIT_ID ? '（已同步到设置页）' : ''))
}

/** 近 30 天热力（日期键为 UTC+8 业务日期，不随系统时区变化；达标口径与 recordHabit 积分判定一致，有 target 需达到目标才满格） */
function heatData(h: Habit) {
  return Array.from({ length: 30 }, (_, i) => {
    const d = businessDate(Date.now() - (29 - i) * 86400_000)
    return { date: d, done: habitDone(h, h.records[d]) }
  })
}

/** 坏习惯近 30 天克制情况：克制打卡=绿，发生=红，无记录=灰 */
function badHeatData(h: Habit) {
  return Array.from({ length: 30 }, (_, i) => {
    const d = businessDate(Date.now() - (29 - i) * 86400_000)
    const checked = !!h.checkins?.[d]
    const happened = Number(h.records[d]) > 0
    return {
      date: d,
      cls: checked ? 'bg-action' : happened ? 'bg-correction-soft' : 'bg-slate-100 dark:bg-slate-700',
      text: checked ? '已克制 ✓' : happened ? `未克制（${h.records[d]} 次）` : '无记录'
    }
  })
}

const goodHabits = computed(() => store.habits.filter((h) => !h.bad))
const badHabits = computed(() => store.habits.filter((h) => h.bad))

/** 热力数据缓存：按习惯 id 记忆化，避免模板内每次渲染重复构建 30 天数组；依赖 dayTick 跨午夜自动刷新 */
const goodHeatMaps = computed(() => {
  // eslint-disable-next-line @typescript-eslint/no-unused-expressions -- 显式建立对 dayTick 的响应式依赖（跨午夜刷新热力图）
  dayTick.value
  return Object.fromEntries(goodHabits.value.map((h) => [h.id, heatData(h)]))
})
const badHeatMaps = computed(() => {
  // eslint-disable-next-line @typescript-eslint/no-unused-expressions -- 显式建立对 dayTick 的响应式依赖（跨午夜刷新热力图）
  dayTick.value
  return Object.fromEntries(badHabits.value.map((h) => [h.id, badHeatData(h)]))
})

async function removeHabit(id: string) {
  if (!(await confirm('删除该习惯及其记录？', { danger: true }))) return
  store.deleteHabit(id)
  toast('已删除')
}
</script>

<template>
  <div class="study-page space-y-4">
    <div class="study-page-heading">
      <div>
        <h1 class="page-title">习惯打卡</h1>
        <p class="page-description">把每天的小行动记下来，找到适合自己的学习节奏。</p>
      </div>
      <button class="btn-primary" @click="showModal = true">添加习惯</button>
    </div>

    <details class="card text-sm">
      <summary class="cursor-pointer font-medium">习惯积分规则</summary>
      <div class="mt-2 space-y-1 text-muted">
        <p>好习惯当天首次达标获得 2 积分，每个习惯每天只奖励一次。</p>
        <p>所有学习奖励合计每天最多 300 积分，接近上限时可能只获得部分积分，以同步后的积分为准。</p>
        <p>次数或时长需达到每日目标；未达标会保存进度，不给积分，也不按比例给分。</p>
        <p>勾选打卡或记录时刻即为达标。取消打卡或把完成量改为未达标，会收回对应积分。</p>
        <p>补记历史日期、克制打卡和记录坏习惯发生次数不奖励积分。</p>
      </div>
    </details>

    <EmptyState
      v-if="!goodHabits.length && !badHabits.length"
      class="card"
      title="从一个小习惯开始"
      description="比如每天复习错词，或睡前回看一道错题。"
    >
      <button class="btn-primary" @click="showModal = true">创建第一个习惯</button>
    </EmptyState>
    <TransitionGroup
      name="list"
      tag="div"
      class="relative grid md:grid-cols-2 gap-3"
      @before-leave="prepareListLeave"
      @before-enter="resetEnteringItem"
    >
      <div v-for="h in goodHabits" :key="h.id" class="card">
        <div class="flex items-center justify-between mb-2">
          <span class="font-medium text-sm"
            >{{ h.name }}
            <span v-if="editingTargetId === h.id" class="inline-flex items-center gap-1 ml-1">
              <input
                v-model.number="editingTargetValue"
                type="number"
                min="1"
                class="input !w-16 !py-0.5 !px-1.5 !text-xs"
                @keyup.enter="saveTarget(h)"
                @blur="saveTarget(h)"
                v-focus
              />
            </span>
            <button
              type="button"
              v-else-if="h.target"
              class="text-xs text-slate-400 cursor-pointer hover:text-action"
              title="点击修改目标"
              @click="startEditTarget(h)"
            >
              目标 {{ h.target }}{{ h.type === 'minutes' ? '分钟' : h.type === 'count' ? '次' : '' }} ✎
            </button>
          </span>
          <button class="study-link text-xs text-correction" @click="removeHabit(h.id)">删除</button>
        </div>
        <!-- 今日操作 -->
        <div class="mb-3">
          <button
            v-if="h.type === 'checkbox'"
            class="btn w-full"
            :class="h.records[today()] ? 'bg-action text-on-action' : 'bg-slate-100 dark:bg-slate-700'"
            @click="toggleHabit(h)"
          >
            {{ h.records[today()] ? '今日已打卡' : '打卡' }}
          </button>
          <div v-else-if="h.type === 'time'" class="flex gap-2">
            <input
              type="time"
              :aria-label="`${h.name}的时间`"
              class="input"
              :value="(h.records[today()] as string) || ''"
              @change="record(h, ($event.target as HTMLInputElement).value)"
            />
          </div>
          <div v-else class="flex gap-2">
            <input
              type="number"
              min="0"
              class="input"
              :aria-label="`${h.name}的完成量`"
              :placeholder="h.type === 'minutes' ? '分钟数' : '次数'"
              :value="(h.records[today()] as number) || ''"
              @keyup.enter="record(h, ($event.target as HTMLInputElement).value)"
            />
            <button
              class="btn-primary shrink-0"
              @click="
                record(
                  h,
                  ($event.currentTarget as HTMLElement).previousElementSibling
                    ? (($event.currentTarget as HTMLElement).previousElementSibling as HTMLInputElement).value
                    : ''
                )
              "
            >
              保存
            </button>
          </div>
        </div>
        <p class="study-note mb-2">近 30 天 · 实心表示达成当天目标</p>
        <!-- 30天热力 -->
        <div class="flex gap-[3px] flex-wrap">
          <div
            v-for="c in goodHeatMaps[h.id] || []"
            :key="c.date"
            :title="c.date"
            class="w-3.5 h-3.5 rounded-sm"
            :class="c.done ? 'bg-action' : 'bg-slate-100 dark:bg-slate-700'"
          ></div>
        </div>
      </div>
    </TransitionGroup>

    <div v-if="badHabits.length">
      <h2 class="section-title !text-base mt-2">想减少的习惯</h2>
      <TransitionGroup
        name="list"
        tag="div"
        class="relative grid md:grid-cols-2 gap-3"
        @before-leave="prepareListLeave"
        @before-enter="resetEnteringItem"
      >
        <div v-for="h in badHabits" :key="h.id" class="card border-red-100 dark:border-red-900/40">
          <div class="flex items-center justify-between mb-2">
            <span class="font-medium text-sm">{{ h.name }}</span>
            <button class="study-link text-xs text-correction" @click="removeHabit(h.id)">删除</button>
          </div>
          <!-- 每日克制打卡 -->
          <button
            class="btn w-full mb-2"
            :class="h.checkins?.[today()] ? 'bg-action text-on-action' : 'bg-slate-100 dark:bg-slate-700'"
            @click="toggleCheckin(h)"
          >
            {{ h.checkins?.[today()] ? '✓ 今日已克制' : '今日克制打卡' }}
          </button>
          <p class="study-note mb-2">克制打卡表示今天没有发生；记录发生会取消今日克制标记，不增加积分。</p>
          <div class="flex items-center gap-3 flex-wrap">
            <button class="btn-danger" @click="record(h, (Number(h.records[today()]) || 0) + 1)">
              记录发生 +1 {{ h.type === 'minutes' ? '分钟' : '次' }}
            </button>
            <span class="text-sm"
              >今日发生：<b class="text-correction">{{ h.records[today()] || 0 }}</b>
              {{ h.type === 'minutes' ? '分钟' : '次' }}</span
            >
            <button
              v-if="Number(h.records[today()]) > 0"
              class="text-xs text-slate-400"
              @click="record(h, Number(h.records[today()]) - 1)"
            >
              撤销
            </button>
          </div>
          <!-- 近30天克制情况热力 -->
          <div class="flex gap-[3px] flex-wrap mt-3">
            <div
              v-for="c in badHeatMaps[h.id] || []"
              :key="c.date"
              :title="`${c.date}：${c.text}`"
              class="w-3.5 h-3.5 rounded-sm"
              :class="c.cls"
            ></div>
          </div>
          <div class="text-[10px] text-slate-400 mt-1.5 flex gap-3">
            <span><span class="inline-block w-2 h-2 rounded-sm bg-action mr-1"></span>已克制</span>
            <span><span class="inline-block w-2 h-2 rounded-sm bg-correction-soft mr-1"></span>未克制</span>
            <span><span class="inline-block w-2 h-2 rounded-sm bg-slate-100 dark:bg-slate-700 mr-1"></span>无记录</span>
          </div>
        </div>
      </TransitionGroup>
    </div>

    <Modal title="新建习惯" :show="showModal" @close="showModal = false">
      <div class="space-y-3">
        <div>
          <label class="label" for="habit-name">习惯名称</label
          ><input id="habit-name" v-model="form.name" class="input" placeholder="如：每日复盘" data-autofocus />
        </div>
        <div>
          <div class="label">量化方式</div>
          <div class="grid grid-cols-4 gap-1.5">
            <button
              v-for="t in [
                { k: 'checkbox', l: '勾选' },
                { k: 'minutes', l: '时长' },
                { k: 'count', l: '次数' },
                { k: 'time', l: '时刻' }
              ]"
              :key="t.k"
              class="btn !text-xs"
              :class="form.type === t.k ? 'bg-action text-on-action' : 'bg-slate-100 dark:bg-slate-700'"
              @click="form.type = t.k as HabitType"
            >
              {{ t.l }}
            </button>
          </div>
        </div>
        <div v-if="form.type === 'count' || form.type === 'minutes'">
          <label class="label" for="habit-target">每日目标</label
          ><input id="habit-target" v-model.number="form.target" type="number" min="1" class="input" />
        </div>
        <label class="flex items-center gap-2 text-sm"
          ><input type="checkbox" v-model="form.bad" class="accent-red-500" /> 这是坏习惯（监督模式）</label
        >
      </div>
      <template #footer>
        <button class="btn-ghost" @click="showModal = false">取消</button>
        <button class="btn-primary" @click="add">创建</button>
      </template>
    </Modal>
  </div>
</template>
