<script setup lang="ts">
import { computed, inject, ref } from 'vue'
import { useAppStore } from '../stores/app'
import { today, formatMinutes } from '../utils/date'
import { DEFAULT_QUOTES } from '../data/defaults'
import Heatmap from '../components/Heatmap.vue'
import ProgressRing from '../components/ProgressRing.vue'

const store = useAppStore()
const toast = inject<(m: string) => void>('toast', () => {})

const quote = computed(() => {
  const list = store.settings.quotes.length ? store.settings.quotes : DEFAULT_QUOTES
  const idx = Math.floor(Date.now() / 86400000) % list.length
  return list[idx]
})

const todayDoneTodos = computed(() => store.todayTodos.filter(t => t.done).length)

function subjectPercent(subjectId: string) {
  const s = store.subjectMap[subjectId]
  if (!s) return 0
  const topics = s.chapters.flatMap(c => c.topics)
  if (!topics.length) {
    // 无章节时用学习记录天数衡量
    const days = new Set(store.records.filter(r => r.subjectId === subjectId).map(r => r.date)).size
    return Math.min(100, days * 5)
  }
  const sum = topics.reduce((acc, t) => acc + (s.mastery[t] || 0), 0)
  return (sum / (topics.length * 5)) * 100
}

const newTodo = ref('')
function addTodo() {
  if (!newTodo.value.trim()) return
  store.addTodo(newTodo.value.trim())
  newTodo.value = ''
  toast('已添加待办')
}

const goalPercent = computed(() => Math.min(100, (store.todayMinutes / store.settings.dailyGoalMinutes) * 100))
</script>

