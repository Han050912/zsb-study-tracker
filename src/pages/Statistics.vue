<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useAppStore } from '../stores/app'
import { useChart, chartTextColor } from '../composables/useChart'
import { formatMinutes } from '../utils/date'
import { subjectLabel } from '../utils/subject'
import { MOODS } from '../data/defaults'
import { PROBLEM_TYPE_LABELS } from '../data/problemTypes'
import Modal from '../components/Modal.vue'
import dayjs from 'dayjs'

const store = useAppStore()
const range = ref<7 | 30>(7)

const days = computed(() => Array.from({ length: range.value }, (_, i) =>
  dayjs().subtract(range.value - 1 - i, 'day').format('YYYY-MM-DD')))

// ---- 柱状图点击：当日各科目学习时长细分详情 ----
const barDate = ref('')
// 切换时间范围时关闭弹窗，避免展示范围外日期
watch(range, () => { barDate.value = '' })

/** 指定日期各科目总学习时长（hover 提示与点击详情共用口径） */
function subjectMinutesOn(date: string) {
  const map: Record<string, number> = {}
  for (const r of store.records.filter(x => x.date === date)) {
    map[r.subjectId] = (map[r.subjectId] || 0) + r.minutes
  }
  return map
}

/** 点击柱子后的详情卡片数据：按科目拆分，再按学习细分方向（章节/知识点/备注）聚合耗时 */
const barDetail = computed(() => {
  const bySubject: Record<string, typeof store.records> = {}
  for (const r of store.records.filter(x => x.date === barDate.value)) {
    ;(bySubject[r.subjectId] = bySubject[r.subjectId] || []).push(r)
  }
  return Object.entries(bySubject).map(([sid, items]) => {
    const s = store.subjectMap[sid]
    const total = items.reduce((sum, r) => sum + r.minutes, 0)
    const detailMap: Record<string, number> = {}
    for (const r of items) {
      const ch = r.chapterId ? s?.chapters.find(c => c.id === r.chapterId) : undefined
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
const { el: timeEl } = useChart(() => ({
  grid: { left: 44, right: 16, top: 28, bottom: 24 },
  xAxis: { type: 'category', data: days.value.map(d => d.slice(5)), axisLabel: { color: chartTextColor(), fontSize: 10 } },
  yAxis: { type: 'value', name: '分钟', axisLabel: { color: chartTextColor() } },
  series: [
    { type: 'bar', data: days.value.map(d => store.minutesByDate[d] || 0), itemStyle: { color: '#3b82f6', borderRadius: [4, 4, 0, 0] }, barMaxWidth: 20, cursor: 'pointer' },
    { type: 'line', smooth: true, data: days.value.map(d => store.minutesByDate[d] || 0), lineStyle: { color: '#93c5fd' }, itemStyle: { color: '#93c5fd' }, cursor: 'pointer' }
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
      if (!entries.length) {
        lines.push('当日暂无学习记录')
      } else {
        let total = 0
        for (const [sid, minutes] of entries) {
          total += minutes
          const s = store.subjectMap[sid]
          lines.push(`${subjectLabel(s, '已删除科目')}：${formatMinutes(minutes)}`)
        }
        lines.push(`合计：${formatMinutes(total)}`)
      }
      return lines.join('<br>')
    }
  }
}), [days], (params) => {
  // 点击任意时间柱子，展示当天所有科目精准学习时长
  // 折线 series 覆盖在柱子上方，两种 seriesType 均接受（dataIndex→日期映射一致）
  if (params.componentType === 'series' && (params.seriesType === 'bar' || params.seriesType === 'line') && typeof params.dataIndex === 'number') {
    const d = days.value[params.dataIndex]
    if (d) barDate.value = d
  }
})

// ---- 科目占比 ----
const subjectMinutes = computed(() => {
  const map: Record<string, number> = {}
  for (const r of store.records) map[r.subjectId] = (map[r.subjectId] || 0) + r.minutes
  return store.subjects.filter(s => map[s.id]).map(s => ({ name: s.name, value: map[s.id], itemStyle: { color: s.color } }))
})
const { el: pieEl } = useChart(() => ({
  series: [{
    type: 'pie', radius: ['45%', '70%'],
    label: { color: chartTextColor(), fontSize: 11, formatter: '{b}\n{d}%' },
    data: subjectMinutes.value
  }],
  tooltip: { trigger: 'item', formatter: (p: any) => `${p.name}：${formatMinutes(p.value)}` }
}), [subjectMinutes])

// ---- 正确率趋势 ----
const { el: accEl } = useChart(() => {
  const series = store.subjects.map(s => {
    const sessions = store.problemSessions.filter(p => p.subjectId === s.id)
    const byDate: Record<string, { t: number; c: number }> = {}
    for (const p of sessions) {
      byDate[p.date] = byDate[p.date] || { t: 0, c: 0 }
      byDate[p.date].t += p.total; byDate[p.date].c += p.correct
    }
    return {
      name: s.name, type: 'line' as const, smooth: true,
      data: days.value.map(d => byDate[d] ? Math.round(byDate[d].c / byDate[d].t * 100) : null),
      connectNulls: true, lineStyle: { color: s.color }, itemStyle: { color: s.color }
    }
  })
  return {
    grid: { left: 40, right: 16, top: 30, bottom: 24 },
    legend: { textStyle: { color: chartTextColor(), fontSize: 10 } },
    xAxis: { type: 'category', data: days.value.map(d => d.slice(5)), axisLabel: { color: chartTextColor(), fontSize: 10 } },
    yAxis: { type: 'value', max: 100, name: '%', axisLabel: { color: chartTextColor() } },
    series,
    tooltip: { trigger: 'axis' }
  }
}, [days])

// ---- 题型分布（动态聚合：兼容数学/英语/通用题型模板与历史数据） ----
const typeStats = computed(() => {
  const t: Record<string, number> = {}
  for (const p of store.problemSessions) {
    for (const [k, v] of Object.entries(p.types || {})) {
      t[k] = (t[k] || 0) + (Number(v) || 0)
    }
  }
  return Object.entries(t)
    .map(([k, v]) => ({ name: PROBLEM_TYPE_LABELS[k] || k, value: v }))
    .filter(x => x.value > 0)
})
const { el: typeEl } = useChart(() => ({
  series: [{ type: 'pie', radius: '60%', label: { color: chartTextColor(), fontSize: 11 }, data: typeStats.value,
    itemStyle: { color: (p: any) => ['#3b82f6', '#10b981', '#f59e0b', '#a855f7', '#ef4444', '#06b6d4', '#f97316', '#ec4899', '#6366f1', '#84cc16', '#14b8a6'][p.dataIndex] } }],
  tooltip: { trigger: 'item' }
}), [typeStats])

// ---- 专注分析 ----
const { el: pomoEl } = useChart(() => ({
  grid: { left: 40, right: 40, top: 30, bottom: 24 },
  legend: { textStyle: { color: chartTextColor(), fontSize: 10 } },
  xAxis: { type: 'category', data: days.value.map(d => d.slice(5)), axisLabel: { color: chartTextColor(), fontSize: 10 } },
  yAxis: [
    { type: 'value', name: '番茄数', axisLabel: { color: chartTextColor() } },
    { type: 'value', name: '分钟', axisLabel: { color: chartTextColor() } }
  ],
  series: [
    { name: '番茄数', type: 'bar', data: days.value.map(d => store.pomodoro.daily[d]?.count || 0), itemStyle: { color: '#f97316', borderRadius: [4, 4, 0, 0] }, barMaxWidth: 16 },
    { name: '专注分钟', type: 'line', yAxisIndex: 1, smooth: true, data: days.value.map(d => store.pomodoro.daily[d]?.minutes || 0), lineStyle: { color: '#fdba74' }, itemStyle: { color: '#fdba74' } }
  ],
  tooltip: { trigger: 'axis' }
}), [days])

// ---- 情绪曲线 ----
const { el: moodEl } = useChart(() => {
  const moodScore: Record<string, number> = {}
  MOODS.forEach((m, i) => moodScore[m] = MOODS.length - i)
  const data = days.value.map(d => {
    const s = store.summaries[d]
    return s?.mood ? moodScore[s.mood] : null
  })
  const labels = days.value.map(d => store.summaries[d]?.mood || '')
  return {
    grid: { left: 40, right: 16, top: 20, bottom: 24 },
    xAxis: { type: 'category', data: days.value.map(d => d.slice(5)), axisLabel: { color: chartTextColor(), fontSize: 10 } },
    yAxis: { type: 'value', min: 0, max: MOODS.length, axisLabel: { show: false } },
    series: [{
      type: 'line', smooth: true, data, connectNulls: true,
      lineStyle: { color: '#ec4899' }, itemStyle: { color: '#ec4899' },
      label: { show: true, fontSize: 9, color: chartTextColor(), formatter: (p: any) => labels[p.dataIndex].split(' ')[0] || '' }
    }],
    tooltip: { trigger: 'axis', formatter: (p: any) => `${days.value[p[0].dataIndex]}<br>心情：${labels[p[0].dataIndex] || '未记录'}` }
  }
}, [days])

// ---- 周报 ----
const report = computed(() => {
  const weekDays = Array.from({ length: 7 }, (_, i) => dayjs().subtract(6 - i, 'day').format('YYYY-MM-DD'))
  const min = weekDays.reduce((s, d) => s + (store.minutesByDate[d] || 0), 0)
  const problems = store.problemSessions.filter(p => weekDays.includes(p.date))
  const pTotal = problems.reduce((s, p) => s + p.total, 0)
  const pCorrect = problems.reduce((s, p) => s + p.correct, 0)
  const pomo = weekDays.reduce((s, d) => s + (store.pomodoro.daily[d]?.count || 0), 0)
  const studyDays = weekDays.filter(d => (store.minutesByDate[d] || 0) > 0).length
  const points = store.gamification.pointsLog.filter(l => weekDays.includes(l.date)).reduce((s, l) => s + l.points, 0)
  return { min, pTotal, acc: pTotal ? Math.round(pCorrect / pTotal * 100) : null, pomo, studyDays, points }
})
</script>

<template>
  <div class="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
    <div class="flex items-center justify-between">
      <h1 class="page-title">数据统计中心</h1>
      <div class="flex gap-1 bg-slate-100 dark:bg-slate-800 rounded-lg p-1">
        <button class="btn !py-1 !text-xs" :class="range === 7 ? 'bg-white dark:bg-slate-700 shadow-sm' : ''" @click="range = 7">近7天</button>
        <button class="btn !py-1 !text-xs" :class="range === 30 ? 'bg-white dark:bg-slate-700 shadow-sm' : ''" @click="range = 30">近30天</button>
      </div>
    </div>

    <!-- 周报卡片 -->
    <div class="card bg-gradient-to-r from-primary-500 to-indigo-600 !text-white border-0">
      <div class="text-sm font-semibold mb-2">本周学习报告</div>
      <div class="grid grid-cols-3 sm:grid-cols-6 gap-2 text-center">
        <div><div class="text-lg font-black">{{ formatMinutes(report.min) }}</div><div class="text-[10px] opacity-80">总时长</div></div>
        <div><div class="text-lg font-black">{{ report.studyDays }}/7</div><div class="text-[10px] opacity-80">学习天数</div></div>
        <div><div class="text-lg font-black">{{ report.pTotal }}</div><div class="text-[10px] opacity-80">刷题</div></div>
        <div><div class="text-lg font-black">{{ report.acc === null ? '—' : report.acc + '%' }}</div><div class="text-[10px] opacity-80">正确率</div></div>
        <div><div class="text-lg font-black">{{ report.pomo }}</div><div class="text-[10px] opacity-80">番茄钟</div></div>
        <div><div class="text-lg font-black">+{{ report.points }}</div><div class="text-[10px] opacity-80">积分</div></div>
      </div>
      <p class="text-xs opacity-80 mt-2">截图即可保存本周报告</p>
    </div>

    <div class="card">
      <div class="section-title">⏱ 学习时长（近{{ range }}天）</div>
      <div ref="timeEl" class="h-60"></div>
      <p class="text-[10px] text-slate-400 mt-2">悬浮查看当日各科目总学习时长，点击柱子查看科目细分耗时详情</p>
    </div>

    <div class="grid md:grid-cols-2 gap-4">
      <div class="card">
        <div class="section-title">科目时长占比</div>
        <div v-if="subjectMinutes.length" ref="pieEl" class="h-56"></div>
        <div v-else class="text-xs text-slate-400 text-center py-10">暂无数据</div>
      </div>
      <div class="card">
        <div class="section-title">题型分布（累计 {{ store.totalProblems }} 题）</div>
        <div v-if="typeStats.length" ref="typeEl" class="h-56"></div>
        <div v-else class="text-xs text-slate-400 text-center py-10">暂无数据</div>
      </div>
    </div>

    <div class="card">
      <div class="section-title">各科目正确率趋势</div>
      <div ref="accEl" class="h-56"></div>
    </div>

    <div class="card">
      <div class="section-title">专注力分析</div>
      <div ref="pomoEl" class="h-56"></div>
    </div>

    <div class="card">
      <div class="section-title">情绪曲线</div>
      <div ref="moodEl" class="h-48"></div>
    </div>

    <!-- 柱状图点击：当日各科目学习细分耗时详情卡片 -->
    <Modal :title="`${barDate} 学习时长细分详情`" :show="!!barDate" @close="barDate = ''">
      <div v-if="!barDetail.length" class="text-xs text-slate-400 text-center py-4">当日暂无学习记录</div>
      <div v-else class="space-y-3">
        <div v-for="item in barDetail" :key="item.sid" class="border border-slate-100 dark:border-slate-700 rounded-xl p-3">
          <div class="flex items-center gap-2 text-sm">
            <span class="w-2.5 h-2.5 rounded-full shrink-0" :style="{ background: store.subjectMap[item.sid]?.color || '#94a3b8' }"></span>
            <span class="flex-1 font-semibold">{{ subjectLabel(store.subjectMap[item.sid], '已删除科目') }}</span>
            <span class="font-bold" :style="{ color: store.subjectMap[item.sid]?.color || '#94a3b8' }">{{ formatMinutes(item.total) }}</span>
          </div>
          <div class="mt-2 space-y-1">
            <div v-for="d in item.details" :key="d.label" class="flex items-center gap-2 text-xs pl-4">
              <span class="flex-1 text-slate-500 dark:text-slate-400 truncate">{{ d.label }}</span>
              <span class="font-medium tabular-nums shrink-0">{{ formatMinutes(d.minutes) }}</span>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  </div>
</template>
