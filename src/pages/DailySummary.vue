<script setup lang="ts">
import { computed, inject, onUnmounted, ref, watch } from 'vue'
import { useAppStore } from '../stores/app'
import { today, formatMinutes } from '../utils/date'
import { MOODS } from '../data/defaults'
import dayjs from 'dayjs'

const store = useAppStore()
const toast = inject<(m: string) => void>('toast', () => {})

// 编辑区固定为「今日」总结；往日总结通过点击日历弹出悬浮卡片查看
// 定时器驱动：页面挂载跨午夜后自动切换到新的一天，并重载表单内容
const editDate = ref(today())
const dayTimer = setInterval(() => {
  if (editDate.value !== today()) editDate.value = today()
}, 60000)
onUnmounted(() => clearInterval(dayTimer))

const form = ref({ mood: '', harvest: '', improve: '', plan: '' })
watch(editDate, (d, oldD) => {
  // 跨午夜切换时若存在未保存的编辑内容则保留，避免静默丢失用户输入
  const prev = store.summaries[oldD]
  const dirty = form.value.mood !== (prev?.mood || '')
    || form.value.harvest !== (prev?.harvest || '')
    || form.value.improve !== (prev?.improve || '')
    || form.value.plan !== (prev?.plan || '')
  if (dirty) {
    toast('已跨到新的一天，未保存的总结内容已保留，请及时保存')
    return
  }
  const s = store.summaries[d]
  form.value = {
    mood: s?.mood || '',
    harvest: s?.harvest || '',
    improve: s?.improve || '',
    plan: s?.plan || ''
  }
}, { immediate: true })

/** 聚合某日期的全维度数据概览 */
function aggregateDay(d: string) {
  const records = store.records.filter(r => r.date === d)
  const minutes = records.reduce((s, r) => s + r.minutes, 0)
  const problems = store.problemSessions.filter(p => p.date === d)
  const pTotal = problems.reduce((s, p) => s + p.total, 0)
  const pCorrect = problems.reduce((s, p) => s + p.correct, 0)
  const pomo = store.pomodoro.daily[d] || { count: 0, minutes: 0, interruptions: 0 }
  const bySubject: Record<string, number> = {}
  for (const r of records) bySubject[r.subjectId] = (bySubject[r.subjectId] || 0) + r.minutes
  return { minutes, pTotal, pCorrect, pomo, bySubject, accuracy: pTotal ? Math.round(pCorrect / pTotal * 100) : null }
}

// ---- 当日数据聚合 ----
const dayData = computed(() => aggregateDay(editDate.value))

/** 保存总结；心情/收获/反思为必填项，全部填写才允许保存（返回是否保存成功） */
function save(): boolean {
  if (!form.value.mood || !form.value.harvest.trim() || !form.value.improve.trim()) {
    toast('请先填写当日心情、收获与反思')
    return false
  }
  const isNew = !store.summaries[editDate.value]
  store.saveSummary({ date: editDate.value, ...form.value })
  toast('每日总结已保存' + (isNew ? ' +5 积分' : ''))
  return true
}

// ---- 往日总结悬浮卡片 ----
const cardDate = ref('')
/** 明日计划板块开关：用户可选择展示/隐藏，默认不强制显示 */
const showPlan = ref(false)
const cardData = computed(() => (cardDate.value ? aggregateDay(cardDate.value) : null))
const cardSummary = computed(() => (cardDate.value ? store.summaries[cardDate.value] : undefined))
/** 点击往日日期：弹出当日总结悬浮卡片；今日日期在页面直接编辑 */
function openDayCard(d: string) {
  if (d === today()) return
  cardDate.value = d
  showPlan.value = false
}

// Esc 关闭悬浮卡片
function onCardKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') cardDate.value = ''
}
watch(cardDate, v => {
  if (v) window.addEventListener('keydown', onCardKeydown)
  else window.removeEventListener('keydown', onCardKeydown)
})
onUnmounted(() => window.removeEventListener('keydown', onCardKeydown))

// ---- 日历 ----
const calMonth = ref(dayjs().format('YYYY-MM'))
// 跨午夜/跨月后日历自动切换到当前月
watch(editDate, d => {
  const m = dayjs(d).format('YYYY-MM')
  if (calMonth.value !== m) calMonth.value = m
})
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
  if (save()) showShare.value = true
}

