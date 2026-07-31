<script setup lang="ts">
import { computed, inject, ref } from 'vue'
import { useAppStore } from '../stores/app'
import { today } from '../utils/date'
import { useChart, chartTextColor } from '../composables/useChart'
import SubjectPanel from '../components/SubjectPanel.vue'
import Modal from '../components/Modal.vue'
import { uid } from '../utils/date'

const store = useAppStore()
const toast = inject<(m: string) => void>('toast', () => {})
const eng = computed(() => store.english)

const tab = ref<'panel' | 'vocab' | 'reading' | 'listening' | 'templates'>('panel')

// ---- 词汇 ----
const newWords = ref(30)
const reviewWords = ref(50)
function addVocab() {
  if (newWords.value <= 0 && reviewWords.value <= 0) return
  const t = today()
  const existing = eng.value.vocab.find(v => v.date === t)
  if (existing) { existing.newWords += newWords.value; existing.reviewWords += reviewWords.value }
  else eng.value.vocab.push({ date: t, newWords: newWords.value, reviewWords: reviewWords.value })
  store.addPoints(Math.round((newWords.value + reviewWords.value) / 20), '背单词')
  store.save()
  toast('词汇记录已保存')
}
const totalVocab = computed(() => eng.value.vocab.reduce((s, v) => s + v.newWords, 0))

// ---- 阅读 ----
const readWpm = ref(80)
const readAcc = ref(75)
function addReading() {
  eng.value.reading.push({ date: today(), wpm: readWpm.value, accuracy: readAcc.value })
  store.addPoints(5, '阅读训练')
  store.save()
  toast('阅读记录已保存')
}

// ---- 听力 ----
const lisMinutes = ref(20)
const lisMaterial = ref('')
const lisMode = ref<'精听' | '泛听'>('精听')
function addListening() {
  eng.value.listening.push({ date: today(), minutes: lisMinutes.value, material: lisMaterial.value || '未注明', mode: lisMode.value })
  store.addPoints(Math.round(lisMinutes.value / 10), '听力练习')
  store.save()
  lisMaterial.value = ''
  toast('听力记录已保存')
}

// ---- 模板 ----
const showTpl = ref(false)
const tplForm = ref({ id: '', title: '', content: '', level: 0 })
function openTpl(t?: any) {
  tplForm.value = t ? { ...t } : { id: '', title: '', content: '', level: 0 }
  showTpl.value = true
}
function saveTpl() {
  if (!tplForm.value.title) return
  if (tplForm.value.id) {
    const t = eng.value.templates.find(x => x.id === tplForm.value.id)
    if (t) Object.assign(t, tplForm.value)
  } else {
    eng.value.templates.push({ ...tplForm.value, id: uid() })
  }
  store.save()
  showTpl.value = false
  toast('模板已保存')
}
function delTpl(id: string) {
  eng.value.templates = eng.value.templates.filter(t => t.id !== id)
  store.save()
}

// ---- 词汇图表 ----
const { el: vocabEl } = useChart(() => {
  const data = eng.value.vocab.slice(-14)
  return {
    grid: { left: 40, right: 16, top: 30, bottom: 24 },
    legend: { textStyle: { color: chartTextColor(), fontSize: 10 } },
    xAxis: { type: 'category', data: data.map(v => v.date.slice(5)), axisLabel: { color: chartTextColor(), fontSize: 10 } },
    yAxis: { type: 'value', axisLabel: { color: chartTextColor() } },
    series: [
      { name: '新学', type: 'bar', stack: 'a', data: data.map(v => v.newWords), itemStyle: { color: '#10b981' } },
      { name: '复习', type: 'bar', stack: 'a', data: data.map(v => v.reviewWords), itemStyle: { color: '#6ee7b7' } }
    ],
    tooltip: { trigger: 'axis' }
  }
}, [eng])
</script>

