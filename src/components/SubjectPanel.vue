<script setup lang="ts">
import { computed, ref } from 'vue'
import { useAppStore } from '../stores/app'
import { formatMinutes } from '../utils/date'
import { masteryOverview } from '../utils/studyOverview'
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
  return t ? Math.round((c / t) * 100) : null
})
const mastery = computed(() => (subject.value ? masteryOverview(subject.value) : null))
const totalMin = computed(() => subjectRecords.value.reduce((s, r) => s + r.minutes, 0))
</script>

<template>
  <div v-if="subject" class="subject-panel space-y-4">
    <section class="subject-summary" aria-label="复习进度">
      <div class="subject-summary-heading">
        <h2 class="section-title !mb-1">复习进度</h2>
        <p v-if="mastery" class="study-note">
          知识点已自评 {{ mastery.rated }}/{{ mastery.total }} 个<span v-if="mastery.weak"
            >，其中 {{ mastery.weak }} 个低于 3 分，建议先复习。</span
          ><span v-else>。先自评，再安排复习顺序。</span>
        </p>
      </div>
      <dl class="subject-summary-data">
        <div>
          <dt>累计学习</dt>
          <dd>{{ formatMinutes(totalMin) }}</dd>
        </div>
        <div>
          <dt>累计刷题</dt>
          <dd>
            {{ subjectProblems.reduce((sum, p) => sum + p.total, 0) }} <span class="text-xs font-normal">题</span>
          </dd>
        </div>
        <div>
          <dt>刷题正确率</dt>
          <dd>{{ accuracy === null ? '—' : accuracy + '%' }}</dd>
          <p v-if="accuracy === null" class="study-note">还没有刷题记录</p>
        </div>
      </dl>
    </section>

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
      class="subject-tabs"
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

<style scoped>
.subject-summary {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 20px 32px;
  padding: 20px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius-card);
}
.subject-summary-heading {
  flex: 1 1 260px;
}
.subject-summary-data {
  display: flex;
  flex: 1 1 420px;
  justify-content: space-between;
  gap: 20px;
}
.subject-summary-data dt {
  font-size: 12px;
  color: var(--muted);
}
.subject-summary-data dd {
  margin-top: 4px;
  color: var(--ink);
  font-size: 18px;
  font-weight: 700;
}
.subject-summary-data .study-note {
  margin-top: 2px;
  font-size: 11px;
}
.subject-tabs {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-start;
  gap: 4px;
  padding: 4px;
  background: var(--surface-soft);
  border: 1px solid var(--line);
  border-radius: var(--radius-control);
}
.subject-tabs :deep(button) {
  flex: 0 1 auto;
  min-height: 40px;
  padding: 8px 16px;
  border: 1px solid transparent;
  border-radius: calc(var(--radius-control) - 3px);
  color: var(--muted);
}
.subject-tabs :deep(button[aria-selected='true']) {
  background: var(--surface);
  border-color: var(--line);
  color: var(--action);
}
@media (max-width: 640px) {
  .subject-summary {
    gap: 16px;
    padding: 16px;
  }
  .subject-summary-data {
    gap: 12px;
  }
  .subject-summary-data dd {
    font-size: 16px;
  }
  .subject-tabs :deep(button) {
    flex: 1 1 auto;
    padding-inline: 10px;
  }
}
</style>
