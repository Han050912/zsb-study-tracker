<script setup lang="ts">
import { computed, ref } from 'vue'
import { useAppStore } from '../stores/app'
import { useToast } from '../composables/useToast'
import { formatMinutes } from '../utils/date'
import { isCalendarDate } from '../utils/settingsValidation'
import { buildLearningPlan } from '../utils/learningPlan'
import PostComposer from './community/PostComposer.vue'
import SubjectIcon from './SubjectIcon.vue'

const store = useAppStore()
const toast = useToast()
const plan = computed(() => buildLearningPlan(store, store.todayKey))
const showPlanner = ref(false)
const planDate = ref(store.todayKey)
const choices = ref<{ subjectId: string; chapterId: string; minutes: number; selected: boolean }[]>([])
const planError = ref('')
const showComposer = ref(false)
const composerContent = ref('')
const selectedMinutes = computed(() =>
  choices.value.filter((row) => row.selected).reduce((sum, row) => sum + Number(row.minutes || 0), 0)
)
function openPlanner() {
  choices.value = plan.value.rows.map((row) => ({
    subjectId: row.subject.id,
    chapterId: row.chapterId,
    minutes: row.minutes,
    selected: row.minutes > 0
  }))
  planDate.value = store.todayKey
  planError.value = ''
  showPlanner.value = true
}
function applyPlan() {
  planError.value = ''
  if (!isCalendarDate(planDate.value) || planDate.value < store.todayKey) {
    planError.value = '请选择今天或之后的任务日期'
    return
  }
  const selected = choices.value.filter((row) => row.selected)
  if (!selected.length) {
    planError.value = '请选择至少一门科目'
    return
  }
  if (
    selected.some((row) => !Number.isSafeInteger(row.minutes) || row.minutes < 1 || row.minutes > 1440) ||
    selectedMinutes.value > 1440
  ) {
    planError.value = '每项时长请输入正整数，一天合计不能超过 1440 分钟'
    return
  }
  if (
    selected.some(
      (row) =>
        !store.subjectMap[row.subjectId] ||
        (row.chapterId && !store.subjectMap[row.subjectId]!.chapters.some((chapter) => chapter.id === row.chapterId))
    )
  ) {
    planError.value = '科目或章节已变更，请重新打开安排'
    return
  }
  let added = 0
  for (const row of selected) {
    const subject = store.subjectMap[row.subjectId]!
    const chapter = subject.chapters.find((item) => item.id === row.chapterId)
    const text = subject.name + ' · ' + (chapter?.name || '综合复习') + '（' + row.minutes + '分钟）'
    if (
      store.todos.some(
        (todo) =>
          todo.date === planDate.value &&
          todo.text === text &&
          todo.subjectId === subject.id &&
          (todo.chapterId || '') === row.chapterId
      )
    )
      continue
    store.addTodo(text, undefined, planDate.value, { subjectId: subject.id, chapterId: row.chapterId || undefined })
    added++
  }
  toast(added ? '已加入 ' + planDate.value + ' 的任务清单，共 ' + added + ' 项' : '这些任务已经在清单中，无需重复添加')
  showPlanner.value = false
}
function openShare() {
  composerContent.value = [
    '我的复习安排',
    '每日目标 ' + formatMinutes(plan.value.budget),
    ...plan.value.rows.map((row) => row.subject.name + ' ' + formatMinutes(row.minutes) + '/天：' + row.reason),
    '一起按计划复习。'
  ].join('\n')
  showComposer.value = true
}
</script>
<template>
  <section class="card space-y-3" aria-labelledby="learning-plan-title">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h2 id="learning-plan-title" class="section-title !mb-0">本周复习安排</h2>
      <button class="btn-ghost" :disabled="!plan.rows.length" @click="openShare">分享计划</button>
    </div>
    <p class="text-sm text-muted">
      每天 {{ formatMinutes(plan.budget) }}，参考科目权重、薄弱项和到期错题分配。先选择章节，再安排到具体日期。
    </p>
    <div v-for="row in plan.rows" :key="row.subject.id" class="py-2 border-b border-[var(--line)] last:border-0">
      <div class="flex items-center gap-2">
        <SubjectIcon :icon="row.subject.icon" />
        <span class="flex-1 font-semibold">{{ row.subject.name }}</span>
        <span>{{ formatMinutes(row.minutes) }}/天</span>
      </div>
      <p class="text-xs text-muted mt-1">{{ row.reason }}</p>
    </div>
    <p v-if="plan.recentAverage !== null" class="text-sm text-muted">
      最近 7 天有记录的学习日平均 {{ formatMinutes(plan.recentAverage) }}。{{
        plan.recentAverage < plan.budget ? '可在下面调低本次安排，逐步接近目标。' : '可按自己的节奏安排休息日。'
      }}
    </p>
    <p v-if="!plan.rows.length" class="text-sm text-muted">在设置里添加科目后，就可以安排复习。</p>
    <button v-else-if="!showPlanner" class="btn-primary" @click="openPlanner">安排为任务</button>
    <form v-if="showPlanner" class="space-y-4 pt-2" @submit.prevent="applyPlan">
      <div>
        <label for="plan-date" class="label">安排到哪一天</label>
        <input id="plan-date" v-model="planDate" type="date" :min="store.todayKey" class="input" />
      </div>
      <fieldset v-for="choice in choices" :key="choice.subjectId" class="space-y-2">
        <legend class="py-1">
          <label class="flex items-center gap-2"
            ><input v-model="choice.selected" type="checkbox" />{{
              store.subjectMap[choice.subjectId]?.name || '已删除科目'
            }}</label
          >
        </legend>
        <div v-if="choice.selected" class="space-y-2">
          <label :for="'plan-chapter-' + choice.subjectId" class="label">复习章节</label>
          <select :id="'plan-chapter-' + choice.subjectId" v-model="choice.chapterId" class="input">
            <option value="">综合复习</option>
            <option
              v-for="chapter in store.subjectMap[choice.subjectId]?.chapters || []"
              :key="chapter.id"
              :value="chapter.id"
            >
              {{ chapter.name }}
            </option>
          </select>
          <label :for="'plan-minutes-' + choice.subjectId" class="label">计划时长（分钟）</label>
          <input
            :id="'plan-minutes-' + choice.subjectId"
            v-model.number="choice.minutes"
            type="number"
            min="1"
            max="1440"
            step="1"
            class="input"
          />
        </div>
      </fieldset>
      <p class="text-sm text-muted">
        本次合计 {{ formatMinutes(selectedMinutes) }}。可跳过科目或改选日期，休息日无需添加。
      </p>
      <p v-if="planError" role="alert" class="text-sm text-correction">{{ planError }}</p>
      <div class="flex flex-wrap gap-2">
        <button class="btn-primary">加入任务清单</button>
        <button type="button" class="btn-ghost" @click="showPlanner = false">取消</button>
      </div>
    </form>
    <PostComposer
      v-model:show="showComposer"
      type="checkin"
      :preset-content="composerContent"
      :preset-tags="['#每日打卡', '#升本经验']"
    />
  </section>
</template>
