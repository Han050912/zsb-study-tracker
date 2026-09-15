<script setup lang="ts">
/** 词汇图表卡：近 14 个打卡日词汇量（按日聚合堆叠柱状图）；数据直接读 app store */
import { computed } from 'vue'
import { useAppStore } from '../../stores/app'
import { useChart, chartTextColor } from '../../composables/useChart'

const store = useAppStore()
const eng = computed(() => store.english)

/** 近 14 个自然日词汇量（无打卡的日期补 0，保证图表连续不断档） */
const vocabByDate = computed(() => {
  const map: Record<string, { newWords: number; reviewWords: number }> = {}
  for (const v of eng.value.vocab) {
    map[v.date] = map[v.date] || { newWords: 0, reviewWords: 0 }
    map[v.date].newWords += v.newWords
    map[v.date].reviewWords += v.reviewWords
  }
  const days: { date: string; newWords: number; reviewWords: number }[] = []
  for (let i = 13; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    days.push({ date: key, ...(map[key] || { newWords: 0, reviewWords: 0 }) })
  }
  return days
})

// ---- 词汇图表（按日聚合） ----
const { el: vocabEl } = useChart(() => {
  const data = vocabByDate.value
  return {
    grid: { left: 40, right: 16, top: 30, bottom: 24 },
    legend: { textStyle: { color: chartTextColor(), fontSize: 10 } },
    xAxis: {
      type: 'category',
      data: data.map((v) => v.date.slice(5)),
      axisLabel: { color: chartTextColor(), fontSize: 10 }
    },
    yAxis: { type: 'value', axisLabel: { color: chartTextColor() } },
    series: [
      { name: '新学', type: 'bar', stack: 'a', data: data.map((v) => v.newWords), itemStyle: { color: '#10b981' } },
      { name: '复习', type: 'bar', stack: 'a', data: data.map((v) => v.reviewWords), itemStyle: { color: '#6ee7b7' } }
    ],
    tooltip: { trigger: 'axis' }
  }
}, [vocabByDate])
</script>

<template>
  <div class="card">
    <div class="section-title">近 14 个打卡日词汇量</div>
    <div ref="vocabEl" class="h-52"></div>
  </div>
</template>
