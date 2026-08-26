<script setup lang="ts">
/**
 * 词汇打卡列表组件
 * - 卡片分行布局，支持滚动、吸顶表头、毛玻璃效果
 * - 双模式：英译汉（看单词写释义）/ 汉译英（看释义拼单词），表头一键切换
 * - 点击主词条切换答案显隐，输入框回车/失焦触发校验
 * - 校验结果实时反馈（正确绿边+✓ / 错误红边+展示标准答案）
 * - 两种模式作答状态独立存储，任一模式答对即算掌握；持久化到 localStorage，刷新不丢失
 */
import { computed, ref, watch } from 'vue'
import { today } from '../utils/date'
import type { MaimemoWordDetail } from '../services/maimemo'
import PostComposer from './community/PostComposer.vue'

// ---- Props & Emits ----
const props = defineProps<{
  words: MaimemoWordDetail[]
  loading?: boolean
}>()

const emit = defineEmits<{
  (e: 'refresh'): void
}>()

// ---- 类型 ----
/** 校验状态：null=未校验 true=正确 false=错误 */
type ValidationResult = boolean | null

/** 练习模式：zh=英译汉（看英文写中文释义） en=汉译英（看中文写英文拼写） */
type Mode = 'zh' | 'en'

interface AnswerState {
  /** 用户填写的答案 */
  answer: string
  /** 校验结果 */
  validation: ValidationResult
  /** 是否展开显示标准答案 */
  show: boolean
}

/** 每个单词在两种模式下各自独立的作答状态 */
interface ModeStates {
  zh: AnswerState
  en: AnswerState
}

const emptyAnswer = (): AnswerState => ({ answer: '', validation: null, show: false })

// ---- 本地存储（按日期隔离，跨天由 English 页统一清理） ----
// 使用本地日期（与 English 页缓存键口径一致）；toISOString 为 UTC 日期，凌晨时段会错位一天
const STORAGE_KEY = `vocab-checkin:${today()}`
const MODE_KEY = 'vocab-checkin-mode'

function loadState(): Record<string, ModeStates> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const out: Record<string, ModeStates> = {}
    for (const [k, v] of Object.entries(parsed)) {
      if (!v || typeof v !== 'object') continue
      // 新格式：{ zh: {...}, en: {...} }
      if ('zh' in (v as Record<string, unknown>)) {
        out[k] = v as ModeStates
        continue
      }
      // 旧格式迁移：{ userAnswer, validation, showMeaning } → 英译汉模式
      const old = v as { userAnswer?: string; validation?: ValidationResult; showMeaning?: boolean }
      out[k] = {
        zh: { answer: old.userAnswer ?? '', validation: old.validation ?? null, show: !!old.showMeaning },
        en: emptyAnswer()
      }
    }
    return out
  } catch {
    return {}
  }
}

function persistState(map: Record<string, ModeStates>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
  } catch { /* 存储满时静默失败 */ }
}

function loadMode(): Mode {
  try {
    return localStorage.getItem(MODE_KEY) === 'en' ? 'en' : 'zh'
  } catch {
    return 'zh'
  }
}

// ---- 响应式状态 ----
const stateMap = ref<Record<string, ModeStates>>(loadState())
const mode = ref<Mode>(loadMode())

function setMode(m: Mode) {
  mode.value = m
  try { localStorage.setItem(MODE_KEY, m) } catch { /* 忽略 */ }
}

/** 获取某个单词的双模式状态（不存在则惰性初始化默认值） */
function getWord(vocId: string): ModeStates {
  if (!stateMap.value[vocId]) {
    stateMap.value[vocId] = { zh: emptyAnswer(), en: emptyAnswer() }
  }
  return stateMap.value[vocId]
}

/** 当前模式下某个单词的作答状态。getWord 惰性初始化保证永不返回 undefined，
 *  模板中 v-model 直接绑定其 .answer 字段（初始化与读取同一引用，安全） */
function ws(vocId: string): AnswerState {
  return getWord(vocId)[mode.value]
}

// 单词列表变化时：为所有单词预初始化状态并持久化（如刷新后重新拉取）。
// 预初始化保证 computed（validatedCount 等）中的 getWord 只做纯读取，不在计算期内修改状态
watch(() => props.words, (words) => {
  for (const w of words) getWord(w.vocId)
  persistState(stateMap.value)
}, { immediate: true })

