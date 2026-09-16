<script setup lang="ts">
import { computed, ref } from 'vue'
import { useAppStore } from '../stores/app'
import { formatMinutes } from '../utils/date'
import ChapterTree from './subject/ChapterTree.vue'
import RecordsTab from './subject/RecordsTab.vue'
import ProblemsTab from './subject/ProblemsTab.vue'
import ExamsTab from './subject/ExamsTab.vue'
import NotesTab from './subject/NotesTab.vue'

const props = defineProps<{ subjectId: string }>()
const store = useAppStore()

const subject = computed(() => store.subjectMap[props.subjectId])
const tab = ref<'chapters' | 'records' | 'problems' | 'exams' | 'notes'>('chapters')

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
    <div class="flex gap-1 overflow-x-auto bg-slate-100 dark:bg-slate-800 rounded-xl p-1">
      <button
        v-for="t in [
          { k: 'chapters', l: ' 章节掌握' },
          { k: 'records', l: ' 学习记录' },
          { k: 'problems', l: ' 刷题' },
          { k: 'exams', l: ' 真题' },
          { k: 'notes', l: ' 笔记' }
        ]"
        :key="t.k"
        class="flex-1 whitespace-nowrap text-xs px-3 py-2 rounded-lg font-medium transition-colors"
        :class="tab === t.k ? 'bg-white dark:bg-slate-700 shadow-sm' : 'text-slate-500'"
        @click="tab = t.k as any"
      >
        {{ t.l }}
      </button>
    </div>

    <!-- 章节树 + 掌握度 -->
    <div v-show="tab === 'chapters'" class="space-y-3">
      <ChapterTree :subject-id="subjectId" />
    </div>

    <!-- 学习记录 -->
    <div v-show="tab === 'records'" class="space-y-3">
      <RecordsTab :subject-id="subjectId" />
    </div>

    <!-- 刷题 -->
    <div v-show="tab === 'problems'" class="space-y-3">
      <ProblemsTab :subject-id="subjectId" />
    </div>

    <!-- 真题 -->
    <div v-show="tab === 'exams'" class="space-y-3">
      <ExamsTab :subject-id="subjectId" />
    </div>

    <!-- 笔记 -->
    <div v-show="tab === 'notes'">
      <NotesTab :subject-id="subjectId" />
    </div>
  </div>
</template>
