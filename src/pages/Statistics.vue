<script setup lang="ts">
import EmptyState from '../shared/components/EmptyState.vue'
import { computed, ref, watch } from 'vue'
import { useAppStore } from '../stores/app'
import { useChart, chartTextColor, chartColor } from '../composables/useChart'
import { formatMinutes } from '../utils/date'
import { subjectLabel } from '../utils/subject'
import { focusMinutesOn } from '../utils/studyTime'
import { MOODS } from '../data/defaults'
import { PROBLEM_TYPE_LABELS } from '../data/problemTypes'
import ChartFallback from '../components/ChartFallback.vue'
import Modal from '../components/Modal.vue'

const store = useAppStore()
const range = ref<7 | 30>(7)

const days = computed(() =>
  Array.from({ length: range.value }, (_, i) =>
    new Date(Date.parse(store.todayKey + 'T00:00:00Z') - (range.value - 1 - i) * 86400_000).toISOString().slice(0, 10)
  )
)

// ---- 柱状图点击：当日各科目学习时长细分详情 ----
const barDate = ref('')
// 切换时间范围时关闭弹窗，避免展示范围外日期
watch(range, () => {
  barDate.value = ''
})

/** 指定日期各科目总学习时长（hover 提示与点击详情共用口径） */
function subjectMinutesOn(date: string) {
  const map: Record<string, number> = {}
  for (const r of store.records.filter((x) => x.date === date)) {
    map[r.subjectId] = (map[r.subjectId] || 0) + r.minutes
  }
  return map
}

/** 点击柱子后的详情卡片数据：按科目拆分，再按学习细分方向（章节/知识点/备注）聚合耗时 */
const barDetail = computed(() => {
  const bySubject: Record<string, typeof store.records> = {}
  for (const r of store.records.filter((x) => x.date === barDate.value)) {
    ;(bySubject[r.subjectId] = bySubject[r.subjectId] || []).push(r)
  }
  return Object.entries(bySubject).map(([sid, items]) => {
    const s = store.subjectMap[sid]
    const total = items.reduce((sum, r) => sum + r.minutes, 0)
    const detailMap: Record<string, number> = {}
    for (const r of items) {
      const ch = r.chapterId ? s?.chapters.find((c) => c.id === r.chapterId) : undefined
      const label = ch?.name || r.topic || r.note || '未标注方向'
      detailMap[label] = (detailMap[label] || 0) + r.minutes
    }
    const details = Object.entries(detailMap)
      .map(([label, minutes]) => ({ label, minutes }))
      .sort((a, b) => b.minutes - a.minutes)
    return { sid, total, details }
  })
})

// ---- 学习时长 ----
const {
  el: timeEl,
  status: timeStatus,
  retry: retryTime
} = useChart(
  () => ({
    grid: { left: 44, right: 16, top: 28, bottom: 24 },
    xAxis: {
      type: 'category',
      data: days.value.map((d) => d.slice(5)),
      axisLabel: { color: chartTextColor(), fontSize: 10 }
    },
    yAxis: { type: 'value', name: '分钟', axisLabel: { color: chartTextColor() } },
    series: [
      {
        type: 'bar',
        data: days.value.map((d) => store.minutesByDate[d] || 0),
        itemStyle: { color: chartColor('action'), borderRadius: [4, 4, 0, 0] },
        barMaxWidth: 20,
        cursor: 'pointer'
      }
    ],
    // 悬浮提示：展示当日各科目的总学习时长（替代默认的单系列数值提示）
    tooltip: {
      trigger: 'axis',
      formatter: (ps: any) => {
        const list = Array.isArray(ps) ? ps : [ps]
        const d = days.value[list[0]?.dataIndex ?? 0]
        if (!d) return ''
        const lines = [`${d}`]
        const map = subjectMinutesOn(d)
        const entries = Object.entries(map)
        const focus = focusMinutesOn(store, d)
        if (!entries.length && !focus) {
          lines.push('这天还没有学习记录')
        } else {
          let total = focus
          for (const [sid, minutes] of entries) {
            total += minutes
            const s = store.subjectMap[sid]
            lines.push(`${subjectLabel(s, '已删除科目')}：${formatMinutes(minutes)}`)
          }
          if (focus) lines.push(`番茄专注（未分科目）：${formatMinutes(focus)}`)
          lines.push(`合计：${formatMinutes(total)}`)
        }
        return lines.join('<br>')
      }
    }
  }),
  [days, computed(() => store.minutesByDate)],
  (params) => {
    // 点击任意时间柱子，展示当天所有科目精准学习时长
    if (params.componentType === 'series' && params.seriesType === 'bar' && typeof params.dataIndex === 'number') {
      const d = days.value[params.dataIndex]
      if (d) barDate.value = d
    }
  }
)

