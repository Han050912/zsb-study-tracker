<script setup lang="ts">
import { computed, ref } from 'vue'
import { BookOpenCheck, Clock3, Flame, Pencil } from '@lucide/vue'
import { useAppStore } from '../stores/app'
import { ACHIEVEMENTS, LEVELS } from '../data/defaults'
import { useChart, chartTextColor } from '../composables/useChart'
import { formatMinutes } from '../utils/date'
import dayjs from 'dayjs'

const store = useAppStore()

const unlocked = computed(() => new Set(store.gamification.achievements))

const levelProgress = computed(() => {
  const cur = store.level
  if (!cur.next) return 100
  return ((store.gamification.points - cur.min) / (cur.next.min - cur.min)) * 100
})

// ---- 积分走势（自我排行榜：周/月） ----
const rankRange = ref<7 | 30>(7)
const rankDays = computed(() => Array.from({ length: rankRange.value }, (_, i) =>
  dayjs().subtract(rankRange.value - 1 - i, 'day').format('YYYY-MM-DD')))

// 提取为响应式数据，供 useChart 依赖追踪（积分新增时自动重绘）
const pointsTrend = computed(() => {
  const logs = store.gamification.pointsLog
  // 基准：所选区间第一天之前的历史累计积分（折线起点不从 0 开始）
  const start = rankDays.value[0]
  let cum = 0
  const dailyByDate: Record<string, number> = {}
  for (const l of logs) {
    if (l.date < start) cum += l.points
    else dailyByDate[l.date] = (dailyByDate[l.date] || 0) + l.points
  }
  const daily = rankDays.value.map(d => dailyByDate[d] || 0)
  const cumulative = daily.map(v => (cum += v))
  return { daily, cumulative }
})

const { el: pointsEl } = useChart(() => {
  const { daily, cumulative } = pointsTrend.value
  return {
    grid: { left: 40, right: 40, top: 30, bottom: 24 },
    legend: { textStyle: { color: chartTextColor(), fontSize: 10 } },
    xAxis: { type: 'category', data: rankDays.value.map(d => d.slice(5)), axisLabel: { color: chartTextColor(), fontSize: 10 } },
    // 双 Y 轴均从 0 起，避免 ECharts 自动 min 让折线起点看似异常
    yAxis: [
      { type: 'value', name: '日积分', min: 0, axisLabel: { color: chartTextColor() } },
      { type: 'value', name: '累计', min: 0, axisLabel: { color: chartTextColor() } }
    ],
    series: [
      {
        name: '每日获得', type: 'bar', data: daily,
        itemStyle: { color: '#f59e0b', borderRadius: [4, 4, 0, 0] }, barMaxWidth: 16
      },
      {
        name: '累计积分', type: 'line', yAxisIndex: 1, smooth: true, data: cumulative,
        lineStyle: { color: '#3b82f6', width: 2 }, itemStyle: { color: '#3b82f6' },
        areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [
          { offset: 0, color: 'rgba(59,130,246,0.18)' }, { offset: 1, color: 'rgba(59,130,246,0)' }
        ] } },
        symbol: 'circle', symbolSize: 6
      }
    ],
    tooltip: {
      trigger: 'axis',
      formatter: (ps: any) => {
        const list = Array.isArray(ps) ? ps : [ps]
        const d = rankDays.value[list[0]?.dataIndex ?? 0]
        if (!d) return ''
        const idx = list[0].dataIndex
        return [
          `${d}`,
          `每日新增：+${daily[idx] ?? 0} 分`,
          `累计积分：${cumulative[idx] ?? 0} 分`
        ].join('<br>')
      }
    }
  }
}, [rankDays, pointsTrend])

const stats = computed(() => [
  { label: '累计学习', value: formatMinutes(store.totalMinutes), icon: Clock3 },
  { label: '累计刷题', value: store.totalProblems, icon: Pencil },
  { label: '错题复习', value: store.errorQuestions.reduce((s, e) => s + e.reviewCount, 0), icon: BookOpenCheck },
  { label: '连续天数', value: store.gamification.streak, icon: Flame }
])
</script>

