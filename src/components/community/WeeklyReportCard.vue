<script setup lang="ts">
/**
 * 每周学习周报卡（P1）：上周学习数据惰性计算 + 一键分享到广场。
 * 上周无学习数据（时长与刷题均为 0）时不渲染，不打扰。
 */
import { computed, onMounted, ref } from 'vue'
import { communityApi } from '../../api/community'
import { formatMinutes } from '../../utils/date'
import { useAppStore } from '../../stores/app'
import PostComposer from './PostComposer.vue'
import type { WeeklyReport } from '../../types'

const store = useAppStore()
const data = ref<WeeklyReport | null>(null)

onMounted(async () => {
  try { data.value = await communityApi.weeklyReport() } catch { /* 静默降级 */ }
})

const hasData = computed(() => !!data.value && (data.value.minutes > 0 || data.value.problems > 0))
const accuracy = computed(() => data.value && data.value.problems
  ? Math.round((data.value.correct / data.value.problems) * 100) : 0)
const daysLeft = computed(() => {
  const d = store.settings.examDate
  if (!d) return null
  const diff = Math.ceil((new Date(d + 'T00:00:00+08:00').getTime() - Date.now()) / 86400_000)
  return diff
})

// ---- 分享到广场 ----
const showComposer = ref(false)
const composerContent = ref('')
function openShare() {
  if (!data.value) return
  composerContent.value = [
    '📅 我的学习周报',
    `⏱️ 学习 ${formatMinutes(data.value.minutes)} · ${data.value.studyDays} 天`,
    data.value.problems ? `✏️ 刷题 ${data.value.problems} 题，正确率 ${accuracy.value}%` : '',
    `⭐ 积分 +${data.value.points} · 社区互动 ${data.value.interactions} 次`,
    daysLeft.value != null && daysLeft.value > 0 ? `🎯 距离考试还有 ${daysLeft.value} 天` : '',
    '新的一周继续加油！💪'
  ].filter(Boolean).join('\n')
  showComposer.value = true
}
</script>

<template>
  <div v-if="hasData && data" class="card">
    <div class="flex items-center justify-between mb-3">
      <div class="section-title !mb-0">📊 上周学习周报</div>
      <button class="btn-ghost !text-xs !px-2 !py-1" @click="openShare">📣 分享</button>
    </div>
    <div class="grid grid-cols-4 gap-2 text-center">
      <div>
        <div class="text-sm font-bold text-primary-500">{{ formatMinutes(data.minutes) }}</div>
        <div class="text-[10px] text-slate-400 mt-0.5">学习时长</div>
      </div>
      <div>
        <div class="text-sm font-bold text-emerald-500">{{ data.studyDays }} 天</div>
        <div class="text-[10px] text-slate-400 mt-0.5">学习天数</div>
      </div>
      <div>
        <div class="text-sm font-bold text-sky-500">{{ data.problems }}<span v-if="data.problems" class="text-[10px] font-medium"> 题</span></div>
        <div class="text-[10px] text-slate-400 mt-0.5">刷题数<template v-if="data.problems">（{{ accuracy }}%）</template></div>
      </div>
      <div>
        <div class="text-sm font-bold text-amber-500">+{{ data.points }}</div>
        <div class="text-[10px] text-slate-400 mt-0.5">积分变化</div>
      </div>
    </div>
    <div class="flex items-center justify-between border-t border-slate-100 dark:border-slate-700 pt-2 mt-3 text-[10px] text-slate-400">
      <span>{{ data.weekStart }} ~ {{ data.weekEnd }} · 社区互动 {{ data.interactions }} 次</span>
      <span v-if="daysLeft != null && daysLeft > 0">距考试 {{ daysLeft }} 天</span>
    </div>
    <PostComposer v-model:show="showComposer" type="checkin" :preset-content="composerContent" :preset-tags="['#每日打卡']" />
  </div>
</template>