// ---- 科目占比 ----
const subjectMinutes = computed(() => {
  const map: Record<string, number> = {}
  for (const r of store.records.filter((r) => days.value.includes(r.date)))
    map[r.subjectId] = (map[r.subjectId] || 0) + r.minutes
  const subjects = store.subjects
    .filter((s) => map[s.id])
    .map((s) => ({ name: s.name, value: map[s.id], itemStyle: { color: s.color } }))
  const focus = days.value.reduce((sum, date) => sum + focusMinutesOn(store, date), 0)
  if (focus) subjects.push({ name: '番茄专注（未分科目）', value: focus, itemStyle: { color: chartColor('muted') } })
  return subjects
})
const {
  el: pieEl,
  status: pieStatus,
  retry: retryPie
} = useChart(
  () => ({
    series: [
      {
        type: 'pie',
        radius: ['45%', '70%'],
        label: { color: chartTextColor(), fontSize: 11, formatter: '{b}\n{d}%' },
        data: subjectMinutes.value
      }
    ],
    tooltip: { trigger: 'item', formatter: (p: any) => `${p.name}：${formatMinutes(p.value)}` }
  }),
  [subjectMinutes]
)

// ---- 正确率趋势 ----
const {
  el: accEl,
  status: accStatus,
  retry: retryAcc
} = useChart(() => {
  const series = store.subjects.map((s) => {
    const sessions = store.problemSessions.filter((p) => p.subjectId === s.id)
    const byDate: Record<string, { t: number; c: number }> = {}
    for (const p of sessions) {
      byDate[p.date] = byDate[p.date] || { t: 0, c: 0 }
      byDate[p.date].t += p.total
      byDate[p.date].c += p.correct
    }
    return {
      name: s.name,
      type: 'line' as const,
      smooth: false,
      data: days.value.map((d) => (byDate[d]?.t ? Math.round((byDate[d].c / byDate[d].t) * 100) : null)),
      connectNulls: false,
      lineStyle: { color: s.color },
      itemStyle: { color: s.color }
    }
  })
  return {
    grid: { left: 40, right: 16, top: 30, bottom: 24 },
    legend: { textStyle: { color: chartTextColor(), fontSize: 10 } },
    xAxis: {
      type: 'category',
      data: days.value.map((d) => d.slice(5)),
      axisLabel: { color: chartTextColor(), fontSize: 10 }
    },
    yAxis: { type: 'value', max: 100, name: '%', axisLabel: { color: chartTextColor() } },
    series,
    tooltip: { trigger: 'axis' }
  }
}, [
  days,
  computed(() => store.problemSessions.map((p) => [p.subjectId, p.date, p.total, p.correct])),
  computed(() => store.subjects.map((s) => [s.id, s.name, s.color]))
])