<template>
  <div class="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
    <h1 class="page-title">成就激励</h1>

    <!-- 等级卡 -->
    <div class="card bg-gradient-to-r from-slate-800 to-slate-900 dark:from-slate-700 dark:to-slate-800 !text-white border-0">
      <div class="flex items-center gap-4">
        <div class="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl font-black"
          :style="{ background: store.level.color + '33', color: store.level.color, border: `2px solid ${store.level.color}` }">
          {{ store.level.name[0] }}
        </div>
        <div class="flex-1">
          <div class="flex items-baseline gap-2">
            <span class="text-xl font-black">{{ store.level.name }}学者</span>
            <span class="text-sm opacity-70">{{ store.gamification.points }} 积分</span>
          </div>
          <div class="w-full h-2 bg-white/10 rounded-full mt-2 overflow-hidden">
            <div class="h-full rounded-full transition-all duration-700" :style="{ width: levelProgress + '%', background: store.level.color }"></div>
          </div>
          <div class="text-[11px] opacity-60 mt-1">
            {{ store.level.next ? `距「${store.level.next.name}」还需 ${store.level.next.min - store.gamification.points} 积分` : '已达最高等级，王者无敌！' }}
          </div>
        </div>
      </div>
      <div class="flex gap-1.5 mt-4 flex-wrap">
        <span v-for="l in LEVELS" :key="l.name" class="text-[10px] px-2 py-1 rounded-full"
          :class="store.gamification.points >= l.min ? 'text-white' : 'opacity-40 text-white'"
          :style="{ background: l.color + (store.gamification.points >= l.min ? '' : '55') }">
          {{ l.name }} {{ l.min }}+
        </span>
      </div>
    </div>

    <!-- 数据一览 -->
    <div class="grid grid-cols-4 gap-3">
      <div v-for="s in stats" :key="s.label" class="card !p-3 text-center">
        <div class="flex justify-center text-slate-400"><component :is="s.icon" class="w-5 h-5" /></div>
        <div class="text-lg font-black">{{ s.value }}</div>
        <div class="text-[10px] text-slate-400">{{ s.label }}</div>
      </div>
    </div>

    <!-- 徽章墙 -->
    <div class="card">
      <div class="section-title">成就徽章墙（{{ unlocked.size }}/{{ ACHIEVEMENTS.length }}）</div>
      <div class="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div v-for="a in ACHIEVEMENTS" :key="a.id"
          class="rounded-2xl p-3 text-center border transition-all"
          :class="unlocked.has(a.id)
            ? 'border-amber-200 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800'
            : 'border-slate-100 dark:border-slate-700 grayscale opacity-50'">
          <div class="text-3xl" :class="unlocked.has(a.id) ? 'animate-pop' : ''">{{ a.icon }}</div>
          <div class="text-xs font-bold mt-1">{{ a.name }}</div>
          <div class="text-[10px] text-slate-400 mt-0.5">{{ a.desc }}</div>
        </div>
      </div>
    </div>

    <!-- 积分走势 -->
    <div class="card">
      <div class="flex items-center justify-between mb-2">
        <div class="section-title !mb-0">📈 自我排行榜 · 积分走势</div>
        <div class="flex gap-1 bg-slate-100 dark:bg-slate-800 rounded-lg p-1">
          <button class="btn !py-1 !text-xs" :class="rankRange === 7 ? 'bg-white dark:bg-slate-700 shadow-sm' : ''" @click="rankRange = 7">周</button>
          <button class="btn !py-1 !text-xs" :class="rankRange === 30 ? 'bg-white dark:bg-slate-700 shadow-sm' : ''" @click="rankRange = 30">月</button>
        </div>
      </div>
      <div ref="pointsEl" class="h-56"></div>
      <p class="text-[10px] text-slate-400 mt-2">柱为每日新增积分，折线为当日累计积分（含区间前历史积分）</p>
    </div>

    <!-- 积分日志 -->
    <div class="card">
      <div class="section-title">📜 最近积分记录</div>
      <div class="space-y-1 max-h-56 overflow-y-auto">
        <div v-for="(l, i) in store.gamification.pointsLog.slice(-20).reverse()" :key="i" class="flex items-center gap-2 text-xs">
          <span class="text-slate-400 w-20">{{ l.date }}</span>
          <span class="flex-1">{{ l.reason }}</span>
          <span class="font-bold text-amber-500">+{{ l.points }}</span>
        </div>
        <div v-if="!store.gamification.pointsLog.length" class="text-xs text-slate-400 text-center py-4">还没有积分记录，快去学习打卡吧！</div>
      </div>
    </div>
  </div>
</template>
