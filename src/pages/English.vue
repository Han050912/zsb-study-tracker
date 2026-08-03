<script setup lang="ts">
import { computed, inject, ref } from 'vue'
import { useAppStore } from '../stores/app'
import { useChart, chartTextColor } from '../composables/useChart'
import SubjectPanel from '../components/SubjectPanel.vue'
import Modal from '../components/Modal.vue'
import { uid } from '../utils/date'

const store = useAppStore()
const toast = inject<(m: string) => void>('toast', () => {})
const eng = computed(() => store.english)
// 「英语」科目可能被用户在设置页删除，此时页面整体隐藏
const subjectExists = computed(() => !!store.subjectMap.english)

const tab = ref<'panel' | 'vocab' | 'reading' | 'listening' | 'templates'>('panel')

// ---- 词汇（逐条打卡记录） ----
const newWords = ref(30)
const reviewWords = ref(50)
function addVocab() {
  // v-model.number 清空后为 ''，入 store 前统一净化为非负整数，避免污染统计聚合
  const n = Math.max(0, Math.floor(Number(newWords.value) || 0))
  const r = Math.max(0, Math.floor(Number(reviewWords.value) || 0))
  if (n <= 0 && r <= 0) return
  // 每完成一次背诵单独生成一条打卡记录
  store.addVocabRecord(n, r)
  toast(`本次背单词打卡成功 +${Math.round((n + r) / 20)} 积分`)
}
/** 删除单条打卡记录：本条积分全额回收，同步删除积分流水 */
function delVocab(id: string) {
  if (!window.confirm('删除本条背单词打卡记录？对应积分将全额回收。')) return
  store.deleteVocabRecord(id)
  toast('记录已删除，积分已回收')
}
const totalVocab = computed(() => eng.value.vocab.reduce((s, v) => s + v.newWords, 0))
/** 近 14 个有打卡的日期（按日聚合用于图表） */
const vocabByDate = computed(() => {
  const map: Record<string, { newWords: number; reviewWords: number }> = {}
  for (const v of eng.value.vocab) {
    map[v.date] = map[v.date] || { newWords: 0, reviewWords: 0 }
    map[v.date].newWords += v.newWords
    map[v.date].reviewWords += v.reviewWords
  }
  return Object.entries(map)
    .map(([date, v]) => ({ date, ...v }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .slice(-14)
})

// ---- 阅读 ----
const readWpm = ref(80)
const readAcc = ref(75)
function addReading() {
  // v-model.number 清空后为 ''，入 store 前净化，避免污染历史与统计
  const wpm = Math.max(0, Math.floor(Number(readWpm.value) || 0))
  const acc = Math.min(100, Math.max(0, Math.floor(Number(readAcc.value) || 0)))
  if (wpm <= 0) { toast('请填写有效的阅读速度'); return }
  store.addReadingRecord(wpm, acc)
  toast('阅读记录已保存 +5 积分')
}

// ---- 听力 ----
const lisMinutes = ref(20)
const lisMaterial = ref('')
const lisMode = ref<'精听' | '泛听'>('精听')
function addListening() {
  // v-model.number 清空后为 ''，入 store 前净化
  const mins = Math.max(0, Math.floor(Number(lisMinutes.value) || 0))
  if (mins <= 0) { toast('请填写有效的听力时长'); return }
  store.addListeningRecord(mins, lisMaterial.value || '未注明', lisMode.value)
  lisMaterial.value = ''
  toast(`听力记录已保存 +${Math.round(mins / 10)} 积分`)
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

// ---- 词汇图表（按日聚合） ----
const { el: vocabEl } = useChart(() => {
  const data = vocabByDate.value
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
}, [vocabByDate])
</script>

<template>
  <div class="p-4 md:p-6 max-w-5xl mx-auto">
    <div v-if="!subjectExists" class="card text-center py-16 text-slate-400">
      <div class="text-4xl mb-2">📖</div>
      <p class="text-sm">「英语」科目已被删除，此页面已隐藏</p>
      <RouterLink to="/settings" class="text-primary-500 text-xs underline mt-2 inline-block">前往设置页管理科目 →</RouterLink>
    </div>
    <template v-else>
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
          <div><div class="text-xl font-black text-emerald-500">{{ eng.vocab.length }}</div><div class="text-[11px] text-slate-400">打卡次数</div></div>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div><label class="label">本次新学</label><input v-model.number="newWords" type="number" min="0" class="input" /></div>
          <div><label class="label">本次复习</label><input v-model.number="reviewWords" type="number" min="0" class="input" /></div>
        </div>
        <button class="btn-primary w-full mt-3" @click="addVocab">打卡背单词（目标 {{ store.settings.wordGoal }} 个/天）</button>
        <p class="text-[10px] text-slate-400 mt-2">每完成一次背诵打卡，单独生成一条记录</p>
      </div>
      <div class="card">
        <div class="section-title">打卡记录</div>
        <div v-if="!eng.vocab.length" class="text-xs text-slate-400 text-center py-3">暂无打卡记录</div>
        <div class="space-y-1.5 max-h-72 overflow-y-auto">
          <div v-for="v in eng.vocab.slice().reverse()" :key="v.id" class="flex items-center gap-2 text-sm group">
            <span class="text-xs text-slate-400 w-20 shrink-0">{{ v.date }}</span>
            <span class="flex-1 text-xs">新学 <b class="text-emerald-500">{{ v.newWords }}</b> · 复习 <b class="text-emerald-500">{{ v.reviewWords }}</b></span>
            <span class="text-[10px] text-amber-500 shrink-0">+{{ v.points }} 积分</span>
            <button class="text-red-400 text-xs shrink-0" title="删除记录并回收积分" @click="delVocab(v.id)">删除</button>
          </div>
        </div>
      </div>
      <div class="card">
        <div class="section-title">近 14 个打卡日词汇量</div>
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
    </template>
  </div>
</template>