// ---- 题型分布（动态聚合：兼容数学/英语/通用题型模板与历史数据） ----
const typeStats = computed(() => {
  const t: Record<string, number> = {}
  for (const p of store.problemSessions.filter((p) => days.value.includes(p.date))) {
    for (const [k, v] of Object.entries(p.types || {})) {
      t[k] = (t[k] || 0) + (Number(v) || 0)
    }
  }
  return Object.entries(t)
    .map(([k, v]) => ({ name: PROBLEM_TYPE_LABELS[k] || k, value: v }))
    .filter((x) => x.value > 0)
})
const {
  el: typeEl,
  status: typeStatus,
  retry: retryType
} = useChart(
  () => ({
    grid: { left: 70, right: 30, top: 12, bottom: 24 },
    xAxis: { type: 'value', minInterval: 1, axisLabel: { color: chartTextColor() } },
    yAxis: {
      type: 'category',
      data: typeStats.value.map((item) => item.name),
      axisLabel: { color: chartTextColor(), width: 60, overflow: 'truncate' }
    },
    series: [
      {
        type: 'bar',
        data: typeStats.value.map((item) => item.value),
        barMaxWidth: 16,
        itemStyle: { color: chartColor('action') },
        label: { show: true, position: 'right', color: chartTextColor() }
      }
    ],
    tooltip: { trigger: 'axis' }
  }),
  [typeStats]
)

// ---- 专注分析 ----
const {
  el: pomoEl,
  status: pomoStatus,
  retry: retryPomo
} = useChart(
  () => ({
    grid: { left: 40, right: 40, top: 30, bottom: 24 },
    legend: { textStyle: { color: chartTextColor(), fontSize: 10 } },
    xAxis: {
      type: 'category',
      data: days.value.map((d) => d.slice(5)),
      axisLabel: { color: chartTextColor(), fontSize: 10 }
    },
    yAxis: [
      { type: 'value', name: '番茄数', axisLabel: { color: chartTextColor() } },
      { type: 'value', name: '分钟', axisLabel: { color: chartTextColor() } }
    ],
    series: [
      {
        name: '番茄数',
        type: 'bar',
        data: days.value.map((d) => store.pomodoro.daily[d]?.count || 0),
        itemStyle: { color: chartColor('action'), borderRadius: [4, 4, 0, 0] },
        barMaxWidth: 16
      },
      {
        name: '专注分钟',
        type: 'line',
        yAxisIndex: 1,
        smooth: false,
        data: days.value.map((d) => store.pomodoro.daily[d]?.minutes || 0),
        lineStyle: { color: chartColor('muted') },
        itemStyle: { color: chartColor('muted') }
      }
    ],
    tooltip: { trigger: 'axis' }
  }),
  [days, computed(() => days.value.map((d) => [store.pomodoro.daily[d]?.count, store.pomodoro.daily[d]?.minutes]))]
)

// ---- 这段时间的心情 ----
const {
  el: moodEl,
  status: moodStatus,
  retry: retryMood
} = useChart(() => {
  const moodScore: Record<string, number> = {}
  MOODS.forEach((m, i) => (moodScore[m] = MOODS.length - i))
  const data = days.value.map((d) => {
    const s = store.summaries[d]
    return s?.mood ? moodScore[s.mood] : null
  })
  const labels = days.value.map((d) => store.summaries[d]?.mood || '')
  return {
    grid: { left: 40, right: 16, top: 20, bottom: 24 },
    xAxis: {
      type: 'category',
      data: days.value.map((d) => d.slice(5)),
      axisLabel: { color: chartTextColor(), fontSize: 10 }
    },
    yAxis: { type: 'value', min: 0, max: MOODS.length, axisLabel: { show: false } },
    series: [
      {
        type: 'line',
        smooth: false,
        data,
        connectNulls: false,
        lineStyle: { color: chartColor('muted') },
        itemStyle: { color: chartColor('muted') },
        label: {
          show: true,
          fontSize: 9,
          color: chartTextColor(),
          formatter: (p: any) => labels[p.dataIndex].split(' ')[0] || ''
        }
      }
    ],
    tooltip: {
      trigger: 'axis',
      formatter: (p: any) => `${days.value[p[0].dataIndex]}<br>心情：${labels[p[0].dataIndex] || '未记录'}`
    }
  }
}, [days, computed(() => days.value.map((d) => store.summaries[d]?.mood))])

