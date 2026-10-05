<script setup lang="ts">
import { ArrowRight } from '@lucide/vue'
import EmptyState from '../shared/components/EmptyState.vue'
import { computed, ref, watch, onMounted } from 'vue'
import { getErrorMessage } from '../utils/error'
import { useToast } from '../composables/useToast'
import { useConfirm } from '../composables/useConfirm'
import { useRoute } from 'vue-router'
import { useAppStore } from '../stores/app'
import SubjectPanel from '../components/SubjectPanel.vue'
import AppTabs from '../shared/components/AppTabs.vue'
import { today } from '../utils/date'
import { fetchMaimemoToday, fetchMaimemoTodayDetail } from '../services/maimemo'
import type { MaimemoWordDetail } from '../services/maimemo'
import VocabCheckList from '../components/VocabCheckList.vue'
import MaimemoPanel from '../components/english/MaimemoPanel.vue'
import VocabChart from '../components/english/VocabChart.vue'
import ReadingForm from '../components/english/ReadingForm.vue'
import ListeningForm from '../components/english/ListeningForm.vue'
import EssayTemplatePanel from '../components/english/EssayTemplatePanel.vue'
import { sessionUser } from '../services/auth'
import { vocabError } from '../utils/studyValidation'

const store = useAppStore()
const route = useRoute()
const toast = useToast()
const confirm = useConfirm()
const eng = computed(() => store.english)
// 「英语」科目可能被用户在设置页删除，此时页面整体隐藏
const subjectExists = computed(() => !!store.subjectMap.english)

const tab = ref<'panel' | 'vocab' | 'reading' | 'listening' | 'templates'>('panel')
function selectTab(value: string) {
  tab.value = value as typeof tab.value
}
onMounted(() => {
  const t = route.query.tab as string
  if (['panel', 'vocab', 'reading', 'listening', 'templates'].includes(t)) {
    tab.value = t as typeof tab.value
  }
})

