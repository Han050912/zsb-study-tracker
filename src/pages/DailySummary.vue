<script setup lang="ts">
import { computed, inject, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAppStore } from '../stores/app'
import { today, formatMinutes } from '../utils/date'
import { MOODS } from '../data/defaults'
import dayjs from 'dayjs'

const store = useAppStore()
const route = useRoute()
const router = useRouter()
const toast = inject<(m: string) => void>('toast', () => {})

const viewDate = computed(() => (route.params.date as string) || today())
const isToday = computed(() => viewDate.value === today())

const form = ref({ mood: '', harvest: '', improve: '', plan: '' })
watch(viewDate, (d) => {
  const s = store.summaries[d]
  form.value = s ? { mood: s.mood, harvest: s.harvest, improve: s.improve, plan: s.plan } : { mood: '', harvest: '', improve: '', plan: '' }
}, { immediate: true })

// ---- 当日数据聚合 ----
const dayData = computed(() => {
  const d = viewDate.value
  const records = store.records.filter(r => r.date === d)
  const minutes = records.reduce((s, r) => s + r.minutes, 0)
  const problems = store.problemSessions.filter(p => p.date === d)
  const pTotal = problems.reduce((s, p) => s + p.total, 0)
  const pCorrect = problems.reduce((s, p) => s + p.correct, 0)
  const pomo = store.pomodoro.daily[d] || { count: 0, minutes: 0, interruptions: 0 }
  const bySubject: Record<string, number> = {}
  for (const r of records) bySubject[r.subjectId] = (bySubject[r.subjectId] || 0) + r.minutes
  return { minutes, pTotal, pCorrect, pomo, bySubject, accuracy: pTotal ? Math.round(pCorrect / pTotal * 100) : null }
})

function save() {
  const isNew = !store.summaries[viewDate.value]
  store.saveSummary({ date: viewDate.value, ...form.value })
  toast('每日总结已保存' + (isToday.value && isNew ? ' +5 积分' : ''))
}

// ---- 日历 ----
const calMonth = ref(dayjs(viewDate.value).format('YYYY-MM'))
const calendarDays = computed(() => {
  const start = dayjs(calMonth.value + '-01')
  const firstWeekday = start.day()
  const daysInMonth = start.daysInMonth()
  const cells: (string | null)[] = Array(firstWeekday).fill(null)
  for (let i = 1; i <= daysInMonth; i++) cells.push(start.date(i).format('YYYY-MM-DD'))
  return cells
})
function hasSummary(d: string | null) {
  if (!d) return false
  const s = store.summaries[d]
  return !!(s && (s.harvest || s.improve || s.plan || s.mood))
}
function hasRecord(d: string | null) {
  return d ? !!store.minutesByDate[d] : false
}

// ---- 分享卡片 ----
const showShare = ref(false)
function openShare() {
  save()
  showShare.value = true
}
</script>

