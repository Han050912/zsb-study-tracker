<script setup lang="ts">
import { computed, ref } from 'vue'
import dayjs from 'dayjs'
import { businessDate } from '../utils/date'

const props = withDefaults(
  defineProps<{
    data: Record<string, number>
    weeks?: number
    endDate?: string
  }>(),
  { weeks: 20 }
)

/** 点击某个日期格子时触发，携带日期 YYYY-MM-DD */
const emit = defineEmits<{ select: [date: string] }>()

/** GitHub 风格贡献热力图：严格生成 weeks 列，末列止于今天（之后的日期不存在，不渲染占位） */
const cells = computed(() => {
  const result: { date: string; value: number; level: number }[][] = []
  // 网格终点取 UTC+8 业务日期（不随系统时区变化）；dayjs 仅在该纯日期串上做日历算术（等价于本地解析）
  const end = dayjs(props.endDate || businessDate())
  // 首列对齐到周日，向前铺满 weeks 个整周：起点 = 本周周日 - (weeks-1)*7，
  // 天数恰落在 (weeks-1)*7+1 ~ weeks*7 之间，列数恒等于 weeks（末列为当天所在的不完整周）
  const start = end.subtract(end.day() + (props.weeks - 1) * 7, 'day')
  let week: { date: string; value: number; level: number }[] = []
  for (let d = start; !d.isAfter(end); d = d.add(1, 'day')) {
    const key = d.format('YYYY-MM-DD')
    const v = props.data[key] || 0
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

/** 可交互日期集合，方向键导航时用于校验目标格是否存在 */
const dateSet = computed(() => {
  const dates = new Set<string>()
  for (const week of cells.value) {
    for (const cell of week) {
      dates.add(cell.date)
    }
  }
  return dates
})

/** roving tabindex：整张热力图只占一个 Tab 位（否则 140 个格子会淹没页面的 Tab 顺序），
 *  方向键在格子间移动焦点，Enter/Space 查看明细；默认停在今天 */
const activeDate = ref(props.endDate || businessDate())
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
        <!-- 原生日期按钮；20px 格子横向滚动，保留方向键导航。统计页另有大尺寸日期入口。 -->
        <button
          v-for="cell in week"
          :key="cell.date"
          type="button"
          :data-date="cell.date"
          :tabindex="cell.date === activeDate ? 0 : -1"
          class="relative w-5 h-5 rounded-sm hover:ring-1 hover:ring-action active:ring-2 active:ring-action focus-visible:outline-2"
          :class="colors[cell.level]"
          :title="`${cell.date}：${cell.value}分钟（点击查看明细）`"
          :aria-label="cell.value > 0 ? `${cell.date}，学习 ${cell.value} 分钟` : `${cell.date}，无学习记录`"
          @focus="activeDate = cell.date"
          @click="emit('select', cell.date)"
          @keydown="moveFocus($event, cell.date)"
        ></button>
      </div>
    </div>
    <div class="flex flex-wrap items-center gap-x-3 gap-y-1 mt-3 text-[10px] text-muted">
      <span
        v-for="(label, index) in ['无记录', '1–59分', '60–119分', '120–239分', '240分及以上']"
        :key="label"
        class="inline-flex items-center gap-1"
        ><span class="w-2.5 h-2.5 rounded-sm" :class="colors[index]" aria-hidden="true"></span>{{ label }}</span
      >
    </div>
  </div>
</template>
