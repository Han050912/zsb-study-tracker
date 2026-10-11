<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAppStore } from '../stores/app'
import { OVERLAY_LAYER, useOverlayDismiss } from '../composables/useOverlayDismiss'
import { isCalendarDate, settingsGoalError } from '../utils/settingsValidation'

const emit = defineEmits<{ complete: [] }>()
const store = useAppStore()
const router = useRouter()
const step = ref(0)
const examDate = ref(store.settings.examDate)
const dailyMinutes = ref(store.settings.dailyGoalMinutes)
const selectedSubjects = ref(store.subjects.filter((s) => s.weight > 0).map((s) => s.id))
const task = ref('')
const taskSubject = ref(selectedSubjects.value[0] || store.subjects[0]?.id || '')
const chosenSubjects = computed(() => store.subjects.filter((s) => selectedSubjects.value.includes(s.id)))
const error = ref('')
const saving = ref(false)
let completed = false
const titles = ['准备哪几门考试', '每天留多少学习时间', '写下第一件要做的事']
const panelRef = ref<HTMLElement | null>(null)
useOverlayDismiss(() => {}, { show: () => true, panel: () => panelRef.value })

function skip() {
  if (saving.value || completed) return
  completed = true
  store.updateSettings({ onboarded: true })
  emit('complete')
}
function goBack() {
  if (saving.value || completed) return
  step.value = Math.max(0, step.value - 1)
  error.value = ''
}
function advance() {
  if (saving.value || completed) return
  error.value = ''
  if (!chosenSubjects.value.length) {
    error.value = '请至少选择一门考试科目'
    step.value = 0
    return
  }
  if (!isCalendarDate(examDate.value) || examDate.value < store.todayKey) {
    error.value = '请选择今天或之后的考试日期'
    step.value = 0
    return
  }
  if (step.value === 0) {
    step.value++
    return
  }
  const goalError = settingsGoalError('dailyGoalMinutes', dailyMinutes.value)
  if (goalError) {
    error.value = goalError
    step.value = 1
    return
  }
  if (step.value === 1) {
    if (!chosenSubjects.value.some((subject) => subject.id === taskSubject.value))
      taskSubject.value = chosenSubjects.value[0]!.id
    step.value++
    return
  }
  if (!chosenSubjects.value.some((subject) => subject.id === taskSubject.value)) {
    taskSubject.value = chosenSubjects.value[0]!.id
    error.value = '任务科目已变更，请确认科目后再保存'
    return
  }
  if (!task.value.trim()) {
    error.value = '写下一件能完成的事，例如重做极限错题 5 道'
    return
  }
  if (saving.value) return
  saving.value = true
  try {
    // 只调整计划权重，不删除科目或既有学习数据。
    for (const subject of store.subjects) {
      const weight = selectedSubjects.value.includes(subject.id) ? subject.weight || 50 : 0
      if (weight !== subject.weight) store.updateSubjectWeight(subject.id, weight)
    }
    if (
      !store.todos.some(
        (t) => t.date === store.todayKey && t.text === task.value.trim() && t.subjectId === taskSubject.value
      )
    )
      store.addTodo(task.value.trim(), undefined, store.todayKey, { subjectId: taskSubject.value })
    store.updateSettings({ examDate: examDate.value, dailyGoalMinutes: dailyMinutes.value, onboarded: true })
    completed = true
    emit('complete')
    router.replace('/')
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '暂时无法完成设置，请重试'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="fixed inset-0 bg-black/50 flex items-center justify-center p-4" :class="OVERLAY_LAYER.guide">
    <form
      ref="panelRef"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
      class="card max-w-lg w-full max-h-[90dvh] overflow-y-auto space-y-5"
      @submit.prevent="advance"
    >
      <div>
        <h2 id="onboarding-title" class="page-title">{{ titles[step] }}</h2>
        <p class="text-sm text-muted mt-2">第 {{ step + 1 }} / 3 步 · 随时可以在设置里调整。</p>
      </div>
      <div v-if="step === 0" class="space-y-4">
        <fieldset>
          <legend class="label">参与复习计划的科目</legend>
          <div class="flex flex-wrap gap-3">
            <label v-for="subject in store.subjects" :key="subject.id" class="flex items-center gap-2 py-2">
              <input v-model="selectedSubjects" type="checkbox" :value="subject.id" />{{ subject.name }}
            </label>
          </div>
          <button v-if="!store.subjects.length" type="button" class="btn-ghost" @click="store.restoreDefaultSubjects()">
            添加默认科目
          </button>
          <p class="text-xs text-muted">未选科目保留全部数据，暂不分配学习时间。自定义科目可在设置中添加。</p>
        </fieldset>
        <div>
          <label for="setup-exam" class="label">考试日期</label>
          <input id="setup-exam" v-model="examDate" type="date" :min="store.todayKey" class="input" />
        </div>
      </div>
      <div v-else-if="step === 1" class="space-y-3">
        <label for="setup-minutes" class="label">每天可用时间（分钟）</label>
        <input
          id="setup-minutes"
          v-model.number="dailyMinutes"
          type="number"
          min="1"
          max="1440"
          step="1"
          class="input"
        />
        <p class="text-sm text-muted">按平时能坚持的时间填写。计划可以分配到具体日期，休息日不用安排任务。</p>
      </div>
      <div v-else class="space-y-3">
        <label for="setup-subject" class="label">任务科目</label>
        <select id="setup-subject" v-model="taskSubject" class="input">
          <option v-for="subject in chosenSubjects" :key="subject.id" :value="subject.id">{{ subject.name }}</option>
        </select>
        <label for="setup-task" class="label">今天先完成什么</label>
        <input id="setup-task" v-model="task" maxlength="200" class="input" placeholder="例如：重做极限错题 5 道" />
        <p class="text-sm text-muted">完成设置后，这项任务会出现在首页，可直接开始专注。</p>
      </div>
      <p v-if="error" role="alert" class="text-sm text-correction">{{ error }}</p>
      <div class="flex flex-wrap gap-2 justify-between">
        <button type="button" class="btn-ghost" :disabled="saving" @click="skip">稍后设置</button>
        <div class="flex gap-2">
          <button v-if="step" type="button" class="btn-ghost" :disabled="saving" @click="goBack">上一步</button>
          <button class="btn-primary" :disabled="saving">{{ step === 2 ? '保存并开始学习' : '下一步' }}</button>
        </div>
      </div>
    </form>
  </div>
</template>