// ---- 统计（按词去重：任一模式校验过/答对即计入） ----
const totalCount = computed(() => props.words.length)
const validatedCount = computed(() =>
  props.words.filter(w => {
    const s = getWord(w.vocId)
    return s.zh.validation !== null || s.en.validation !== null
  }).length
)
const correctCount = computed(() =>
  props.words.filter(w => {
    const s = getWord(w.vocId)
    return s.zh.validation === true || s.en.validation === true
  }).length
)
const progressPercent = computed(() =>
  totalCount.value ? Math.round((validatedCount.value / totalCount.value) * 100) : 0
)

// ---- 分享打卡成果到社区广场 ----
const showShare = ref(false)
const shareContent = computed(() => [
  '今日背单词打卡',
  `已校验 ${validatedCount.value}/${totalCount.value} · 答对 ${correctCount.value} 个（进度 ${progressPercent.value}%）`
].join('\n'))

// ---- 语义校验（英译汉） ----
/** 常见中文虚词/连接字，匹配时降权处理 */
const STOP_CHARS = new Set('的地得着了过在和与或及而其又因所以但是如果就是都也很还'.split(''))

/** 提取有效字符：去除标点/空白/英文，保留中文实义字 */
function extractChars(text: string): string[] {
  return text
    .replace(/[\s\p{P}\p{S}a-zA-Z0-9]/gu, '')
    .split('')
    .filter(c => c && !STOP_CHARS.has(c))
}

/** 语义匹配：核心含义命中即判正确（不需要一字不差） */
function semanticMatch(userInput: string, standard: string): boolean {
  const user = userInput.trim()
  const std = standard.trim()
  if (!user || !std) return false

  // 完全一致直接通过
  if (user === std) return true

  const userChars = extractChars(user)
  const stdChars = extractChars(std)
  if (!userChars.length || !stdChars.length) return false

  // 标准释义中的关键字符在用户输入中的命中率
  const hitCount = stdChars.filter(c => user.includes(c)).length
  const hitRatio = hitCount / stdChars.length

  // 用户输入与标准释义有任一 2+ 字连续子串匹配
  const hasSubstring = stdChars.some((_, i) => {
    if (i + 2 > stdChars.length) return false
    return user.includes(stdChars.slice(i, i + 2).join(''))
  })

  // 命中率 ≥50% 或存在语义子串 → 判定正确
  return hitRatio >= 0.5 || hasSubstring
}

// ---- 拼写校验（汉译英）：忽略大小写与首尾空格，严格一致 ----
function spellingMatch(userInput: string, spelling: string): boolean {
  const user = userInput.trim().toLowerCase()
  const std = spelling.trim().toLowerCase()
  return !!user && !!std && user === std
}

// ---- 交互方法 ----
/** 切换标准答案显隐 */
function toggleAnswer(vocId: string) {
  const w = ws(vocId)
  w.show = !w.show
  persistState(stateMap.value)
}

/** 触发校验（回车 / 失焦），按当前模式选择判题规则 */
function validate(word: MaimemoWordDetail) {
  const w = ws(word.vocId)
  const input = w.answer.trim()
  if (!input) { w.validation = null; persistState(stateMap.value); return }
  w.validation = mode.value === 'zh'
    ? semanticMatch(input, word.meaning)
    : spellingMatch(input, word.spelling)
  persistState(stateMap.value)
}

/** 输入变化时重置校验状态（等待下次触发） */
function onInput(vocId: string) {
  const w = ws(vocId)
  w.validation = null
  persistState(stateMap.value)
}

/** 输入框样式类 */
function inputClass(w: AnswerState): string {
  const base = 'w-full rounded-xl px-3 py-2 text-sm outline-none transition-all duration-300 border bg-white/80 dark:bg-slate-700/80 dark:text-slate-100'
  if (w.validation === true) return `${base} border-emerald-400 dark:border-emerald-500 ring-2 ring-emerald-100 dark:ring-emerald-900/30`
  if (w.validation === false) return `${base} border-red-400 dark:border-red-500 ring-2 ring-red-100 dark:ring-red-900/30`
  return `${base} border-slate-200 dark:border-slate-600 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:focus:ring-indigo-900/30`
}
</script>

