<script setup lang="ts">
/**
 * 学习热力图：GitHub 贡献图风格，365 天学习时长色块矩阵。
 * 颜色梯度：0 → 无记录（浅灰），1-30 → 浅绿，31-60 → 中绿，61-120 → 深绿，120+ → 墨绿。
 * 鼠标悬停显示日期 + 学习时长。
 */
import { computed } from 'vue'

const props = defineProps<{
  data: { date: string; minutes: number }[]
}>()

/** 按周分组的 53 列 × 7 行矩阵 */
const weeks = computed(() => {
  if (!props.data?.length) return []
  const result: { date: string; minutes: number; day: number }[][] = []
  let week: { date: string; minutes: number; day: number }[] = []
  for (const d of props.data) {
    const dt = new Date(d.date + 'T00:00:00')
    const day = dt.getDay() // 0=Sun
    // 第一周从周日开始填充空白
    if (result.length === 0 && week.length === 0) {
      for (let i = 0; i < day; i++) week.push({ date: '', minutes: -1, day: i })
    }
    week.push({ ...d, day })
    if (day === 6) { result.push(week); week = [] }
  }
  if (week.length) result.push(week)
  return result
})

const colorClass = (minutes: number) => {
  if (minutes < 0) return 'bg-transparent'
  if (minutes === 0) return 'bg-slate-100 dark:bg-slate-800'
  if (minutes <= 30) return 'bg-green-200 dark:bg-green-900'
  if (minutes <= 60) return 'bg-green-400 dark:bg-green-700'
  if (minutes <= 120) return 'bg-green-600 dark:bg-green-500'
  return 'bg-green-800 dark:bg-green-300'
}

const tooltip = (d: { date: string; minutes: number }) => {
  if (!d.date) return ''
  if (d.minutes === 0) return `${d.date}：未学习`
  const h = Math.floor(d.minutes / 60)
  const m = d.minutes % 60
  return `${d.date}：${h > 0 ? `${h} 小时 ` : ''}${m} 分钟`
}

const monthLabels = computed(() => {
  if (!props.data?.length) return []
  const labels: { index: number; label: string }[] = []
  let lastMonth = -1
  for (let i = 0; i < props.data.length; i++) {
    const m = new Date(props.data[i].date + 'T00:00:00').getMonth()
    if (m !== lastMonth) {
      labels.push({ index: i, label: `${m + 1}月` })
      lastMonth = m
    }
  }
  return labels
})
</script>

<template>
  <div class="overflow-x-auto">
    <div class="inline-flex flex-col gap-1 min-w-[720px]">
      <!-- 月份标签 -->
      <div class="flex gap-0.5 pl-6 text-[10px] text-slate-400">
        <template v-for="(m, i) in monthLabels" :key="i">
          <span
            v-if="i === 0 || (m.index - monthLabels[i - 1]?.index) > 7"
            class="text-xs"
            :style="{ marginLeft: `${(m.index / 7) * 12}px` }"
          >{{ m.label }}</span>
        </template>
      </div>
      <!-- 热力图网格 -->
      <div class="flex gap-0.5">
        <!-- 星期标签 -->
        <div class="flex flex-col gap-0.5 text-[10px] text-slate-400 pr-1 pt-0.5">
          <span>一</span>
          <span class="mt-1">三</span>
          <span class="mt-1">五</span>
        </div>
        <div class="flex gap-0.5">
          <div v-for="(week, wi) in weeks" :key="wi" class="flex flex-col gap-0.5">
            <div
              v-for="(d, di) in week"
              :key="di"
              class="w-3 h-3 rounded-sm cursor-default"
              :class="colorClass(d.minutes)"
              :title="tooltip(d)"
            />
          </div>
        </div>
      </div>
      <!-- 图例 -->
      <div class="flex items-center gap-1 text-[10px] text-slate-400 pl-6">
        <span>少</span>
        <div class="w-3 h-3 rounded-sm bg-slate-100 dark:bg-slate-800" />
        <div class="w-3 h-3 rounded-sm bg-green-200 dark:bg-green-900" />
        <div class="w-3 h-3 rounded-sm bg-green-400 dark:bg-green-700" />
        <div class="w-3 h-3 rounded-sm bg-green-600 dark:bg-green-500" />
        <div class="w-3 h-3 rounded-sm bg-green-800 dark:bg-green-300" />
        <span>多</span>
      </div>
    </div>
  </div>
</template>