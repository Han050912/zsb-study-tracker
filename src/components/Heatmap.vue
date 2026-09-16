<script setup lang="ts">
import { computed, ref } from 'vue'
import dayjs from 'dayjs'
import { businessDate, today } from '../utils/date'

const props = withDefaults(
  defineProps<{
    data: Record<string, number>
    weeks?: number
  }>(),
  { weeks: 20 }
)

/** 点击某个日期格子时触发，携带日期 YYYY-MM-DD */
const emit = defineEmits<{ select: [date: string] }>()

/** GitHub 风格贡献热力图 */
const cells = computed(() => {
  const result: { date: string; value: number; level: number }[][] = []
  // 网格终点取 UTC+8 业务日期（不随系统时区变化）；dayjs 仅在该纯日期串上做日历算术（等价于本地解析）
  const end = dayjs(businessDate())
  const start = end.subtract(props.weeks * 7 - 1, 'day')
  const startSunday = start.subtract(start.day(), 'day')
  let week: { date: string; value: number; level: number }[] = []
  for (let d = startSunday; !d.isAfter(end); d = d.add(1, 'day')) {
    const key = d.format('YYYY-MM-DD')
    const v = d.isAfter(end) ? -1 : props.data[key] || 0
    const level = v <= 0 ? 0 : v < 60 ? 1 : v < 120 ? 2 : v < 240 ? 3 : 4
    week.push({ date: key, value: v, level })
    if (week.length === 7) {
      result.push(week)
      week = []
    }
  }
  if (week.length) result.push(week)
  return result
})

const colors = [
  'bg-slate-100 dark:bg-slate-700',
  'bg-primary-200',
  'bg-primary-300',
  'bg-primary-500',
  'bg-primary-700'
]

/** 可交互日期集合（负值占位格除外），方向键导航时用于校验目标格是否存在 */
const dateSet = computed(() => {
  const dates = new Set<string>()
  for (const week of cells.value) {
    for (const cell of week) {
      if (cell.value >= 0) dates.add(cell.date)
    }
  }
  return dates
})

/** roving tabindex：整张热力图只占一个 Tab 位（否则 140 个格子会淹没页面的 Tab 顺序），
 *  方向键在格子间移动焦点，Enter/Space 查看明细；默认停在今天 */
const activeDate = ref(today())
const gridEl = ref<HTMLElement | null>(null)

// 布局是「一列 = 一周、自上而下 = 周日→周六」，故上下移动一天、左右移动一周
const navStep: Record<string, number> = { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -7, ArrowRight: 7 }

/** 方向键导航：按格子实际方位移动焦点；目标格不在图上时保持原地 */
function moveFocus(e: KeyboardEvent, date: string) {
  const step = navStep[e.key]
  if (!step) return
  e.preventDefault()
  const next = dayjs(date).add(step, 'day').format('YYYY-MM-DD')
  if (!dateSet.value.has(next)) return
  activeDate.value = next
  gridEl.value?.querySelector<HTMLElement>(`[data-date="${next}"]`)?.focus()
}
</script>

<template>
  <div class="overflow-x-auto">
    <div ref="gridEl" class="flex gap-[3px] w-max" role="group" aria-label="学习热力图">
      <div v-for="(week, wi) in cells" :key="wi" class="flex flex-col gap-[3px]">
        <template v-for="cell in week" :key="cell.date">
          <!-- 负值日期仅占位对齐周列，不参与交互 -->
          <span v-if="cell.value < 0" class="w-3 h-3"></span>
          <!-- 日期格改用 button：原生可聚焦 + Enter/Space 触发，视觉仍 12×12。
               命中区只能扩到 14×14：相邻格中心距仅 15px，扩得更多会被后绘制的邻格
               抢占（点到可见的本格却选中邻格），44×44 需要 44px 的格距（整图会变成 880px 宽） -->
          <button
            v-else
            type="button"
            :data-date="cell.date"
            :tabindex="cell.date === activeDate ? 0 : -1"
            class="relative w-3 h-3 rounded-sm transition-transform hover:scale-125 after:absolute after:-inset-px after:content-[''] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
            :class="colors[cell.level]"
            :title="`${cell.date}：${cell.value}分钟（点击查看明细）`"
            :aria-label="cell.value > 0 ? `${cell.date}，学习 ${cell.value} 分钟` : `${cell.date}，无学习记录`"
            @focus="activeDate = cell.date"
            @click="emit('select', cell.date)"
            @keydown="moveFocus($event, cell.date)"
          ></button>
        </template>
      </div>
    </div>
    <div class="flex items-center gap-1 mt-2 text-[10px] text-slate-400">
      少 <span v-for="c in colors" :key="c" class="w-2.5 h-2.5 rounded-sm" :class="c"></span> 多
    </div>
  </div>
</template>
