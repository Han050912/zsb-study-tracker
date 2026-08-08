<script setup lang="ts">
import { computed, inject, ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useAppStore } from '../stores/app'
import { useChart, chartTextColor } from '../composables/useChart'
import SubjectPanel from '../components/SubjectPanel.vue'
import Modal from '../components/Modal.vue'
import { uid, today } from '../utils/date'
import { BUILTIN_TEMPLATES } from '../data/englishTemplates'
import { fetchMaimemoToday, fetchMaimemoTodayDetail } from '../services/maimemo'
import type { MaimemoWordDetail } from '../services/maimemo'
import VocabCheckList from '../components/VocabCheckList.vue'

const store = useAppStore()
const route = useRoute()
const toast = inject<(m: string) => void>('toast', () => {})
const eng = computed(() => store.english)
// 「英语」科目可能被用户在设置页删除，此时页面整体隐藏
const subjectExists = computed(() => !!store.subjectMap.english)

const tab = ref<'panel' | 'vocab' | 'reading' | 'listening' | 'templates'>('panel')
onMounted(() => {
  const t = route.query.tab as string
  if (['panel', 'vocab', 'reading', 'listening', 'templates'].includes(t)) {
    tab.value = t as typeof tab.value
  }
})

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

// ---- 墨墨背单词同步（官方开放 API，公测） ----
const maimemoToken = ref(store.settings.maimemoToken || '')
const syncing = ref(false)
async function saveMaimemoToken() {
  store.updateSettings({ maimemoToken: maimemoToken.value.trim() || undefined })
  // 立即推送到云端（Worker 代理从 user_settings 读取 Token），不等待防抖
  await store.saveAsync()
  toast('墨墨 Token 已保存')
}
async function syncMaimemo() {
  const token = (store.settings.maimemoToken || '').trim()
  if (!token) { toast('请先填写并保存墨墨开放 API Token'); return }
  if (syncing.value) return
  syncing.value = true
  try {
    const data = await fetchMaimemoToday()
    if (data.newWords + data.reviewWords <= 0) {
      toast('墨墨今日暂无已完成背诵（请在 App 内开启自动同步并完成今日学习后再试）')
      return
    }
    // 同步数据直接回填「本次新学 / 本次复习」输入框，直观展示墨墨最新数据
    newWords.value = data.newWords
    reviewWords.value = data.reviewWords
    // 防重复：同日同数量视为已同步
    const dup = eng.value.vocab.some(v => v.date === today() && v.newWords === data.newWords && v.reviewWords === data.reviewWords)
    if (dup) { toast('今日墨墨数据已同步，无需重复打卡'); return }
    // 直接保存为今日词汇打卡记录（含积分奖励，store 内自动持久化）
    store.addVocabRecord(data.newWords, data.reviewWords)
    toast(`已同步墨墨今日数据：新学 ${data.newWords} · 复习 ${data.reviewWords}`)
    // 顺带拉取今日单词明细，打卡列表一并更新（失败不影响同步结果）
    loadTodayWords()
  } catch (e: any) {
    toast(e?.message || '同步失败，请检查网络后重试')
  } finally {
    syncing.value = false
  }
}
/** 近 14 个自然日词汇量（无打卡的日期补 0，保证图表连续不断档） */
const vocabByDate = computed(() => {
  const map: Record<string, { newWords: number; reviewWords: number }> = {}
  for (const v of eng.value.vocab) {
    map[v.date] = map[v.date] || { newWords: 0, reviewWords: 0 }
    map[v.date].newWords += v.newWords
    map[v.date].reviewWords += v.reviewWords
  }
  const days: { date: string; newWords: number; reviewWords: number }[] = []
  for (let i = 13; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    days.push({ date: key, ...(map[key] || { newWords: 0, reviewWords: 0 }) })
  }
  return days
})

// ---- 墨墨今日单词明细（词汇打卡列表） ----
/** 今日单词本地缓存键（按日期隔离） */
const WORDS_CACHE_KEY = `maimemo-today-words:${today()}`

