<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { getErrorMessage } from '../utils/error'
import { useToast } from '../composables/useToast'
import { useConfirm } from '../composables/useConfirm'
import { useRoute } from 'vue-router'
import { useAppStore } from '../stores/app'
import SubjectPanel from '../components/SubjectPanel.vue'
import { today } from '../utils/date'
import { fetchMaimemoToday, fetchMaimemoTodayDetail } from '../services/maimemo'
import type { MaimemoWordDetail } from '../services/maimemo'
import VocabCheckList from '../components/VocabCheckList.vue'
import MaimemoPanel from '../components/english/MaimemoPanel.vue'
import VocabChart from '../components/english/VocabChart.vue'
import ReadingForm from '../components/english/ReadingForm.vue'
import ListeningForm from '../components/english/ListeningForm.vue'
import EssayTemplatePanel from '../components/english/EssayTemplatePanel.vue'

const store = useAppStore()
const route = useRoute()
const toast = useToast()
const confirm = useConfirm()
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
async function delVocab(id: string) {
  if (!(await confirm('删除本条背单词打卡记录？对应积分将全额回收。', { danger: true }))) return
  store.deleteVocabRecord(id)
  toast('记录已删除，积分已回收')
}
const totalVocab = computed(() => eng.value.vocab.reduce((s, v) => s + v.newWords, 0))

// ---- 墨墨背单词同步（官方开放 API，公测） ----
// Token 输入与保存在 MaimemoPanel 内就地完成；同步因回写上方词汇表单并触发单词明细拉取，留在页面层编排
const syncing = ref(false)
async function syncMaimemo() {
  if (!store.settings.maimemoConnected) {
    toast('请先填写并保存墨墨开放 API Token')
    return
  }
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
    const dup = eng.value.vocab.some(
      (v) => v.date === today() && v.newWords === data.newWords && v.reviewWords === data.reviewWords
    )
    if (dup) {
      toast('今日墨墨数据已同步，无需重复打卡')
      return
    }
    // 直接保存为今日词汇打卡记录（含积分奖励，store 内自动持久化）
    store.addVocabRecord(data.newWords, data.reviewWords)
    toast(`已同步墨墨今日数据：新学 ${data.newWords} · 复习 ${data.reviewWords}`)
    // 顺带拉取今日单词明细，打卡列表一并更新（失败不影响同步结果）
    loadTodayWords()
  } catch (e) {
    toast(getErrorMessage(e, '同步失败，请检查网络后重试'))
  } finally {
    syncing.value = false
  }
}

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
  } catch {
    /* 存储满时静默失败 */
  }
}

/** 清理历史日期的词汇缓存（单词列表 + 打卡状态），避免 localStorage 无限累积 */
function cleanStaleVocabCache() {
  try {
    const stale: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && (k.startsWith('maimemo-today-words:') || k.startsWith('vocab-checkin:')) && !k.endsWith(today()))
        stale.push(k)
    }
    stale.forEach((k) => localStorage.removeItem(k))
  } catch {
    /* 忽略 */
  }
}
cleanStaleVocabCache()

// 初始值直接读缓存：返回本页时无需重新拉取即可恢复已保存的单词
const todayWords = ref<MaimemoWordDetail[]>(loadCachedWords())
const loadingWords = ref(false)

/** 拉取墨墨今日全部单词明细（含释义），供打卡列表使用 */
async function loadTodayWords() {
  if (!store.settings.maimemoConnected) {
    toast('请先填写并保存墨墨开放 API Token')
    return
  }
  if (loadingWords.value) return
  loadingWords.value = true
  try {
    const words = await fetchMaimemoTodayDetail()
    todayWords.value = words
    persistWords(words)
    if (!words.length) toast('墨墨今日暂无单词数据（请先在 App 中完成学习并开启自动同步）')
  } catch (e) {
    toast(getErrorMessage(e, '拉取单词明细失败'))
  } finally {
    loadingWords.value = false
  }
}
</script>

