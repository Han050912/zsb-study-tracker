<script setup lang="ts">
import { computed, ref } from 'vue'
import { useAppStore } from '../stores/app'
import { formatMinutes } from '../utils/date'
import ChapterTree from './subject/ChapterTree.vue'
import RecordsTab from './subject/RecordsTab.vue'
import ProblemsTab from './subject/ProblemsTab.vue'
import ExamsTab from './subject/ExamsTab.vue'
import NotesTab from './subject/NotesTab.vue'
import AppTabs from '../shared/components/AppTabs.vue'

const props = defineProps<{ subjectId: string }>()
const store = useAppStore()

const subject = computed(() => store.subjectMap[props.subjectId])
const tab = ref<'chapters' | 'records' | 'problems' | 'exams' | 'notes'>('chapters')
function selectTab(value: string) {
  tab.value = value as typeof tab.value
}

const subjectRecords = computed(() =>
  store.records
    .filter((r) => r.subjectId === props.subjectId)
    .slice()
    .reverse()
)
const subjectProblems = computed(() =>
  store.problemSessions
    .filter((p) => p.subjectId === props.subjectId)
    .slice()
    .reverse()
)
const accuracy = computed(() => {
  const t = subjectProblems.value.reduce((s, p) => s + p.total, 0)
  const c = subjectProblems.value.reduce((s, p) => s + p.correct, 0)
  return t ? Math.round((c / t) * 100) : 0
})
const totalMin = computed(() => subjectRecords.value.reduce((s, r) => s + r.minutes, 0))
</script>

<template>
  <div v-if="subject" class="space-y-4">
    <!-- 概览 -->
    <div class="grid grid-cols-3 gap-3">
      <div class="card !p-3 text-center">
        <div class="text-xl font-black" :style="{ color: subject.color }">{{ formatMinutes(totalMin) }}</div>
        <div class="text-[11px] text-slate-400">累计学习</div>
      </div>
      <div class="card !p-3 text-center">
        <div class="text-xl font-black" :style="{ color: subject.color }">
          {{ subjectProblems.reduce((s, p) => s + p.total, 0) }}
        </div>
        <div class="text-[11px] text-slate-400">累计刷题</div>
      </div>
      <div class="card !p-3 text-center">
        <div class="text-xl font-black" :style="{ color: subject.color }">{{ accuracy }}%</div>
        <div class="text-[11px] text-slate-400">总正确率</div>
      </div>
    </div>

    <!-- Tab -->
    <AppTabs
      :id="`subject-${subjectId}`"
      :model-value="tab"
      :items="[
        { value: 'chapters', label: '章节掌握' },
        { value: 'records', label: '学习记录' },
        { value: 'problems', label: '刷题' },
        { value: 'exams', label: '真题' },
        { value: 'notes', label: '笔记' }
      ]"
      label="学科学习内容"
      panel-per-tab
      @update:model-value="selectTab"
    />

    <!-- 章节树 + 掌握度 -->
    <div
      v-show="tab === 'chapters'"
      :id="`subject-${subjectId}-panel-chapters`"
      role="tabpanel"
      :aria-labelledby="`subject-${subjectId}-tab-chapters`"
      class="panel-reveal space-y-3"
    >
      <ChapterTree :subject-id="subjectId" />
    </div>

    <!-- 学习记录 -->
    <div
      v-show="tab === 'records'"
      :id="`subject-${subjectId}-panel-records`"
      role="tabpanel"
      :aria-labelledby="`subject-${subjectId}-tab-records`"
      class="panel-reveal space-y-3"
    >
      <RecordsTab :subject-id="subjectId" />
    </div>

    <!-- 刷题 -->
    <div
      v-show="tab === 'problems'"
      :id="`subject-${subjectId}-panel-problems`"
      role="tabpanel"
      :aria-labelledby="`subject-${subjectId}-tab-problems`"
      class="panel-reveal space-y-3"
    >
      <ProblemsTab :subject-id="subjectId" />
    </div>

    <!-- 真题 -->
    <div
      v-show="tab === 'exams'"
      :id="`subject-${subjectId}-panel-exams`"
      role="tabpanel"
      :aria-labelledby="`subject-${subjectId}-tab-exams`"
      class="panel-reveal space-y-3"
    >
      <ExamsTab :subject-id="subjectId" />
    </div>

    <!-- 笔记 -->
    <div
      v-show="tab === 'notes'"
      :id="`subject-${subjectId}-panel-notes`"
      role="tabpanel"
      :aria-labelledby="`subject-${subjectId}-tab-notes`"
      class="panel-reveal"
    >
      <NotesTab :subject-id="subjectId" />
    </div>
  </div>
</template>