/** 从本地缓存恢复今日单词（界面切换/页面跳转/组件卸载后自动恢复） */
function loadCachedWords(): MaimemoWordDetail[] {
  try {
    const raw = localStorage.getItem(WORDS_CACHE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

/** 拉取成功后立即持久化，保证数据可靠性 */
function persistWords(words: MaimemoWordDetail[]) {
  try {
    localStorage.setItem(WORDS_CACHE_KEY, JSON.stringify(words))
  } catch { /* 存储满时静默失败 */ }
}

/** 清理历史日期的词汇缓存（单词列表 + 打卡状态），避免 localStorage 无限累积 */
function cleanStaleVocabCache() {
  try {
    const stale: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && (k.startsWith('maimemo-today-words:') || k.startsWith('vocab-checkin:')) && !k.endsWith(today())) stale.push(k)
    }
    stale.forEach(k => localStorage.removeItem(k))
  } catch { /* 忽略 */ }
}
cleanStaleVocabCache()

// 初始值直接读缓存：返回本页时无需重新拉取即可恢复已保存的单词
const todayWords = ref<MaimemoWordDetail[]>(loadCachedWords())
const loadingWords = ref(false)

/** 拉取墨墨今日全部单词明细（含释义），供打卡列表使用 */
async function loadTodayWords() {
  const token = (store.settings.maimemoToken || '').trim()
  if (!token) { toast('请先填写并保存墨墨开放 API Token'); return }
  if (loadingWords.value) return
  loadingWords.value = true
  try {
    const words = await fetchMaimemoTodayDetail()
    todayWords.value = words
    persistWords(words)
    if (!words.length) toast('墨墨今日暂无单词数据（请先在 App 中完成学习并开启自动同步）')
  } catch (e: any) {
    toast(e?.message || '拉取单词明细失败')
  } finally {
    loadingWords.value = false
  }
}

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

// ---- 作文模板（三大分类：议论文/图表文/信件文 + 自定义） ----
const TPL_CATEGORIES = ['议论文', '图表文', '信件文', '自定义']
const showTpl = ref(false)
const tplForm = ref<{ id: string; title: string; content: string; level: number; category?: string }>({ id: '', title: '', content: '', level: 0, category: '自定义' })
function openTpl(t?: any) {
  tplForm.value = t ? { category: '自定义', ...t } : { id: '', title: '', content: '', level: 0, category: '自定义' }
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

/** 一键生成内置高分模板库（按标题去重，可重复点击补全缺失项） */
function generateBuiltin() {
  const existing = new Set(eng.value.templates.map(t => t.title))
  let added = 0
  for (const bt of BUILTIN_TEMPLATES) {
    if (existing.has(bt.title)) continue
    eng.value.templates.push({ id: uid(), title: bt.title, content: bt.content, level: 0, category: bt.category })
    added++
  }
  if (!added) { toast('内置模板已全部生成，无需重复添加'); return }
  store.save()
  toast(`已生成 ${added} 套内置高分模板`)
}

/** 按分类分组展示（旧数据无 category 归入「自定义」） */
const tplGroups = computed(() =>
  TPL_CATEGORIES
    .map(cat => ({ cat, items: eng.value.templates.filter(t => (t.category || '自定义') === cat) }))
    .filter(g => g.items.length)
)

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
      <!-- 墨墨背单词同步 -->
      <div class="card space-y-2">
        <div class="flex items-center gap-2">
          <div class="section-title !mb-0">🔗 墨墨背单词同步</div>
          <span class="text-[9px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400">云端同步</span>
        </div>
        <div class="flex gap-2">
          <input v-model="maimemoToken" type="password" class="input" placeholder="墨墨开放 API Token（App：我的→更多设置→实验功能→开放 API）" />
          <button class="btn-ghost shrink-0" @click="saveMaimemoToken">保存</button>
        </div>
        <button class="btn-primary w-full" :disabled="syncing" @click="syncMaimemo">
          {{ syncing ? '同步中…' : '☁️ 同步墨墨今日背诵数据' }}
        </button>
        <p class="text-[10px] text-slate-400">公测接口：需在墨墨 App 内开启「自动同步」，且当日打开过 App 后数据才准确</p>
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
      <!-- 今日词汇打卡列表（表头与刷新按钮由组件内部统一管理） -->
      <div class="card !p-0 overflow-hidden">
        <VocabCheckList :words="todayWords" :loading="loadingWords" @refresh="loadTodayWords" />
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
        <div class="flex justify-between items-center mb-3 flex-wrap gap-2">
          <div class="section-title !mb-0">✍️ 作文模板库</div>
          <div class="flex gap-2">
            <button class="btn-ghost !py-1.5" title="一键生成 议论文×5 / 图表文×2 / 信件文×3 高分模板" @click="generateBuiltin">✨ 生成内置模板库</button>
            <button class="btn-primary !py-1.5" @click="openTpl()">+ 自定义模板</button>
          </div>
        </div>
        <div v-if="!eng.templates.length" class="text-xs text-slate-400 text-center py-6">
          暂无模板。点击「✨ 生成内置模板库」一键获取 10 套高分模板（议论文 5 套 · 图表文 2 套 · 信件文 3 套）
        </div>
        <!-- 分分类多列布局 -->
        <div v-for="g in tplGroups" :key="g.cat" class="mb-4">
          <div class="flex items-center gap-2 mb-2">
            <span class="text-xs font-bold px-2 py-0.5 rounded-full"
              :class="g.cat === '议论文' ? 'bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400'
                : g.cat === '图表文' ? 'bg-violet-50 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400'
                : g.cat === '信件文' ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400'
                : 'bg-slate-100 text-slate-500 dark:bg-slate-700'">{{ g.cat }}</span>
            <span class="text-[10px] text-slate-400">{{ g.items.length }} 套</span>
          </div>
          <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
            <div v-for="t in g.items" :key="t.id" class="border border-slate-100 dark:border-slate-700 rounded-xl p-3 cursor-pointer hover:shadow-sm transition-shadow" @click="openTpl(t)">
              <div class="flex items-center justify-between gap-2">
                <span class="font-medium text-xs flex-1">{{ t.title }}</span>
                <span class="text-amber-400 text-[10px] shrink-0">{{ '★'.repeat(t.level) || '未评级' }}</span>
              </div>
              <p class="text-[11px] text-slate-400 line-clamp-3 mt-1.5 whitespace-pre-line">{{ t.content }}</p>
            </div>
          </div>
        </div>
      </div>
    </div>

    <Modal title="作文模板" :show="showTpl" @close="showTpl = false">
      <div class="space-y-3">
        <input v-model="tplForm.title" class="input" placeholder="模板标题，如：议论文开头万能句" />
        <div>
          <label class="label">分类</label>
          <div class="flex gap-2">
            <button v-for="c in TPL_CATEGORIES" :key="c" type="button"
              class="flex-1 text-xs px-2 py-1.5 rounded-lg font-medium transition-all"
              :class="tplForm.category === c ? 'bg-primary-500 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-500'"
              @click="tplForm.category = c">{{ c }}</button>
          </div>
        </div>
        <textarea v-model="tplForm.content" rows="8" class="input !text-xs font-mono" placeholder="模板内容…"></textarea>
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