// ---- 周报 ----
const report = computed(() => {
  const weekDays = days.value
  const min = weekDays.reduce((s, d) => s + (store.minutesByDate[d] || 0), 0)
  const problems = store.problemSessions.filter((p) => weekDays.includes(p.date))
  const pTotal = problems.reduce((s, p) => s + p.total, 0)
  const pCorrect = problems.reduce((s, p) => s + p.correct, 0)
  const pomo = weekDays.reduce((s, d) => s + (store.pomodoro.daily[d]?.count || 0), 0)
  const studyDays = weekDays.filter((d) => (store.minutesByDate[d] || 0) > 0).length
  const points = store.gamification.pointsLog.filter((l) => weekDays.includes(l.date)).reduce((s, l) => s + l.points, 0)
  return { min, pTotal, acc: pTotal ? Math.round((pCorrect / pTotal) * 100) : null, pomo, studyDays, points }
})
</script>

<template>
  <div class="study-page space-y-4">
    <div class="study-page-heading">
      <div>
        <h1 class="page-title">学习统计</h1>
        <p class="page-description">回看投入的时间、做题情况与专注记录，调整下一步计划。</p>
      </div>
      <div class="flex gap-1 bg-slate-100 dark:bg-slate-800 rounded-lg p-1">
        <button
          class="btn !py-1 !text-xs"
          :class="range === 7 ? 'bg-action-soft text-action' : ''"
          :aria-pressed="range === 7"
          @click="range = 7"
        >
          近7天
        </button>
        <button
          class="btn !py-1 !text-xs"
          :class="range === 30 ? 'bg-action-soft text-action' : ''"
          :aria-pressed="range === 30"
          @click="range = 30"
        >
          近30天
        </button>
      </div>
    </div>

    <!-- 汇总和图表使用同一段滚动日期范围。 -->
    <div class="card">
      <div class="text-sm font-semibold mb-2">近 {{ range }} 天学习回看</div>
      <div class="grid grid-cols-3 sm:grid-cols-6 gap-2 text-center">
        <div>
          <div class="text-lg font-bold">{{ formatMinutes(report.min) }}</div>
          <div class="text-xs text-muted">总时长</div>
        </div>
        <div>
          <div class="text-lg font-bold">{{ report.studyDays }}/{{ range }}</div>
          <div class="text-xs text-muted">学习天数</div>
        </div>
        <div>
          <div class="text-lg font-bold">{{ report.pTotal }}</div>
          <div class="text-xs text-muted">刷题</div>
        </div>
        <div>
          <div class="text-lg font-bold">{{ report.acc === null ? '—' : report.acc + '%' }}</div>
          <div class="text-xs text-muted">正确率</div>
        </div>
        <div>
          <div class="text-lg font-bold">{{ report.pomo }}</div>
          <div class="text-xs text-muted">番茄钟</div>
        </div>
        <div>
          <div class="text-lg font-bold">{{ report.points > 0 ? '+' : '' }}{{ report.points }}</div>
          <div class="text-xs text-muted">积分</div>
        </div>
      </div>
      <p class="study-note mt-3">
        {{ days[0] }} 至 {{ store.todayKey }} · 正确率按答对题数 ÷ 总题数计算，未做题显示 —。
      </p>
    </div>

    <div class="card">
      <div class="section-title">每天学了多久 · 近 {{ range }} 天</div>
      <ChartFallback v-if="timeStatus === 'error'" class="h-60" @retry="retryTime" />
      <div v-else ref="timeEl" class="h-60"></div>
      <p class="text-[10px] text-slate-400 mt-2">点击柱子查看科目明细，也可用下方日期入口查看。</p>
    </div>

    <div class="grid md:grid-cols-2 gap-4">
      <div class="card">
        <div class="section-title">时间分给了哪些科目</div>
        <ChartFallback v-if="pieStatus === 'error'" class="h-56" @retry="retryPie" />
        <div v-else-if="subjectMinutes.length" ref="pieEl" class="h-56"></div>
        <EmptyState v-else title="这段时间还没有学习记录" description="在科目页记录一次学习，再回来查看时间分配。" />
      </div>
      <div class="card">
        <div class="section-title">做过哪些题型 · 近 {{ range }} 天</div>
        <ChartFallback v-if="typeStatus === 'error'" class="h-56" @retry="retryType" />
        <div v-else-if="typeStats.length" ref="typeEl" class="h-56"></div>
        <EmptyState v-else title="这段时间还没有题型记录" description="记录刷题时填写题型数量，就能看到这里的分布。" />
      </div>
    </div>

    <div class="card">
      <div class="section-title">正确率有变化吗</div>
      <ChartFallback v-if="accStatus === 'error'" class="h-56" @retry="retryAcc" />
      <div v-else ref="accEl" class="h-56"></div>
      <p class="study-note">只连接连续有记录的日期。空缺表示未记录，不是答错。</p>
    </div>

    <div class="card">
      <div class="section-title">番茄钟次数与用时</div>
      <ChartFallback v-if="pomoStatus === 'error'" class="h-56" @retry="retryPomo" />
      <div v-else ref="pomoEl" class="h-56"></div>
    </div>

    <div class="card">
      <div class="section-title">这段时间的心情</div>
      <ChartFallback v-if="moodStatus === 'error'" class="h-48" @retry="retryMood" />
      <div v-else ref="moodEl" class="h-48"></div>
      <p class="study-note">按你填写的心情展示，不用于评价学习能力。</p>
    </div>

    <section class="card" aria-labelledby="statistics-dates">
      <div class="study-section-heading flex-wrap">
        <h2 id="statistics-dates" class="section-title !mb-0">按日期查记录</h2>
        <label class="flex items-center gap-2 text-xs text-muted"
          >其他日期<input
            type="date"
            class="input !w-auto"
            aria-label="查看任意日期的学习记录"
            :max="store.todayKey"
            @change="barDate = ($event.target as HTMLInputElement).value"
        /></label>
      </div>
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <button
          v-for="date in days.slice().reverse()"
          :key="date"
          class="btn-ghost justify-between text-xs"
          @click="barDate = date"
        >
          <span>{{ date.slice(5) }}</span
          ><span>{{ formatMinutes(store.minutesByDate[date] || 0) }}</span>
        </button>
      </div>
    </section>

    <!-- 柱状图点击：当日各科目学习细分耗时详情卡片 -->
    <Modal :title="`${barDate} 学习时长细分详情`" :show="!!barDate" @close="barDate = ''">
      <div v-if="!barDetail.length && !focusMinutesOn(store, barDate)" class="text-xs text-slate-400 text-center py-4">
        这天还没有学习记录
      </div>
      <div v-else class="space-y-3">
        <div
          v-for="item in barDetail"
          :key="item.sid"
          class="border border-slate-100 dark:border-slate-700 rounded-xl p-3"
        >
          <div class="flex items-center gap-2 text-sm">
            <span
              class="w-2.5 h-2.5 rounded-full shrink-0"
              :style="{ background: store.subjectMap[item.sid]?.color || '#94a3b8' }"
            ></span>
            <span class="flex-1 font-semibold">{{ subjectLabel(store.subjectMap[item.sid], '已删除科目') }}</span>
            <span class="font-bold" :style="{ color: store.subjectMap[item.sid]?.color || '#94a3b8' }">{{
              formatMinutes(item.total)
            }}</span>
          </div>
          <div class="mt-2 space-y-1">
            <div v-for="d in item.details" :key="d.label" class="flex items-center gap-2 text-xs pl-4">
              <span class="flex-1 text-slate-500 dark:text-slate-400 truncate">{{ d.label }}</span>
              <span class="font-medium tabular-nums shrink-0">{{ formatMinutes(d.minutes) }}</span>
            </div>
          </div>
        </div>
      </div>
      <div v-if="focusMinutesOn(store, barDate)" class="mt-3 rounded-xl border border-line p-3 text-sm">
        <div class="flex justify-between gap-2">
          <span class="font-semibold">番茄专注（未分科目）</span>
          <span class="font-bold">{{ formatMinutes(focusMinutesOn(store, barDate)) }}</span>
        </div>
        <p class="mt-1 text-xs text-muted">已计入当日学习总时长，包含提前结束后保存的专注。</p>
      </div>
    </Modal>
  </div>
</template>