// ---- 词汇（逐条打卡记录） ----
const newWords = ref(30)
const reviewWords = ref(50)
let lastVocabSavedAt = 0
function addVocab() {
  if (Date.now() - lastVocabSavedAt < 1200) return
  const n = newWords.value,
    r = reviewWords.value
  const error = vocabError(n, r)
  if (error) {
    toast(error)
    return
  }
  // 每完成一次背诵单独生成一条打卡记录
  store.addVocabRecord(n, r)
  lastVocabSavedAt = Date.now()
  toast('单词已打卡')
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
  const syncDate = store.todayKey
  const syncOwner = sessionUser.value?.id
  try {
    const data = await fetchMaimemoToday()
    if (store.todayKey !== syncDate || sessionUser.value?.id !== syncOwner) return
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
/** 今日单词本地缓存键（按账号和日期隔离） */
const cacheOwner = sessionUser.value?.id ?? 'guest'
const WORDS_CACHE_KEY = computed(() => `maimemo-today-words:${cacheOwner}:${store.todayKey}`)

/** 从本地缓存恢复今日单词（界面切换/页面跳转/组件卸载后自动恢复） */
function loadCachedWords(): MaimemoWordDetail[] {
  try {
    const raw = localStorage.getItem(WORDS_CACHE_KEY.value)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed)
      ? parsed.filter(
          (w): w is MaimemoWordDetail =>
            !!w &&
            typeof w === 'object' &&
            typeof w.vocId === 'string' &&
            typeof w.spelling === 'string' &&
            typeof w.meaning === 'string' &&
            typeof w.isNew === 'boolean' &&
            typeof w.isFinished === 'boolean'
        )
      : []
  } catch {
    return []
  }
}

/** 拉取成功后立即持久化，保证数据可靠性 */
function persistWords(words: MaimemoWordDetail[]) {
  try {
    localStorage.setItem(WORDS_CACHE_KEY.value, JSON.stringify(words))
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
      if (k && (k.startsWith('maimemo-today-words:') || k.startsWith('vocab-checkin:')) && !k.endsWith(store.todayKey))
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
watch(
  () => store.todayKey,
  () => {
    todayWords.value = loadCachedWords()
    cleanStaleVocabCache()
  }
)
const loadingWords = ref(false)

/** 拉取墨墨今日全部单词明细（含释义），供打卡列表使用 */
async function loadTodayWords() {
  if (!store.settings.maimemoConnected) {
    toast('请先填写并保存墨墨开放 API Token')
    return
  }
  if (loadingWords.value) return
  loadingWords.value = true
  const requestDate = store.todayKey
  try {
    const words = await fetchMaimemoTodayDetail()
    if (store.todayKey !== requestDate || sessionUser.value?.id !== cacheOwner) return
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
  <div class="study-page">
    <div v-if="!subjectExists" class="card text-center py-16 text-slate-400">
      <p class="text-sm">「英语」科目已被删除，此页面已隐藏</p>
      <RouterLink to="/settings" class="text-action text-xs underline mt-2 inline-block arrow-link"
        >前往设置页管理科目 <ArrowRight class="arrow-inline" :size="16" aria-hidden="true"
      /></RouterLink>
    </div>
    <template v-else>
      <header class="study-page-heading mb-6">
        <div>
          <h1 class="page-title">英语</h1>
          <p class="mt-1 text-sm text-muted">安排复习，记录词汇、阅读与听力练习。</p>
        </div>
      </header>

      <AppTabs
        id="english"
        :model-value="tab"
        :items="[
          { value: 'panel', label: '复习总览' },
          { value: 'vocab', label: '词汇' },
          { value: 'reading', label: '阅读' },
          { value: 'listening', label: '听力' },
          { value: 'templates', label: '作文模板' }
        ]"
        label="英语学习内容"
        panel-per-tab
        class="mb-5"
        @update:model-value="selectTab"
      />

      <div
        v-show="tab === 'panel'"
        id="english-panel-panel"
        role="tabpanel"
        aria-labelledby="english-tab-panel"
        class="panel-reveal space-y-3"
      >
        <SubjectPanel subject-id="english" />
      </div>

      <!-- 词汇 -->
      <div
        v-show="tab === 'vocab'"
        id="english-panel-vocab"
        role="tabpanel"
        aria-labelledby="english-tab-vocab"
        class="panel-reveal space-y-3"
      >
        <div class="card">
          <div class="english-section-heading">
            <div>
              <h2 class="section-title !mb-1">记录本次背诵</h2>
              <p class="text-xs text-muted">今日目标 {{ store.settings.wordGoal }} 个，每次背诵分别记录。</p>
            </div>
          </div>
          <dl class="vocab-summary">
            <div>
              <dt>累计新学</dt>
              <dd>{{ totalVocab }} <span>词</span></dd>
            </div>
            <div>
              <dt>累计复习</dt>
              <dd>{{ eng.vocab.reduce((s, v) => s + v.reviewWords, 0) }} <span>词</span></dd>
            </div>
            <div>
              <dt>打卡记录</dt>
              <dd>{{ eng.vocab.length }} <span>次</span></dd>
            </div>
          </dl>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="label" for="en-vocab-new">本次新学</label
              ><input id="en-vocab-new" v-model.number="newWords" type="number" min="0" class="input" />
            </div>
            <div>
              <label class="label" for="en-vocab-review">本次复习</label
              ><input id="en-vocab-review" v-model.number="reviewWords" type="number" min="0" class="input" />
            </div>
          </div>
          <button class="btn-primary mt-4" @click="addVocab">保存背单词打卡</button>
        </div>
        <!-- 墨墨背单词同步 -->
        <MaimemoPanel :syncing="syncing" @sync="syncMaimemo" />
        <div class="card">
          <h2 class="section-title">打卡记录</h2>
          <EmptyState v-if="!eng.vocab.length" title="还没有单词打卡，完成背诵后在上方打卡。" />
          <div class="space-y-1.5 max-h-72 overflow-y-auto">
            <div v-for="v in eng.vocab.slice().reverse()" :key="v.id" class="vocab-record">
              <span class="text-xs text-slate-400 w-20 shrink-0">{{ v.date }}</span>
              <span class="flex-1 text-xs"
                >新学 <b class="text-action">{{ v.newWords }}</b> · 复习
                <b class="text-action">{{ v.reviewWords }}</b></span
              >
              <span class="text-xs text-muted shrink-0">+{{ v.points }} 积分</span>
              <button class="text-correction text-xs shrink-0" title="删除记录并回收积分" @click="delVocab(v.id)">
                删除
              </button>
            </div>
          </div>
        </div>
        <!-- 今日词汇打卡列表（表头与刷新按钮由组件内部统一管理） -->
        <div class="card !p-0 overflow-hidden">
          <VocabCheckList :key="store.todayKey" :words="todayWords" :loading="loadingWords" @refresh="loadTodayWords" />
        </div>

        <VocabChart />
      </div>

      <!-- 阅读 -->
      <div
        v-show="tab === 'reading'"
        id="english-panel-reading"
        role="tabpanel"
        aria-labelledby="english-tab-reading"
        class="panel-reveal space-y-3"
      >
        <ReadingForm />
      </div>

      <!-- 听力 -->
      <div
        v-show="tab === 'listening'"
        id="english-panel-listening"
        role="tabpanel"
        aria-labelledby="english-tab-listening"
        class="panel-reveal space-y-3"
      >
        <ListeningForm />
      </div>

      <!-- 作文模板 -->
      <div
        v-show="tab === 'templates'"
        id="english-panel-templates"
        role="tabpanel"
        aria-labelledby="english-tab-templates"
        class="panel-reveal space-y-3"
      >
        <EssayTemplatePanel />
      </div>
    </template>
  </div>
</template>

<style scoped>
.english-section-heading {
  margin-bottom: 16px;
}
.vocab-summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
  margin-bottom: 20px;
  padding-block: 12px;
  border-block: 1px solid var(--line);
}
.vocab-summary dt {
  font-size: 12px;
  color: var(--muted);
}
.vocab-summary dd {
  margin-top: 4px;
  font-size: 18px;
  font-weight: 700;
  color: var(--ink);
}
.vocab-summary dd span {
  font-size: 12px;
  font-weight: 400;
  color: var(--muted);
}
.vocab-record {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding-block: 8px;
  border-bottom: 1px solid var(--line);
}
.vocab-record:last-child {
  border-bottom: 0;
}
@media (max-width: 480px) {
  .vocab-summary {
    gap: 8px;
  }
  .vocab-record > :nth-child(2) {
    min-width: 110px;
  }
}
</style>
