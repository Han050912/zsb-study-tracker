<script setup lang="ts">
/** 词汇图表卡：近 14 天单词打卡数量（按日聚合堆叠柱状图）；数据直接读 app store */
import { computed } from 'vue'
import { useAppStore } from '../../stores/app'
import { useChart, chartTextColor, chartColor } from '../../composables/useChart'
import ChartFallback from '../ChartFallback.vue'

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
    const key = new Date(Date.parse(store.todayKey + 'T00:00:00Z') - i * 86400_000).toISOString().slice(0, 10)
    days.push({ date: key, ...(map[key] || { newWords: 0, reviewWords: 0 }) })
  }
  return days
})

// ---- 词汇图表（按日聚合） ----
const {
  el: vocabEl,
  status: vocabStatus,
  retry: retryVocab
} = useChart(() => {
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
      {
        name: '新学',
        type: 'bar',
        stack: 'a',
        data: data.map((v) => v.newWords),
        itemStyle: { color: chartColor('action') }
      },
      {
        name: '复习',
        type: 'bar',
        stack: 'a',
        data: data.map((v) => v.reviewWords),
        itemStyle: { color: chartColor('muted') }
      }
    ],
    tooltip: { trigger: 'axis' }
  }
}, [vocabByDate])
</script>

<template>
  <div class="card">
    <div class="section-title">近 14 天单词打卡数量</div>
    <ChartFallback v-if="vocabStatus === 'error'" class="h-52" @retry="retryVocab" />
    <div v-else ref="vocabEl" class="h-52"></div>
    <p class="study-note">按自然日累加新学与复习数量，重复复习也会计入，不表示词汇掌握量。</p>
  </div>
</template>