<template>
  <div class="p-4 md:p-6 max-w-5xl mx-auto">
    <h1 class="page-title mb-4">📖 英语</h1>

    <div class="flex gap-1 overflow-x-auto bg-slate-100 dark:bg-slate-800 rounded-xl p-1 mb-4">
      <button v-for="t in [
        { k: 'panel', l: '📚 综合' }, { k: 'vocab', l: '🔤 词汇' }, { k: 'reading', l: '📰 阅读' },
        { k: 'listening', l: '🎧 听力' }, { k: 'templates', l: '✍️ 作文模板' }
      ]" :key="t.k" class="flex-1 whitespace-nowrap text-xs px-3 py-2 rounded-lg font-medium"
        :class="tab === t.k ? 'bg-white dark:bg-slate-700 shadow-sm' : 'text-slate-500'"
        @click="tab = t.k as any">{{ t.l }}</button>
    </div>

    <div v-show="tab === 'panel'">
      <SubjectPanel subject-id="english" />
    </div>

    <!-- 词汇 -->
    <div v-show="tab === 'vocab'" class="space-y-3">
      <div class="card">
        <div class="grid grid-cols-3 gap-3 text-center mb-3">
          <div><div class="text-xl font-black text-emerald-500">{{ totalVocab }}</div><div class="text-[11px] text-slate-400">累计新学词汇</div></div>
          <div><div class="text-xl font-black text-emerald-500">{{ eng.vocab.reduce((s, v) => s + v.reviewWords, 0) }}</div><div class="text-[11px] text-slate-400">累计复习</div></div>
          <div><div class="text-xl font-black text-emerald-500">{{ eng.vocab.length }}</div><div class="text-[11px] text-slate-400">打卡天数</div></div>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div><label class="label">今日新学</label><input v-model.number="newWords" type="number" min="0" class="input" /></div>
          <div><label class="label">今日复习</label><input v-model.number="reviewWords" type="number" min="0" class="input" /></div>
        </div>
        <button class="btn-primary w-full mt-3" @click="addVocab">打卡背单词（目标 {{ store.settings.wordGoal }} 个/天）</button>
      </div>
      <div class="card">
        <div class="section-title">近 14 天词汇量</div>
        <div ref="vocabEl" class="h-52"></div>
      </div>
    </div>

    <!-- 阅读 -->
    <div v-show="tab === 'reading'" class="space-y-3">
      <div class="card space-y-3">
        <div class="section-title">📰 阅读理解计时训练</div>
        <div class="grid grid-cols-2 gap-3">
          <div><label class="label">阅读速度（词/分钟）</label><input v-model.number="readWpm" type="number" min="0" class="input" /></div>
          <div><label class="label">正确率（%）</label><input v-model.number="readAcc" type="number" min="0" max="100" class="input" /></div>
        </div>
        <button class="btn-primary w-full" @click="addReading">保存阅读记录</button>
      </div>
      <div class="card">
        <div class="section-title">阅读历史</div>
        <div class="space-y-1.5">
          <div v-for="(r, i) in eng.reading.slice().reverse()" :key="i" class="flex items-center gap-3 text-sm">
            <span class="text-xs text-slate-400 w-20">{{ r.date }}</span>
            <span class="flex-1">{{ r.wpm }} 词/分钟</span>
            <span class="font-semibold" :class="r.accuracy >= 80 ? 'text-emerald-500' : 'text-amber-500'">{{ r.accuracy }}%</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 听力 -->
    <div v-show="tab === 'listening'" class="space-y-3">
      <div class="card space-y-3">
        <div class="section-title">🎧 听力练习</div>
        <div class="grid grid-cols-2 gap-3">
          <div><label class="label">时长（分钟）</label><input v-model.number="lisMinutes" type="number" min="1" class="input" /></div>
          <div>
            <label class="label">模式</label>
            <select v-model="lisMode" class="input"><option>精听</option><option>泛听</option></select>
          </div>
        </div>
        <div><label class="label">材料</label><input v-model="lisMaterial" class="input" placeholder="如：历年真题听力 Section A" /></div>
        <button class="btn-primary w-full" @click="addListening">保存听力记录</button>
      </div>
      <div class="card">
        <div class="section-title">听力历史</div>
        <div class="space-y-1.5">
          <div v-for="(l, i) in eng.listening.slice().reverse()" :key="i" class="flex items-center gap-3 text-sm">
            <span class="text-xs text-slate-400 w-20">{{ l.date }}</span>
            <span class="text-[10px] px-1.5 py-0.5 rounded" :class="l.mode === '精听' ? 'bg-emerald-50 text-emerald-600' : 'bg-sky-50 text-sky-600'">{{ l.mode }}</span>
            <span class="flex-1 truncate">{{ l.material }}</span>
            <span class="text-xs text-slate-400">{{ l.minutes }}分钟</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 作文模板 -->
    <div v-show="tab === 'templates'" class="space-y-3">
      <div class="card">
        <div class="flex justify-between items-center mb-3">
          <div class="section-title !mb-0">✍️ 作文模板库</div>
          <button class="btn-primary !py-1.5" @click="openTpl()">+ 新建模板</button>
        </div>
        <div v-if="!eng.templates.length" class="text-xs text-slate-400 text-center py-4">暂无模板，添加常用句型模板吧</div>
        <div class="space-y-2">
          <div v-for="t in eng.templates" :key="t.id" class="border border-slate-100 dark:border-slate-700 rounded-xl p-3 cursor-pointer hover:shadow-sm" @click="openTpl(t)">
            <div class="flex items-center justify-between">
              <span class="font-medium text-sm">{{ t.title }}</span>
              <span class="text-amber-400 text-xs">{{ '★'.repeat(t.level) || '未评级' }}</span>
            </div>
            <p class="text-xs text-slate-400 line-clamp-2 mt-1">{{ t.content }}</p>
          </div>
        </div>
      </div>
    </div>

    <Modal title="作文模板" :show="showTpl" @close="showTpl = false">
      <div class="space-y-3">
        <input v-model="tplForm.title" class="input" placeholder="模板标题，如：议论文开头万能句" />
        <textarea v-model="tplForm.content" rows="6" class="input" placeholder="模板内容…"></textarea>
        <div>
          <label class="label">掌握程度</label>
          <div class="flex gap-1">
            <button v-for="i in 5" :key="i" class="text-2xl" :class="i <= tplForm.level ? 'text-amber-400' : 'text-slate-300'" @click="tplForm.level = i">★</button>
          </div>
        </div>
      </div>
      <template #footer>
        <button v-if="tplForm.id" class="btn-danger mr-auto" @click="delTpl(tplForm.id); showTpl = false">删除</button>
        <button class="btn-ghost" @click="showTpl = false">取消</button>
        <button class="btn-primary" @click="saveTpl">保存</button>
      </template>
    </Modal>
  </div>
</template>