<template>
  <div class="relative rounded-2xl overflow-hidden">
    <!-- 渐变背景 -->
    <div class="absolute inset-0 bg-gradient-to-br from-indigo-50/80 via-white to-violet-50/60 dark:from-slate-800 dark:via-slate-800 dark:to-slate-900 pointer-events-none" />

    <!-- 吸顶表头（毛玻璃）：标题 + 模式切换 + 校验统计 + 进度 + 拉取/刷新入口 -->
    <div class="sticky top-0 z-10 backdrop-blur-xl bg-white/70 dark:bg-slate-800/70 border-b border-white/30 dark:border-slate-700/50 px-4 py-3">
      <div class="flex items-center justify-between gap-2">
        <div class="flex items-center gap-3 min-w-0">
          <h3 class="text-sm font-bold text-slate-700 dark:text-slate-200 shrink-0">今日词汇打卡</h3>
          <!-- 模式切换：英译汉 / 汉译英 -->
          <div class="flex shrink-0 rounded-lg bg-slate-100 dark:bg-slate-700 p-0.5 text-[11px] font-medium">
            <button
              class="px-2.5 py-1 rounded-md transition-all duration-300"
              :class="mode === 'zh'
                ? 'bg-white dark:bg-slate-600 text-indigo-600 dark:text-indigo-300 shadow-sm'
                : 'text-slate-400 dark:text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'"
              @click="setMode('zh')"
            >英译汉</button>
            <button
              class="px-2.5 py-1 rounded-md transition-all duration-300"
              :class="mode === 'en'
                ? 'bg-white dark:bg-slate-600 text-indigo-600 dark:text-indigo-300 shadow-sm'
                : 'text-slate-400 dark:text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'"
              @click="setMode('en')"
            >汉译英</button>
          </div>
          <span class="text-[10px] text-slate-400 dark:text-slate-500 truncate">
            {{ validatedCount }}/{{ totalCount }} 已校验 · {{ correctCount }} 正确
          </span>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <!-- 进度条 -->
          <div class="w-16 sm:w-20 h-1.5 rounded-full bg-slate-200 dark:bg-slate-600 overflow-hidden">
            <div
              class="h-full rounded-full bg-gradient-to-r from-indigo-400 to-violet-400 transition-all duration-500"
              :style="{ width: `${progressPercent}%` }"
            />
          </div>
          <span class="text-[10px] font-semibold text-indigo-500 dark:text-indigo-400">{{ progressPercent }}%</span>
          <!-- 分享到社区广场 -->
          <button
            v-if="totalCount"
            class="text-[11px] px-2.5 py-1 rounded-lg bg-white/80 dark:bg-slate-700 text-indigo-500 dark:text-indigo-300 border border-indigo-200 dark:border-slate-600 hover:bg-indigo-50 dark:hover:bg-slate-600 active:scale-95 transition-all duration-300"
            @click="showShare = true"
          >分享</button>
          <!-- 拉取/刷新 -->
          <button
            class="text-[11px] px-2.5 py-1 rounded-lg bg-indigo-500 text-white hover:bg-indigo-600 active:scale-95 transition-all duration-300 disabled:opacity-50"
            :disabled="loading"
            @click="emit('refresh')"
          >{{ loading ? '拉取中…' : words.length ? '刷新' : '拉取单词' }}</button>
        </div>
      </div>
    </div>

    <!-- 滚动区域（顶部/底部渐变遮罩） -->
    <div class="relative">
      <!-- 顶部遮罩 -->
      <div class="absolute top-0 left-0 right-0 h-6 bg-gradient-to-b from-white/90 dark:from-slate-800/90 to-transparent z-[5] pointer-events-none" />

      <!-- 列表容器 -->
      <div
        class="vocab-scroll max-h-[420px] overflow-y-auto overscroll-contain px-3 py-3 space-y-2.5"
        :class="{ 'opacity-50 pointer-events-none': loading }"
      >
        <!-- 空状态 -->
        <div v-if="!words.length && !loading" class="text-center py-12">
          <div class="text-3xl mb-3">📝</div>
          <p class="text-sm text-slate-400 dark:text-slate-500">暂无今日单词数据</p>
          <p class="text-[11px] text-slate-300 dark:text-slate-600 mt-1">请先在墨墨 App 中完成今日学习并开启自动同步</p>
          <button
            class="mt-4 text-xs px-4 py-2 rounded-xl bg-indigo-500 text-white hover:bg-indigo-600 transition-colors duration-300"
            @click="emit('refresh')"
          >重新拉取</button>
        </div>

        <!-- 加载骨架 -->
        <div v-else-if="loading" class="space-y-2.5">
          <div v-for="i in 5" :key="i" class="h-[72px] rounded-2xl bg-white/60 dark:bg-slate-700/40 animate-pulse" />
        </div>

        <!-- 单词卡片列表 -->
        <div
          v-for="word in words"
          :key="word.vocId"
          class="group relative rounded-2xl bg-white/80 dark:bg-slate-700/60 border border-slate-100/80 dark:border-slate-600/50 p-3.5 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-indigo-100/50 dark:hover:shadow-slate-900/50"
        >
          <div class="flex items-start gap-3">
            <!-- 左侧：主词条 + 标签 -->
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 flex-wrap">
                <!-- 主词条（点击切换答案显隐）：英译汉显示单词，汉译英显示释义 -->
                <button
                  class="text-base font-bold text-slate-800 dark:text-slate-100 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors duration-300 cursor-pointer select-none text-left"
                  @click="toggleAnswer(word.vocId)"
                >{{ mode === 'zh' ? word.spelling : (word.meaning || '暂无释义') }}</button>

                <!-- 新学 / 复习标签 -->
                <span
                  v-if="word.isNew"
                  class="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-gradient-to-r from-amber-400 to-orange-400 text-white shadow-sm shadow-amber-200/50"
                >NEW</span>
                <span
                  v-else
                  class="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-600 text-slate-400 dark:text-slate-400"
                >复习</span>

                <!-- 完成状态小标记 -->
                <span
                  v-if="word.isFinished"
                  class="text-[9px] text-emerald-500 dark:text-emerald-400"
                  title="墨墨已完成"
                >✓</span>
              </div>

              <!-- 标准答案（点击主词条后展开，淡入淡出） -->
              <Transition name="meaning">
                <p
                  v-if="ws(word.vocId).show"
                  class="mt-1.5 text-xs text-slate-500 dark:text-slate-400 leading-relaxed"
                >{{ mode === 'zh' ? (word.meaning || '暂无释义') : (word.spelling || '暂无') }}</p>
              </Transition>
            </div>

            <!-- 右侧：输入区 -->
            <div class="w-[45%] sm:w-[40%] shrink-0">
              <div class="relative">
                <input
                  v-model="ws(word.vocId).answer"
                  :class="inputClass(ws(word.vocId))"
                  :placeholder="mode === 'zh' ? '输入释义…' : '输入英文单词…'"
                  @input="onInput(word.vocId)"
                  @keydown.enter="validate(word)"
                  @blur="validate(word)"
                />
                <!-- 校验成功图标 -->
                <Transition name="pop">
                  <span
                    v-if="ws(word.vocId).validation === true"
                    class="absolute right-2.5 top-1/2 -translate-y-1/2 text-emerald-500 text-sm pointer-events-none"
                  >✓</span>
                </Transition>
              </div>

              <!-- 校验失败：展示标准答案（不覆盖用户输入） -->
              <Transition name="meaning">
                <p
                  v-if="ws(word.vocId).validation === false"
                  class="mt-1.5 text-[11px] text-red-400 dark:text-red-400 leading-relaxed"
                >
                  <template v-if="mode === 'zh'">
                    <span class="text-slate-400 dark:text-slate-500">标准释义：</span>{{ word.meaning || '暂无' }}
                  </template>
                  <template v-else>
                    <span class="text-slate-400 dark:text-slate-500">正确拼写：</span>{{ word.spelling || '暂无' }}
                  </template>
                </p>
              </Transition>
            </div>
          </div>
        </div>
      </div>

      <!-- 底部遮罩 -->
      <div class="absolute bottom-0 left-0 right-0 h-6 bg-gradient-to-t from-white/90 dark:from-slate-800/90 to-transparent z-[5] pointer-events-none" />
    </div>

    <!-- 背单词成果分享 -->
    <PostComposer v-model:show="showShare" type="checkin" ref-type="vocab"
      :preset-content="shareContent" :preset-tags="['#每日打卡', '#英语']" />
  </div>
</template>

<style scoped>
/* 自定义滚动条 */
.vocab-scroll::-webkit-scrollbar {
  width: 5px;
}
.vocab-scroll::-webkit-scrollbar-track {
  background: transparent;
}
.vocab-scroll::-webkit-scrollbar-thumb {
  @apply bg-indigo-200 dark:bg-slate-600 rounded-full;
}
.vocab-scroll::-webkit-scrollbar-thumb:hover {
  @apply bg-indigo-300 dark:bg-slate-500;
}

/* 释义展开/收起过渡 */
.meaning-enter-active {
  transition: all 0.3s ease;
}
.meaning-leave-active {
  transition: all 0.2s ease;
}
.meaning-enter-from,
.meaning-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

/* 校验成功图标弹性缩放 */
.pop-enter-active {
  animation: pop-in 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.pop-leave-active {
  transition: opacity 0.15s ease;
}
.pop-leave-to {
  opacity: 0;
}

@keyframes pop-in {
  0% { transform: translateY(-50%) scale(0.3); opacity: 0; }
  60% { transform: translateY(-50%) scale(1.15); }
  100% { transform: translateY(-50%) scale(1); opacity: 1; }
}
</style>