function copyShareText() {
  const text = `我正在用「专升本学习助手」备考，今日专注 ${formatMinutes(dayData.value.minutes)}，完成 ${dayData.value.pTotal} 道题，连续学习 🔥${store.gamification.streak} 天！\n👉 https://github.com/Han050912/zsb-study-tracker`
  navigator.clipboard.writeText(text).then(() => toast('分享文案已复制'))
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
            <div class="section-title !mb-0">今日数据概览</div>
            <span class="text-xs text-slate-400">{{ editDate }}</span>
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
              !d ? '' : d === editDate ? 'bg-primary-500 text-white font-bold' : 'hover:bg-slate-100 dark:hover:bg-slate-700',
            ]"
            :title="d && d !== editDate ? '点击查看当日总结卡片' : ''"
            @click="d && openDayCard(d)">
            {{ d ? Number(d.slice(-2)) : '' }}
            <span v-if="hasSummary(d)" class="absolute bottom-0.5 w-1 h-1 rounded-full" :class="d === editDate ? 'bg-white' : 'bg-emerald-400'"></span>
            <span v-else-if="hasRecord(d)" class="absolute bottom-0.5 w-1 h-1 rounded-full" :class="d === editDate ? 'bg-white' : 'bg-primary-300'"></span>
          </button>
        </div>
        <div class="text-[10px] text-slate-400 mt-2 flex gap-3">
          <span><span class="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 mr-1"></span>已写总结</span>
          <span><span class="inline-block w-1.5 h-1.5 rounded-full bg-primary-300 mr-1"></span>有学习</span>
        </div>
        <p class="text-[10px] text-slate-400 mt-1">点击往日日期，弹出当日总结悬浮卡片</p>
      </div>
    </div>

    <!-- 往日总结悬浮卡片 -->
    <Teleport to="body">
      <Transition name="fade">
        <div v-if="cardDate && cardData" class="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" @click.self="cardDate = ''">
          <div class="bg-white dark:bg-slate-800 rounded-2xl w-full max-w-md max-h-[85vh] overflow-y-auto shadow-2xl animate-pop"
            role="dialog" aria-modal="true" :aria-label="`${cardDate} 总结`">
            <div class="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-700 sticky top-0 bg-white dark:bg-slate-800">
              <h3 class="font-bold">📅 {{ cardDate }} 总结</h3>
              <button class="text-slate-400 hover:text-slate-600 text-xl leading-none" @click="cardDate = ''" aria-label="关闭">×</button>
            </div>
            <div class="px-5 py-4 space-y-4">
              <!-- ① 当日全维度数据概览（必填） -->
              <div>
                <div class="text-xs font-semibold text-slate-400 mb-2">📊 当日数据概览</div>
                <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                  <div class="bg-slate-50 dark:bg-slate-700/50 rounded-xl p-2">
                    <div class="font-black text-primary-500">{{ formatMinutes(cardData.minutes) }}</div>
                    <div class="text-[10px] text-slate-400">学习时长</div>
                  </div>
                  <div class="bg-slate-50 dark:bg-slate-700/50 rounded-xl p-2">
                    <div class="font-black text-emerald-500">{{ cardData.pTotal }}</div>
                    <div class="text-[10px] text-slate-400">刷题数</div>
                  </div>
                  <div class="bg-slate-50 dark:bg-slate-700/50 rounded-xl p-2">
                    <div class="font-black text-amber-500">{{ cardData.accuracy === null ? '—' : cardData.accuracy + '%' }}</div>
                    <div class="text-[10px] text-slate-400">正确率</div>
                  </div>
                  <div class="bg-slate-50 dark:bg-slate-700/50 rounded-xl p-2">
                    <div class="font-black text-orange-500">{{ cardData.pomo.count }}</div>
                    <div class="text-[10px] text-slate-400">番茄钟</div>
                  </div>
                </div>
                <div v-if="Object.keys(cardData.bySubject).length" class="flex gap-2 mt-2 flex-wrap">
                  <span v-for="(min, sid) in cardData.bySubject" :key="sid" class="text-xs px-2 py-1 rounded-full text-white"
                    :style="{ background: store.subjectMap[sid]?.color || '#94a3b8' }">
                    {{ store.subjectMap[sid]?.name }} {{ formatMinutes(min) }}
                  </span>
                </div>
              </div>
              <!-- ② 当日心情（必填） -->
              <div>
                <div class="text-xs font-semibold text-slate-400 mb-1">😊 当日心情</div>
                <p class="text-sm">{{ cardSummary?.mood || '未填写' }}</p>
              </div>
              <!-- ③ 当日收获（必填） -->
              <div>
                <div class="text-xs font-semibold text-slate-400 mb-1">🌱 当日收获</div>
                <p class="text-sm whitespace-pre-wrap leading-relaxed">{{ cardSummary?.harvest || '未填写' }}</p>
              </div>
              <!-- ④ 当日反思（必填） -->
              <div>
                <div class="text-xs font-semibold text-slate-400 mb-1">🪞 当日反思</div>
                <p class="text-sm whitespace-pre-wrap leading-relaxed">{{ cardSummary?.improve || '未填写' }}</p>
              </div>
              <!-- 明日计划（可选配置：开关控制展示/隐藏） -->
              <div class="border-t border-slate-100 dark:border-slate-700 pt-3">
                <div class="flex items-center justify-between">
                  <span class="text-xs font-semibold text-slate-400">🎯 明日计划</span>
                  <button class="text-xs px-2.5 py-1 rounded-full transition-colors"
                    :class="showPlan ? 'bg-primary-500 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400'"
                    :aria-pressed="showPlan"
                    @click="showPlan = !showPlan">
                    {{ showPlan ? '已展示 · 点击隐藏' : '已隐藏 · 点击展示' }}
                  </button>
                </div>
                <p v-if="showPlan" class="text-sm whitespace-pre-wrap leading-relaxed mt-2">{{ cardSummary?.plan || '未填写' }}</p>
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 分享卡片 -->
    <Teleport to="body">
      <div v-if="showShare" class="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-6" @click.self="showShare = false">
        <div class="max-w-sm w-full">
          <div class="rounded-3xl overflow-hidden shadow-2xl bg-gradient-to-br from-primary-500 via-indigo-500 to-purple-600 text-white p-6">
            <!-- Logo + 品牌 -->
            <div class="flex items-center gap-2 mb-3">
              <img src="/logo.png" alt="Logo" class="w-6 h-6 rounded" onerror="this.style.display='none'" />
              <span class="text-xs font-medium opacity-90">专升本学习助手</span>
            </div>
            <div class="text-xs opacity-80">{{ editDate }} · 备考打卡</div>
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
            <div class="mt-4 text-[10px] opacity-70 text-center">github.com/Han050912/zsb-study-tracker</div>
          </div>
          <p class="text-center text-white/70 text-xs mt-3">长按保存图片，分享到备考群，和朋友一起上岸！📸</p>
          <div class="flex gap-2 mt-2">
            <button class="btn-ghost flex-1" @click="copyShareText">📋 复制分享文案</button>
            <button class="btn-ghost flex-1" @click="showShare = false">关闭</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
