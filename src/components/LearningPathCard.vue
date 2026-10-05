<script setup lang="ts">
/**
 * 学习路径推荐卡（P2-4）：考试倒计时 + 按科目权重分配的周学习计划。
 * 数据来自 /api/learning-path；可一键生成打卡帖分享到社区求监督。
 */
import { computed, onMounted, ref } from 'vue'
import { learningPathApi } from '../api/learningPath'
import { formatMinutes } from '../utils/date'
import { subjectLabel } from '../utils/subject'
import PostComposer from './community/PostComposer.vue'
import SubjectIcon from './SubjectIcon.vue'
import type { LearningPath } from '../types'

const data = ref<LearningPath | null>(null)
const loading = ref(true)
const failed = ref(false)

async function loadPlan() {
  loading.value = true
  failed.value = false
  try {
    data.value = await learningPathApi.get()
  } catch {
    failed.value = true
  } finally {
    loading.value = false
  }
}
onMounted(loadPlan)

const hasPlan = computed(() => (data.value?.subjects ?? []).some((s) => s.dailyMinutes > 0))

// 各科每日分配之和：科目较多触发「每科最低 10 分钟保底」时会大于用户设置的每日目标，
// 与后端 weeklyTotalMinutes（求和 × 7）同一口径（P2-08）
const dailyTotalMinutes = computed(() => (data.value?.subjects ?? []).reduce((sum, s) => sum + s.dailyMinutes, 0))

const overGoalNote = computed(() => {
  if (!data.value || !hasPlan.value) return ''
  if (dailyTotalMinutes.value <= data.value.dailyGoalMinutes) return ''
  return `因科目较多，已按每科最低 10 分钟保底，实际每日总时长为 ${formatMinutes(dailyTotalMinutes.value)}`
})

// ---- 分享求监督 ----
const showComposer = ref(false)
const composerContent = ref('')
function openShare() {
  if (!data.value) return
  const lines = data.value.subjects
    .filter((s) => s.dailyMinutes > 0)
    .map((s) => `${subjectLabel(s)} ${formatMinutes(s.dailyMinutes)}/天`)
  composerContent.value = [
    '我的周学习计划',
    data.value.daysLeft != null && data.value.daysLeft > 0 ? `距离考试还有 ${data.value.daysLeft} 天` : '',
    `每日目标 ${formatMinutes(dailyTotalMinutes.value)}`,
    lines.length ? `${lines.join('、')}` : '',
    '求监督，一起上岸！'
  ]
    .filter(Boolean)
    .join('\n')
  showComposer.value = true
}
</script>

<template>
  <div class="card">
    <p v-if="loading" class="study-note" role="status">正在读取本周时间分配…</p>
    <div v-else-if="failed" class="flex items-center justify-between gap-3">
      <p class="study-note">本周时间分配未能加载，检查网络后重试。</p>
      <button class="btn-ghost" @click="loadPlan">重试</button>
    </div>
    <template v-else-if="data">
      <div class="flex items-center justify-between mb-3">
        <div class="section-title !mb-0">本周时间分配</div>
        <button class="btn-ghost !text-xs !px-2 !py-1" @click="openShare">分享计划</button>
      </div>

      <p class="study-note mb-3">按科目权重分配时间，作为本周安排的参考。</p>
      <!-- 科目分配 -->
      <div v-if="hasPlan" class="space-y-2">
        <div
          v-for="s in data.subjects.filter((x) => x.dailyMinutes > 0)"
          :key="s.id"
          class="flex items-center gap-2 text-sm"
        >
          <SubjectIcon v-if="s.icon" :icon="s.icon" class="w-5 text-center" />
          <span class="flex-1 truncate">{{ s.name }}</span>
          <span class="font-semibold text-action shrink-0">{{ formatMinutes(s.dailyMinutes) }}/天</span>
        </div>
        <div class="flex items-center justify-between border-t border-slate-100 dark:border-slate-700 pt-2 mt-2">
          <span class="text-xs text-slate-400">本周总目标</span>
          <span class="text-sm font-bold">{{ formatMinutes(data.weeklyTotalMinutes) }}</span>
        </div>
        <p v-if="overGoalNote" class="text-xs text-slate-400 dark:text-slate-500">{{ overGoalNote }}</p>
      </div>
      <div v-else class="text-xs text-slate-400">先在设置中添加考试科目和每日目标，再查看时间分配。</div>
    </template>
    <PostComposer
      v-model:show="showComposer"
      type="checkin"
      :preset-content="composerContent"
      :preset-tags="['#每日打卡', '#升本经验']"
    />
  </div>
</template>