<template>
  <div class="p-4 md:p-6 max-w-5xl mx-auto">
    <div v-if="!subjectExists" class="card text-center py-16 text-slate-400">
      <div class="text-4xl mb-2"></div>
      <p class="text-sm">「英语」科目已被删除，此页面已隐藏</p>
      <RouterLink to="/settings" class="text-primary-500 text-xs underline mt-2 inline-block"
        >前往设置页管理科目 →</RouterLink
      >
    </div>
    <template v-else>
      <h1 class="page-title mb-4">英语</h1>

      <div class="flex gap-1 overflow-x-auto bg-slate-100 dark:bg-slate-800 rounded-xl p-1 mb-4">
        <button
          v-for="t in [
            { k: 'panel', l: '综合' },
            { k: 'vocab', l: '词汇' },
            { k: 'reading', l: '阅读' },
            { k: 'listening', l: '听力' },
            { k: 'templates', l: '作文模板' }
          ]"
          :key="t.k"
          class="flex-1 whitespace-nowrap text-xs px-3 py-2 rounded-lg font-medium"
          :class="tab === t.k ? 'bg-white dark:bg-slate-700 shadow-sm' : 'text-slate-500'"
          @click="tab = t.k as any"
        >
          {{ t.l }}
        </button>
      </div>

      <div v-show="tab === 'panel'">
        <SubjectPanel subject-id="english" />
      </div>

      <!-- 词汇 -->
      <div v-show="tab === 'vocab'" class="space-y-3">
        <div class="card">
          <div class="grid grid-cols-3 gap-3 text-center mb-3">
            <div>
              <div class="text-xl font-black text-emerald-500">{{ totalVocab }}</div>
              <div class="text-[11px] text-slate-400">累计新学词汇</div>
            </div>
            <div>
              <div class="text-xl font-black text-emerald-500">
                {{ eng.vocab.reduce((s, v) => s + v.reviewWords, 0) }}
              </div>
              <div class="text-[11px] text-slate-400">累计复习</div>
            </div>
            <div>
              <div class="text-xl font-black text-emerald-500">{{ eng.vocab.length }}</div>
              <div class="text-[11px] text-slate-400">打卡次数</div>
            </div>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="label">本次新学</label
              ><input v-model.number="newWords" type="number" min="0" class="input" />
            </div>
            <div>
              <label class="label">本次复习</label
              ><input v-model.number="reviewWords" type="number" min="0" class="input" />
            </div>
          </div>
          <button class="btn-primary w-full mt-3" @click="addVocab">
            打卡背单词（目标 {{ store.settings.wordGoal }} 个/天）
          </button>
          <p class="text-[10px] text-slate-400 mt-2">每完成一次背诵打卡，单独生成一条记录</p>
        </div>
        <!-- 墨墨背单词同步 -->
        <MaimemoPanel :syncing="syncing" @sync="syncMaimemo" />
        <div class="card">
          <div class="section-title">打卡记录</div>
          <div v-if="!eng.vocab.length" class="text-xs text-slate-400 text-center py-3">暂无打卡记录</div>
          <div class="space-y-1.5 max-h-72 overflow-y-auto">
            <div v-for="v in eng.vocab.slice().reverse()" :key="v.id" class="flex items-center gap-2 text-sm group">
              <span class="text-xs text-slate-400 w-20 shrink-0">{{ v.date }}</span>
              <span class="flex-1 text-xs"
                >新学 <b class="text-emerald-500">{{ v.newWords }}</b> · 复习
                <b class="text-emerald-500">{{ v.reviewWords }}</b></span
              >
              <span class="text-[10px] text-amber-500 shrink-0">+{{ v.points }} 积分</span>
              <button class="text-red-400 text-xs shrink-0" title="删除记录并回收积分" @click="delVocab(v.id)">
                删除
              </button>
            </div>
          </div>
        </div>
        <!-- 今日词汇打卡列表（表头与刷新按钮由组件内部统一管理） -->
        <div class="card !p-0 overflow-hidden">
          <VocabCheckList :words="todayWords" :loading="loadingWords" @refresh="loadTodayWords" />
        </div>

        <VocabChart />
      </div>

      <!-- 阅读 -->
      <div v-show="tab === 'reading'" class="space-y-3">
        <ReadingForm />
      </div>

      <!-- 听力 -->
      <div v-show="tab === 'listening'" class="space-y-3">
        <ListeningForm />
      </div>

      <!-- 作文模板 -->
      <div v-show="tab === 'templates'" class="space-y-3">
        <EssayTemplatePanel />
      </div>
    </template>
  </div>
</template>
