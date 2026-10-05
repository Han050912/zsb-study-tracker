<script setup lang="ts">
import EmptyState from '../shared/components/EmptyState.vue'
import { computed, ref } from 'vue'
import { BookOpenCheck, Clock3, Flame, Pencil } from '@lucide/vue'
import { useAppStore } from '../stores/app'
import { ACHIEVEMENTS, LEVELS, levelOf } from '../data/defaults'
import { useChart, chartTextColor, chartColor } from '../composables/useChart'
import ChartFallback from '../components/ChartFallback.vue'
import { formatMinutes } from '../utils/date'

const store = useAppStore()

const unlocked = computed(() => new Set(store.gamification.achievements))

const levelProgress = computed(() => {
  const cur = store.level
  if (!cur.next) return 100
  return ((store.gamification.points - cur.min) / (cur.next.min - cur.min)) * 100
})

/** 已达等级在 LEVELS 中的索引：等级条按「积分 >= 该级门槛」逐级高亮，等价复用统一定义的 levelOf */
const levelIndex = computed(() => LEVELS.indexOf(levelOf(store.gamification.points)))

// ---- 积分走势（自我排行榜：周/月） ----
const rankRange = ref<7 | 30>(7)
const rankDays = computed(() =>
  Array.from({ length: rankRange.value }, (_, i) =>
    new Date(Date.parse(`${store.todayKey}T00:00:00Z`) - (rankRange.value - 1 - i) * 86400_000)
      .toISOString()
      .slice(0, 10)
  )
)

// 提取为响应式数据，供 useChart 依赖追踪（积分新增时自动重绘）
const pointsTrend = computed(() => {
  const logs = store.gamification.pointsLog
  const start = rankDays.value[0]
  const dailyByDate: Record<string, number> = {}
  for (const l of logs) {
    if (l.date >= start) dailyByDate[l.date] = (dailyByDate[l.date] || 0) + l.points
  }
  const daily = rankDays.value.map((d) => dailyByDate[d] || 0)
  // 基准 = 全量总积分 - 区间内新增：回传流水被时间窗/条数截断（见 getGamification）时，
  // 仍能精确还原「区间前历史累计」，折线终点恒等于服务端权威总积分
  let cum = store.gamification.points - daily.reduce((s, v) => s + v, 0)
  const cumulative = daily.map((v) => (cum += v))
  return { daily, cumulative }
})