<template>
  <div class="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
    <!-- 头部 -->
    <div class="flex items-center justify-between">
      <div>
        <h1 class="page-title">你好，{{ store.settings.userName }} 👋</h1>
        <p class="text-xs text-slate-400 mt-0.5">{{ today() }} · 连续学习 🔥{{ store.gamification.streak }} 天</p>
      </div>
      <div class="text-right">
        <div class="text-xs text-slate-400">{{ store.level.name }}学者</div>
        <div class="text-sm font-bold text-primary-500">{{ store.gamification.points }} 积分</div>
      </div>
    </div>

    <!-- 倒计时 + 名言 -->
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <div class="card bg-gradient-to-br from-primary-500 to-indigo-600 !text-white border-0">
        <div class="text-xs opacity-80">🎯 距离专升本考试</div>
        <div v-if="store.examCountdown !== null" class="mt-1">
          <span class="text-4xl font-black">{{ store.examCountdown }}</span><span class="ml-1">天</span>
        </div>
        <RouterLink v-else to="/settings" class="text-sm underline opacity-90 mt-2 inline-block">去设置考试日期 →</RouterLink>
        <div class="text-xs opacity-80 mt-2">坚持到底，就是胜利！</div>
      </div>
      <div class="card flex flex-col justify-center">
        <div class="text-xs text-slate-400 mb-1">📜 今日名言</div>
        <p class="text-sm font-medium leading-relaxed">{{ quote }}</p>
      </div>
    </div>

    <!-- 今日概览 -->
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <div class="card !p-3 text-center">
        <div class="text-2xl font-black text-primary-500">{{ formatMinutes(store.todayMinutes) }}</div>
        <div class="text-[11px] text-slate-400 mt-0.5">今日学习时长</div>
        <div class="w-full h-1.5 bg-slate-100 dark:bg-slate-700 rounded-full mt-2 overflow-hidden">
          <div class="h-full bg-primary-400 rounded-full transition-all duration-700" :style="{ width: goalPercent + '%' }"></div>
        </div>
        <div class="text-[10px] text-slate-400 mt-1">目标 {{ formatMinutes(store.settings.dailyGoalMinutes) }}</div>
      </div>
      <div class="card !p-3 text-center">
        <div class="text-2xl font-black text-emerald-500">{{ todayDoneTodos }}/{{ store.todayTodos.length }}</div>
        <div class="text-[11px] text-slate-400 mt-0.5">今日待办完成</div>
      </div>
      <div class="card !p-3 text-center">
        <div class="text-2xl font-black text-orange-500">{{ store.todayPomodoro.count }}</div>
        <div class="text-[11px] text-slate-400 mt-0.5">今日番茄钟</div>
      </div>
      <div class="card !p-3 text-center">
        <div class="text-2xl font-black text-purple-500">{{ store.gamification.streak }}</div>
        <div class="text-[11px] text-slate-400 mt-0.5">连续学习天数</div>
      </div>
    </div>

    <!-- 待办 + 进度环 -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div class="card">
        <div class="section-title">📋 今日待办</div>
        <div class="flex gap-2 mb-3">
          <input v-model="newTodo" class="input" placeholder="添加今日学习任务，回车确认" @keyup.enter="addTodo" />
          <button class="btn-primary shrink-0" @click="addTodo">添加</button>
        </div>
        <div v-if="!store.todayTodos.length" class="text-xs text-slate-400 py-4 text-center">暂无待办，添加一个吧～</div>
        <TransitionGroup tag="div" class="space-y-1.5">
          <div v-for="t in store.todayTodos" :key="t.id"
            class="flex items-center gap-2 rounded-lg px-2 py-1.5 group hover:bg-slate-50 dark:hover:bg-slate-700/50">
            <input type="checkbox" :checked="t.done" class="w-4 h-4 accent-primary-500" @change="store.toggleTodo(t.id)" />
            <span class="flex-1 text-sm" :class="t.done ? 'line-through text-slate-400' : ''">{{ t.text }}</span>
            <button class="opacity-0 group-hover:opacity-100 text-xs text-slate-400" title="上移" @click="store.moveTodo(t.id, -1)">↑</button>
            <button class="opacity-0 group-hover:opacity-100 text-xs text-slate-400" title="下移" @click="store.moveTodo(t.id, 1)">↓</button>
            <button class="opacity-0 group-hover:opacity-100 text-xs text-red-400" title="删除" @click="store.deleteTodo(t.id)">×</button>
          </div>
        </TransitionGroup>
      </div>

      <div class="card">
        <div class="section-title">⭕ 科目掌握进度</div>
        <div class="flex flex-wrap gap-4 justify-center py-2">
          <RouterLink v-for="s in store.subjects" :key="s.id"
            :to="s.id === 'math' ? '/math' : s.id === 'english' ? '/english' : `/subject/${s.id}`"
            class="flex flex-col items-center gap-1">
            <ProgressRing :percent="subjectPercent(s.id)" :color="s.color" :size="76" :label="s.name" />
            <span class="text-xs">{{ s.icon }} {{ s.name }}</span>
          </RouterLink>
        </div>
      </div>
    </div>

    <!-- 热力图 -->
    <div class="card">
      <div class="section-title">🔥 学习热力图（近 {{ 20 }} 周）</div>
      <Heatmap :data="store.minutesByDate" />
    </div>

    <!-- 快捷入口 -->
    <div class="grid grid-cols-4 sm:grid-cols-8 gap-2">
      <RouterLink v-for="q in [
        { to: '/pomodoro', icon: '🍅', label: '专注' }, { to: '/daily-summary', icon: '📝', label: '总结' },
        { to: '/error-book', icon: '📕', label: '错题' }, { to: '/habits', icon: '✅', label: '习惯' },
        { to: '/statistics', icon: '📊', label: '统计' }, { to: '/rewards', icon: '🏆', label: '成就' },
        { to: '/materials', icon: '📚', label: '资料' }, { to: '/settings', icon: '⚙️', label: '设置' }
      ]" :key="q.to" :to="q.to" class="card !p-3 flex flex-col items-center gap-1 hover:shadow-md transition-shadow">
        <span class="text-xl">{{ q.icon }}</span>
        <span class="text-[11px] text-slate-500 dark:text-slate-400">{{ q.label }}</span>
      </RouterLink>
    </div>
  </div>
</template>
