<script setup lang="ts">
/**
 * 学习路径推荐卡（P2-4）：考试倒计时 + 按科目权重分配的周学习计划。
 * 数据来自 /api/learning-path；可一键生成打卡帖分享到社区求监督。
 */
import { computed, inject, onMounted, ref } from 'vue'
import { learningPathApi } from '../api/learningPath'
import { formatMinutes } from '../utils/date'
import { subjectLabel } from '../utils/subject'
import PostComposer from './community/PostComposer.vue'
import type { LearningPath } from '../types'

const toast = inject<(m: string) => void>('toast', () => {})

const data = ref<LearningPath | null>(null)
const loading = ref(true)

onMounted(async () => {
  try {
    data.value = await learningPathApi.get()
  } catch {
    // 静默降级：未设置考试日期/网络异常时不打扰，仅不展示计划卡
  } finally {
    loading.value = false
  }
})

const countdownText = computed(() => {
  const d = data.value?.daysLeft
  if (d == null) return '设置考试日期，开启倒计时'
  if (d > 0) return `距离考试还有 ${d} 天`
  if (d === 0) return '就是今天，加油！'
  return '考试已结束，静待佳音'
})

const hasPlan = computed(() => (data.value?.subjects ?? []).some(s => s.dailyMinutes > 0))

// ---- 分享求监督 ----
const showComposer = ref(false)
const composerContent = ref('')
function openShare() {
  if (!data.value) return
  const lines = data.value.subjects
    .filter(s => s.dailyMinutes > 0)
    .map(s => `${subjectLabel(s)} ${formatMinutes(s.dailyMinutes)}/天`)
  composerContent.value = [
    '我的周学习计划',
    data.value.daysLeft != null && data.value.daysLeft > 0 ? `距离考试还有 ${data.value.daysLeft} 天` : '',
    `每日目标 ${formatMinutes(data.value.dailyGoalMinutes)}`,
    lines.length ? `${lines.join('、')}` : '',
    '求监督，一起上岸！'
  ].filter(Boolean).join('\n')
  showComposer.value = true
}
</script>

<template>
  <div v-if="!loading && data" class="card">
    <div class="flex items-center justify-between mb-3">
      <div class="section-title !mb-0">周学习计划</div>
      <button class="btn-ghost !text-xs !px-2 !py-1" @click="openShare">分享求监督</button>
    </div>

    <!-- 倒计时 -->
    <div class="flex items-center gap-2 text-sm mb-3">
      <span class="font-semibold" :class="{ 'text-primary-500': (data.daysLeft ?? -1) > 0 }">{{ countdownText }}</span>
    </div>

    <!-- 科目分配 -->
    <div v-if="hasPlan" class="space-y-2">
      <div v-for="s in data.subjects.filter(x => x.dailyMinutes > 0)" :key="s.id"
        class="flex items-center gap-2 text-sm">
        <span v-if="s.icon" class="w-5 text-center">{{ s.icon }}</span>
        <span class="flex-1 truncate">{{ s.name }}</span>
        <span class="font-semibold text-primary-500 shrink-0">{{ formatMinutes(s.dailyMinutes) }}/天</span>
      </div>
      <div class="flex items-center justify-between border-t border-slate-100 dark:border-slate-700 pt-2 mt-2">
        <span class="text-xs text-slate-400">本周总目标</span>
        <span class="text-sm font-bold">{{ formatMinutes(data.weeklyTotalMinutes) }}</span>
      </div>
    </div>
    <div v-else class="text-xs text-slate-400">
      暂无科目，去「设置」添加科目并设置每日目标后即可生成计划。
    </div>

    <PostComposer v-model:show="showComposer" type="checkin" :preset-content="composerContent"
      :preset-tags="['#每日打卡', '#升本经验']" />
  </div>
</template>