const {
  el: pointsEl,
  status: pointsStatus,
  retry: retryPoints
} = useChart(() => {
  const { daily, cumulative } = pointsTrend.value
  return {
    grid: { left: 40, right: 40, top: 30, bottom: 24 },
    legend: { textStyle: { color: chartTextColor(), fontSize: 10 } },
    xAxis: {
      type: 'category',
      data: rankDays.value.map((d) => d.slice(5)),
      axisLabel: { color: chartTextColor(), fontSize: 10 }
    },
    // 双 Y 轴均从 0 起，避免 ECharts 自动 min 让折线起点看似异常
    yAxis: [
      { type: 'value', name: '日积分', min: 0, axisLabel: { color: chartTextColor() } },
      { type: 'value', name: '累计', min: 0, axisLabel: { color: chartTextColor() } }
    ],
    series: [
      {
        name: '每日获得',
        type: 'bar',
        data: daily,
        itemStyle: { color: chartColor('action'), borderRadius: [4, 4, 0, 0] },
        barMaxWidth: 16
      },
      {
        name: '累计积分',
        type: 'line',
        yAxisIndex: 1,
        smooth: false,
        data: cumulative,
        lineStyle: { color: chartColor('muted'), width: 2 },
        itemStyle: { color: chartColor('muted') },
        symbol: 'circle',
        symbolSize: 6
      }
    ],
    tooltip: {
      trigger: 'axis',
      formatter: (ps: any) => {
        const list = Array.isArray(ps) ? ps : [ps]
        const d = rankDays.value[list[0]?.dataIndex ?? 0]
        if (!d) return ''
        const idx = list[0].dataIndex
        return [`${d}`, `每日新增：+${daily[idx] ?? 0} 分`, `累计积分：${cumulative[idx] ?? 0} 分`].join('<br>')
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
  <div class="study-page space-y-4">
    <header class="study-page-heading">
      <div>
        <h1 class="page-title">积分与成就</h1>
        <p class="page-description">每一次学习都有记录，在这里回看你的积累。</p>
      </div>
    </header>

    <section class="card space-y-4" aria-labelledby="earned-level">
      <div class="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="earned-level" class="text-lg font-bold">{{ store.level.name }}学者</h2>
        <p class="font-data text-2xl font-bold">
          {{ store.gamification.points }} <span class="text-sm font-normal text-muted">积分</span>
        </p>
      </div>
      <p class="text-sm text-muted">积分记录你的学习和互动，不代表考试分数或知识掌握程度。</p>
      <p class="text-xs text-muted">
        学习积分（含打卡与学习里程碑）每日最多 300 分，按 UTC+8 计算；社区互动另计，实际积分以同步结果为准。
      </p>
      <div
        role="progressbar"
        aria-label="当前等级进度"
        :aria-valuenow="Math.round(levelProgress)"
        :aria-valuemin="0"
        :aria-valuemax="100"
        class="h-2 bg-surface-soft rounded-full overflow-hidden"
      >
        <div class="h-full bg-action" :style="{ width: levelProgress + '%' }"></div>
      </div>
      <p class="text-sm">
        {{
          store.level.next
            ? `距「${store.level.next.name}」还需 ${store.level.next.min - store.gamification.points} 积分`
            : '已达到最高积分等级'
        }}
      </p>
      <div class="flex gap-2 flex-wrap text-xs">
        <span
          v-for="(l, i) in LEVELS"
          :key="l.name"
          class="px-2 py-1 rounded border border-line"
          :class="i <= levelIndex ? 'text-action bg-action-soft' : 'text-muted'"
          >{{ l.name }} {{ l.min }}+</span
        >
      </div>
    </section>

    <!-- 数据一览 -->
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <div v-for="s in stats" :key="s.label" class="card !p-3 text-center">
        <div class="flex justify-center text-slate-400"><component :is="s.icon" class="w-5 h-5" /></div>
        <div class="text-lg font-black">{{ s.value }}</div>
        <div class="text-xs text-slate-400">{{ s.label }}</div>
      </div>
    </div>

    <!-- 徽章墙 -->
    <div class="card">
      <div class="section-title">成就徽章墙（{{ unlocked.size }}/{{ ACHIEVEMENTS.length }}）</div>
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <div
          v-for="a in ACHIEVEMENTS"
          :key="a.id"
          class="rounded-lg p-4 border"
          :class="
            unlocked.has(a.id) ? 'border-line bg-action-soft dark:bg-action-soft dark:border-line' : 'border-line'
          "
        >
          <p class="text-xs text-muted">{{ unlocked.has(a.id) ? '已完成' : '待完成' }}</p>
          <div class="text-xs font-bold mt-1">{{ a.name }}</div>
          <div class="text-xs text-slate-400 mt-0.5">{{ a.desc }}</div>
        </div>
      </div>
    </div>

    <!-- 积分走势 -->
    <div class="card">
      <div class="flex flex-wrap items-center justify-between gap-2 mb-2">
        <div class="section-title !mb-0">积分从哪里来</div>
        <div class="flex gap-1 bg-slate-100 dark:bg-slate-800 rounded-lg p-1">
          <button
            class="btn !py-1 !text-xs"
            :class="rankRange === 7 ? 'bg-white dark:bg-slate-700 shadow-sm' : ''"
            :aria-pressed="rankRange === 7"
            @click="rankRange = 7"
          >
            近 7 天
          </button>
          <button
            class="btn !py-1 !text-xs"
            :class="rankRange === 30 ? 'bg-white dark:bg-slate-700 shadow-sm' : ''"
            :aria-pressed="rankRange === 30"
            @click="rankRange = 30"
          >
            近 30 天
          </button>
        </div>
      </div>
      <ChartFallback v-if="pointsStatus === 'error'" class="h-56" @retry="retryPoints" />
      <div v-else ref="pointsEl" class="h-56"></div>
      <p class="text-xs text-slate-400 mt-2">柱为每日新增积分，折线为当日累计积分（含区间前历史积分）</p>
    </div>

    <!-- 积分日志 -->
    <div class="card">
      <div class="section-title">最近积分记录</div>
      <div class="space-y-1 max-h-56 overflow-y-auto">
        <div
          v-for="(l, i) in store.gamification.pointsLog.slice(-20).reverse()"
          :key="i"
          class="flex items-center gap-2 text-xs"
        >
          <span class="text-slate-400 w-20">{{ l.date }}</span>
          <span class="flex-1">{{ l.reason }}</span>
          <span class="font-bold text-action">+{{ l.points }}</span>
        </div>
        <EmptyState
          v-if="!store.gamification.pointsLog.length"
          title="还没有积分记录。完成学习打卡后，可在这里查看积分来源。"
        />
      </div>
    </div>
  </div>
</template>
