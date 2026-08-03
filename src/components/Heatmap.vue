<script setup lang="ts">
import { computed } from 'vue'
import dayjs from 'dayjs'

const props = withDefaults(defineProps<{
  data: Record<string, number>
  weeks?: number
}>(), { weeks: 20 })

/** 点击某个日期格子时触发，携带日期 YYYY-MM-DD */
const emit = defineEmits<{ select: [date: string] }>()

/** GitHub 风格贡献热力图 */
const cells = computed(() => {
  const result: { date: string; value: number; level: number }[][] = []
  const end = dayjs()
  const start = end.subtract(props.weeks * 7 - 1, 'day')
  const startSunday = start.subtract(start.day(), 'day')
  let week: { date: string; value: number; level: number }[] = []
  for (let d = startSunday; !d.isAfter(end); d = d.add(1, 'day')) {
    const key = d.format('YYYY-MM-DD')
    const v = d.isAfter(end) ? -1 : (props.data[key] || 0)
    const level = v <= 0 ? 0 : v < 60 ? 1 : v < 120 ? 2 : v < 240 ? 3 : 4
    week.push({ date: key, value: v, level })
    if (week.length === 7) { result.push(week); week = [] }
  }
  if (week.length) result.push(week)
  return result
})

const colors = ['bg-slate-100 dark:bg-slate-700', 'bg-primary-200', 'bg-primary-300', 'bg-primary-500', 'bg-primary-700']
</script>

<template>
  <div class="overflow-x-auto">
    <div class="flex gap-[3px] w-max">
      <div v-for="(week, wi) in cells" :key="wi" class="flex flex-col gap-[3px]">
        <div v-for="cell in week" :key="cell.date"
          class="w-3 h-3 rounded-sm transition-transform hover:scale-125"
          :class="[cell.value < 0 ? 'opacity-0' : colors[cell.level], cell.value >= 0 ? 'cursor-pointer' : '']"
          :title="cell.value >= 0 ? `${cell.date}：${cell.value}分钟（点击查看明细）` : ''"
          @click="cell.value >= 0 && emit('select', cell.date)">
        </div>
      </div>
    </div>
    <div class="flex items-center gap-1 mt-2 text-[10px] text-slate-400">
      少 <span v-for="c in colors" :key="c" class="w-2.5 h-2.5 rounded-sm" :class="c"></span> 多
    </div>
  </div>
</template>
