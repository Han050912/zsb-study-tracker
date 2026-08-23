<script setup lang="ts">
/**
 * 学习热力图：GitHub 贡献图风格，最近 30 周学习时长色块矩阵。
 * 颜色梯度：0 → 无记录（浅灰），1-30 → 浅绿，31-60 → 中绿，61-120 → 深绿，120+ → 墨绿。
 * 月份标签严格对应所在列（周）的起始日期，且每隔 3 个月标注一次。
 * 点击色块触发 select 事件，携带日期 YYYY-MM-DD。
 */
import { computed } from 'vue'
import dayjs from 'dayjs'

const props = defineProps<{
  data: { date: string; minutes: number }[]
}>()

/** 点击某个日期格子时触发，携带日期 YYYY-MM-DD */
const emit = defineEmits<{ select: [date: string] }>()

/** 只展示最近 30 周 */
const WEEKS = 30

/** data 转 Map：日期 → 分钟数，便于按周网格查找 */
const minuteMap = computed(() => {
  const m = new Map<string, number>()
  for (const d of props.data) if (d.date) m.set(d.date, d.minutes)
  return m
})

interface Cell { date: string; minutes: number }
interface Col { cells: Cell[]; monthLabel: string }

/** 30 周网格：以今天为终点，对齐到本周周日再向前 29 周，恰好 30 列；月份标签每隔 3 个月标注一次 */
const cols = computed<Col[]>(() => {
  const end = dayjs()
  // 本周周日（end 对齐到最近周日），再往前 29 周 = 30 个周日边界（30 列）
  const startSunday = end.subtract(end.day(), 'day').subtract((WEEKS - 1) * 7, 'day')
  const raw: Cell[][] = []
  let week: Cell[] = []
  for (let d = startSunday; !d.isAfter(end); d = d.add(1, 'day')) {
    const key = d.format('YYYY-MM-DD')
    week.push({ date: key, minutes: minuteMap.value.get(key) ?? 0 })
    if (week.length === 7) { raw.push(week); week = [] }
  }
  if (week.length) raw.push(week)

  // 月份标签严格对应所在列（用 year*12+month 比较，避免跨年误判），且间隔 >= 3 个月才标注
  let lastLabelYm = -1
  return raw.map(cells => {
    const dt = new Date(cells[0].date + 'T00:00:00')
    const ym = dt.getFullYear() * 12 + dt.getMonth()
    const show = lastLabelYm === -1 || ym - lastLabelYm >= 3
    const monthLabel = show ? `${dt.getMonth() + 1}月` : ''
    if (show) lastLabelYm = ym
    return { cells, monthLabel }
  })
})

const colorClass = (minutes: number) => {
  if (minutes === 0) return 'bg-slate-100 dark:bg-slate-800'
  if (minutes <= 30) return 'bg-green-200 dark:bg-green-900'
  if (minutes <= 60) return 'bg-green-400 dark:bg-green-700'
  if (minutes <= 120) return 'bg-green-600 dark:bg-green-500'
  return 'bg-green-800 dark:bg-green-300'
}

const tooltip = (d: Cell) => {
  if (d.minutes === 0) return `${d.date}：未学习`
  const h = Math.floor(d.minutes / 60)
  const m = d.minutes % 60
  return `${d.date}：${h > 0 ? `${h} 小时 ` : ''}${m} 分钟`
}
</script>

<template>
  <div>
    <div class="flex gap-0.5">
      <!-- 热力图列：月份标签 + 7 格 -->
      <div v-for="(col, ci) in cols" :key="ci" class="flex flex-col gap-0.5">
        <div class="h-4 text-[10px] text-slate-400 whitespace-nowrap leading-4">{{ col.monthLabel }}</div>
        <div
          v-for="(d, di) in col.cells"
          :key="di"
          class="w-3 h-3 rounded-sm transition-transform cursor-pointer hover:scale-125"
          :class="colorClass(d.minutes)"
          :title="tooltip(d)"
          @click="emit('select', d.date)"
        />
      </div>
    </div>
    <!-- 图例 -->
    <div class="flex items-center gap-1 text-[10px] text-slate-400 mt-2">
      <span>少</span>
      <div class="w-3 h-3 rounded-sm bg-slate-100 dark:bg-slate-800" />
      <div class="w-3 h-3 rounded-sm bg-green-200 dark:bg-green-900" />
      <div class="w-3 h-3 rounded-sm bg-green-400 dark:bg-green-700" />
      <div class="w-3 h-3 rounded-sm bg-green-600 dark:bg-green-500" />
      <div class="w-3 h-3 rounded-sm bg-green-800 dark:bg-green-300" />
      <span>多</span>
    </div>
  </div>
</template>
