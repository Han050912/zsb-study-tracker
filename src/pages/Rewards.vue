<script setup lang="ts">
import { computed, ref } from 'vue'
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

const { el: pointsEl } = useChart(() => {
  let cum = store.gamification.pointsLog
    .filter(l => l.date < rankDays.value[0])
    .reduce((s, l) => s + l.points, 0)
  const daily = rankDays.value.map(d => store.gamification.pointsLog.filter(l => l.date === d).reduce((s, l) => s + l.points, 0))
  const cumulative = daily.map(v => (cum += v))
  return {
    grid: { left: 40, right: 40, top: 30, bottom: 24 },
    legend: { textStyle: { color: chartTextColor(), fontSize: 10 } },
    xAxis: { type: 'category', data: rankDays.value.map(d => d.slice(5)), axisLabel: { color: chartTextColor(), fontSize: 10 } },
    yAxis: [
      { type: 'value', name: '日积分', axisLabel: { color: chartTextColor() } },
      { type: 'value', name: '累计', axisLabel: { color: chartTextColor() } }
    ],
    series: [
      { name: '每日获得', type: 'bar', data: daily, itemStyle: { color: '#f59e0b', borderRadius: [4, 4, 0, 0] }, barMaxWidth: 16 },
      { name: '累计积分', type: 'line', yAxisIndex: 1, smooth: true, data: cumulative, lineStyle: { color: '#3b82f6' }, itemStyle: { color: '#3b82f6' } }
    ],
    tooltip: { trigger: 'axis' }
  }
}, [rankDays])

const stats = computed(() => [
  { label: '累计学习', value: formatMinutes(store.totalMinutes), icon: '⏱' },
  { label: '累计刷题', value: store.totalProblems, icon: '✏️' },
  { label: '错题复习', value: store.errorQuestions.reduce((s, e) => s + e.reviewCount, 0), icon: '📕' },
  { label: '连续天数', value: store.gamification.streak, icon: '🔥' }
])
</script>

<template>
  <div class="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
    <h1 class="page-title">🏆 成就激励</h1>

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
            {{ store.level.next ? `距「${store.level.next.name}」还需 ${store.level.next.min - store.gamification.points} 积分` : '已达最高等级，王者无敌！👑' }}
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
        <div class="text-lg">{{ s.icon }}</div>
        <div class="text-lg font-black">{{ s.value }}</div>
        <div class="text-[10px] text-slate-400">{{ s.label }}</div>
      </div>
    </div>

    <!-- 徽章墙 -->
    <div class="card">
      <div class="section-title">🎖 成就徽章墙（{{ unlocked.size }}/{{ ACHIEVEMENTS.length }}）</div>
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