<template>
  <div class="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
    <div class="flex items-center justify-between">
      <h1 class="page-title">📝 每日总结</h1>
      <button class="btn-primary" @click="openShare">🎨 生成分享卡片</button>
    </div>

    <div class="grid lg:grid-cols-3 gap-4">
      <!-- 编辑区 -->
      <div class="lg:col-span-2 space-y-4">
        <div class="card">
          <div class="flex items-center justify-between mb-3">
            <div class="section-title !mb-0">{{ isToday ? '今日' : viewDate }} 数据概览</div>
            <input type="date" class="input !w-auto !py-1 text-xs" :value="viewDate"
              @change="router.push(`/daily-summary/${($event.target as HTMLInputElement).value}`)" />
          </div>
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
            <div class="bg-slate-50 dark:bg-slate-700/50 rounded-xl p-2">
              <div class="font-black text-primary-500">{{ formatMinutes(dayData.minutes) }}</div>
              <div class="text-[10px] text-slate-400">学习时长</div>
            </div>
            <div class="bg-slate-50 dark:bg-slate-700/50 rounded-xl p-2">
              <div class="font-black text-emerald-500">{{ dayData.pTotal }}</div>
              <div class="text-[10px] text-slate-400">刷题数</div>
            </div>
            <div class="bg-slate-50 dark:bg-slate-700/50 rounded-xl p-2">
              <div class="font-black text-amber-500">{{ dayData.accuracy === null ? '—' : dayData.accuracy + '%' }}</div>
              <div class="text-[10px] text-slate-400">正确率</div>
            </div>
            <div class="bg-slate-50 dark:bg-slate-700/50 rounded-xl p-2">
              <div class="font-black text-orange-500">{{ dayData.pomo.count }}</div>
              <div class="text-[10px] text-slate-400">番茄钟</div>
            </div>
          </div>
          <div v-if="Object.keys(dayData.bySubject).length" class="flex gap-2 mt-3 flex-wrap">
            <span v-for="(min, sid) in dayData.bySubject" :key="sid" class="text-xs px-2 py-1 rounded-full text-white"
              :style="{ background: store.subjectMap[sid]?.color || '#94a3b8' }">
              {{ store.subjectMap[sid]?.name }} {{ formatMinutes(min) }}
            </span>
          </div>
        </div>

        <div class="card space-y-4">
          <div>
            <label class="label">😊 今日心情</label>
            <div class="grid grid-cols-4 sm:grid-cols-8 gap-1.5">
              <button v-for="m in MOODS" :key="m" class="btn !text-xs !px-1"
                :class="form.mood === m ? 'bg-primary-500 text-white' : 'bg-slate-100 dark:bg-slate-700'"
                @click="form.mood = m">{{ m }}</button>
            </div>
          </div>
          <div>
            <label class="label">🌱 今日收获</label>
            <textarea v-model="form.harvest" rows="3" class="input" placeholder="今天学到了什么？有什么进步？"></textarea>
          </div>
          <div>
            <label class="label">🪞 不足反思</label>
            <textarea v-model="form.improve" rows="3" class="input" placeholder="哪里做得不够好？如何改进？"></textarea>
          </div>
          <div>
            <label class="label">🎯 明日计划</label>
            <textarea v-model="form.plan" rows="3" class="input" placeholder="明天要完成什么？"></textarea>
          </div>
          <button class="btn-primary w-full" @click="save">保存总结</button>
        </div>
      </div>

      <!-- 历史日历 -->
      <div class="card h-fit">
        <div class="flex items-center justify-between mb-3">
          <button class="btn-ghost !p-1.5" @click="calMonth = dayjs(calMonth).subtract(1, 'month').format('YYYY-MM')">←</button>
          <span class="text-sm font-semibold">{{ dayjs(calMonth + '-01').format('YYYY年M月') }}</span>
          <button class="btn-ghost !p-1.5" @click="calMonth = dayjs(calMonth).add(1, 'month').format('YYYY-MM')">→</button>
        </div>
        <div class="grid grid-cols-7 gap-1 text-center text-[10px] text-slate-400 mb-1">
          <span v-for="w in ['日','一','二','三','四','五','六']" :key="w">{{ w }}</span>
        </div>
        <div class="grid grid-cols-7 gap-1">
          <button v-for="(d, i) in calendarDays" :key="i" :disabled="!d"
            class="aspect-square rounded-lg text-xs flex items-center justify-center relative transition-colors"
            :class="[
              !d ? '' : d === viewDate ? 'bg-primary-500 text-white font-bold' : 'hover:bg-slate-100 dark:hover:bg-slate-700',
            ]"
            @click="d && router.push(d === today() ? '/daily-summary' : `/daily-summary/${d}`)">
            {{ d ? Number(d.slice(-2)) : '' }}
            <span v-if="hasSummary(d)" class="absolute bottom-0.5 w-1 h-1 rounded-full" :class="d === viewDate ? 'bg-white' : 'bg-emerald-400'"></span>
            <span v-else-if="hasRecord(d)" class="absolute bottom-0.5 w-1 h-1 rounded-full" :class="d === viewDate ? 'bg-white' : 'bg-primary-300'"></span>
          </button>
        </div>
        <div class="text-[10px] text-slate-400 mt-2 flex gap-3">
          <span><span class="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 mr-1"></span>已写总结</span>
          <span><span class="inline-block w-1.5 h-1.5 rounded-full bg-primary-300 mr-1"></span>有学习</span>
        </div>
      </div>
    </div>

    <!-- 分享卡片 -->
    <Teleport to="body">
      <div v-if="showShare" class="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-6" @click.self="showShare = false">
        <div class="max-w-sm w-full">
          <div class="rounded-3xl overflow-hidden shadow-2xl bg-gradient-to-br from-primary-500 via-indigo-500 to-purple-600 text-white p-6">
            <div class="text-xs opacity-80">{{ viewDate }} · 专升本备考打卡</div>
            <div class="text-2xl font-black mt-1">{{ store.settings.userName }} 的学习日报</div>
            <div class="grid grid-cols-2 gap-3 mt-5">
              <div class="bg-white/15 backdrop-blur rounded-2xl p-3 text-center">
                <div class="text-2xl font-black">{{ formatMinutes(dayData.minutes) }}</div>
                <div class="text-[10px] opacity-80">学习时长</div>
              </div>
              <div class="bg-white/15 backdrop-blur rounded-2xl p-3 text-center">
                <div class="text-2xl font-black">{{ dayData.pTotal }}</div>
                <div class="text-[10px] opacity-80">刷题数</div>
              </div>
              <div class="bg-white/15 backdrop-blur rounded-2xl p-3 text-center">
                <div class="text-2xl font-black">{{ dayData.pomo.count }}</div>
                <div class="text-[10px] opacity-80">番茄钟</div>
              </div>
              <div class="bg-white/15 backdrop-blur rounded-2xl p-3 text-center">
                <div class="text-2xl font-black">🔥{{ store.gamification.streak }}天</div>
                <div class="text-[10px] opacity-80">连续学习</div>
              </div>
            </div>
            <div v-if="form.mood" class="mt-3 text-sm">今日心情：{{ form.mood }}</div>
            <div v-if="form.harvest" class="mt-2 text-xs bg-white/10 rounded-xl p-3 leading-relaxed">🌱 {{ form.harvest.slice(0, 100) }}</div>
            <div class="mt-4 text-[10px] opacity-70 text-center">—— 专升本学习助手 · 坚持就是胜利 ——</div>
          </div>
          <p class="text-center text-white/70 text-xs mt-3">截图保存卡片，分享给一起备考的伙伴吧 📸</p>
          <button class="btn-ghost w-full mt-2" @click="showShare = false">关闭</button>
        </div>
      </div>
    </Teleport>
  </div>
</template>
