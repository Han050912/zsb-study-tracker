<script setup lang="ts">
import { computed, inject, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAppStore } from '../stores/app'
import { today, formatMinutes } from '../utils/date'
import { useChart, chartTextColor } from '../composables/useChart'
import { problemTypesFor } from '../data/problemTypes'
import StarRating from './StarRating.vue'
import Modal from './Modal.vue'
import type { Note, TopicImportance } from '../types'

const props = defineProps<{ subjectId: string }>()
const store = useAppStore()
const toast = inject<(m: string) => void>('toast', () => {})

const subject = computed(() => store.subjectMap[props.subjectId])
const tab = ref<'chapters' | 'records' | 'problems' | 'exams' | 'notes'>('chapters')

const subjectRecords = computed(() => store.records.filter(r => r.subjectId === props.subjectId).slice().reverse())
const subjectProblems = computed(() => store.problemSessions.filter(p => p.subjectId === props.subjectId).slice().reverse())
const subjectExams = computed(() => store.exams.filter(e => e.subjectId === props.subjectId).slice().reverse())
const subjectNotes = computed(() => store.notes.filter(n => n.subjectId === props.subjectId))

// ---- 学习记录（含计时器） ----
const recMinutes = ref(30)
const recChapter = ref('')
const recTopic = ref('')
const recNote = ref('')
const timerRunning = ref(false)
const timerSeconds = ref(0)
let timerHandle: ReturnType<typeof setInterval> | null = null

function startTimer() {
  timerRunning.value = true
  timerHandle = setInterval(() => timerSeconds.value++, 1000)
}
function pauseTimer() {
  timerRunning.value = false
  if (timerHandle) clearInterval(timerHandle)
}
function stopTimer() {
  pauseTimer()
  recMinutes.value = Math.max(1, Math.round(timerSeconds.value / 60))
  timerSeconds.value = 0
  toast(`计时结束：${recMinutes.value} 分钟`)
}
function fmtTimer(s: number) {
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

function addRecord() {
  if (recMinutes.value <= 0) return
  store.addRecord({
    subjectId: props.subjectId, date: today(), minutes: recMinutes.value,
    chapterId: recChapter.value || undefined, topic: recTopic.value || undefined, note: recNote.value || undefined
  })
  recNote.value = ''
  toast(`已记录 ${recMinutes.value} 分钟学习 +积分`)
}

// ---- 刷题（题型模板按科目适配：数学/英语/通用，见 data/problemTypes.ts） ----
const typeDefs = computed(() => problemTypesFor(props.subjectId))
const pTotal = ref(20)
const pCorrect = ref(15)
const pTypes = ref<Record<string, number>>({})
function addProblems() {
  if (pTotal.value <= 0) return
  store.addProblemSession({ subjectId: props.subjectId, date: today(), total: pTotal.value, correct: Math.min(pCorrect.value, pTotal.value), types: { ...pTypes.value } })
  pTypes.value = {}
  toast('刷题记录已保存')
}
const accuracy = computed(() => {
  const t = subjectProblems.value.reduce((s, p) => s + p.total, 0)
  const c = subjectProblems.value.reduce((s, p) => s + p.correct, 0)
  return t ? Math.round((c / t) * 100) : 0
})

// ---- 掌握度雷达 ----
const radarTopics = computed(() => {
  const s = subject.value
  if (!s) return []
  return s.chapters.flatMap(c => c.topics).slice(0, 8)
})
/** 掌握度数值快照：computed 读取每个 topic 的掌握度，属性变更时重算并产出新数组（配合 useChart 浅监听触发重绘） */
const radarValues = computed(() => radarTopics.value.map(t => subject.value?.mastery[t] || 0))
const { el: radarEl } = useChart(() => ({
  radar: {
    indicator: radarTopics.value.map(t => ({ name: t, max: 5 })),
    radius: '65%',
    axisName: { color: chartTextColor(), fontSize: 10 }
  },
  series: [{
    type: 'radar',
    data: [{
      value: radarValues.value,
      name: '掌握度',
      areaStyle: { color: (subject.value?.color || '#3b82f6') + '44' },
      lineStyle: { color: subject.value?.color || '#3b82f6' },
      itemStyle: { color: subject.value?.color || '#3b82f6' }
    }]
  }]
}), [radarTopics, radarValues])

// ---- 真题 ----
const showExamModal = ref(false)
const examForm = ref({ title: '', score: 100, totalScore: 150, minutes: 120 })
function addExam() {
  if (!examForm.value.title) return
  store.addExam({ subjectId: props.subjectId, date: today(), ...examForm.value })
  showExamModal.value = false
  examForm.value = { title: '', score: 100, totalScore: 150, minutes: 120 }
  toast('真题记录已保存')
}
const { el: examTrendEl } = useChart(() => ({
  grid: { left: 40, right: 16, top: 20, bottom: 24 },
  xAxis: { type: 'category', data: subjectExams.value.slice().reverse().map(e => e.date), axisLabel: { color: chartTextColor(), fontSize: 10 } },
  yAxis: { type: 'value', axisLabel: { color: chartTextColor() } },
  series: [{ type: 'line', smooth: true, data: subjectExams.value.slice().reverse().map(e => Math.round(e.score / e.totalScore * 100)), name: '得分率%', lineStyle: { color: subject.value?.color }, itemStyle: { color: subject.value?.color }, areaStyle: { opacity: 0.15 } }],
  tooltip: { trigger: 'axis' }
}), [subjectExams])

// ---- 笔记（点击跳转全屏笔记页面，弹窗编辑已废弃） ----
const router = useRouter()
function openNote(n?: Note) {
  if (n) router.push({ path: '/notes', query: { id: n.id } })
  else router.push({ path: '/notes', query: { new: '1', subject: props.subjectId } })
}
const noteSearch = ref('')
const filteredNotes = computed(() => {
  const kw = noteSearch.value.trim().toLowerCase()
  if (!kw) return subjectNotes.value
  return subjectNotes.value.filter(n =>
    n.title.toLowerCase().includes(kw) || n.content.toLowerCase().includes(kw) || n.tags.some(t => t.toLowerCase().includes(kw)))
})

// ---- 笔记文件导入（手动选择上传 + 拖拽上传，两种方式并行可用） ----
const noteFileInput = ref<HTMLInputElement>()
const noteDragging = ref(false)
/** 拖拽深度计数：dragleave 会在子元素间冒泡，计数归零才取消高亮，避免闪烁 */
let dragDepth = 0
/** 允许导入的文本文件扩展名（拖拽会绕过 input accept，需手动校验） */
const NOTE_FILE_EXTS = ['.md', '.markdown', '.txt']

/** 读取本地文本文件并批量创建笔记（文件名作为标题）；全部读取完成后一次性持久化 */
async function importNoteFiles(files: FileList | File[] | null) {
  if (!files || !files.length) return
  const items: { title: string; content: string; tags: string[] }[] = []
  for (const file of Array.from(files)) {
    const dot = file.name.lastIndexOf('.')
    const ext = dot > 0 ? file.name.slice(dot).toLowerCase() : ''
    if (!NOTE_FILE_EXTS.includes(ext)) {
      toast(`「${file.name}」格式不支持，仅接受 .md / .markdown / .txt 文本文件`)
      continue
    }
    if (file.size > 1024 * 1024) {
      toast(`「${file.name}」超过 1MB，已跳过`)
      continue
    }
    try {
      const content = await file.text()
      if (!content.trim()) {
        toast(`「${file.name}」内容为空，已跳过`)
        continue
      }
      items.push({ title: file.name.replace(/\.[^.]+$/, ''), content, tags: ['导入'] })
    } catch {
      toast(`读取「${file.name}」失败`)
    }
  }
  if (!items.length) return
  store.importNotes(props.subjectId, items)
  toast(`已导入 ${items.length} 篇笔记`)
}

function onNoteFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  importNoteFiles(input.files)
  input.value = '' // 允许重复选择同一文件
}

function onNoteDragEnter() {
  dragDepth++
  noteDragging.value = true
}
function onNoteDragLeave() {
  dragDepth = Math.max(0, dragDepth - 1)
  if (dragDepth === 0) noteDragging.value = false
}
function onNoteDrop(e: DragEvent) {
  dragDepth = 0
  noteDragging.value = false
  importNoteFiles(e.dataTransfer?.files || null)
}

/** 拖拽中途取消（Esc 等）时可靠重置高亮状态；OS 文件拖拽不触发文档内 dragend，需 window 级兜底 */
function resetDragState() {
  dragDepth = 0
  noteDragging.value = false
}
function onWindowDragLeave(e: DragEvent) {
  // relatedTarget 为 null 表示拖拽已离开窗口
  if (!e.relatedTarget) resetDragState()
}
onMounted(() => {
  window.addEventListener('dragend', resetDragState)
  window.addEventListener('drop', resetDragState)
  window.addEventListener('dragleave', onWindowDragLeave)
})
onUnmounted(() => {
  window.removeEventListener('dragend', resetDragState)
  window.removeEventListener('drop', resetDragState)
  window.removeEventListener('dragleave', onWindowDragLeave)
})

// ---- 章节管理 ----
const newChapter = ref('')
function addChapter() {
  if (!newChapter.value.trim()) return
  store.addChapter(props.subjectId, newChapter.value.trim())
  newChapter.value = ''
  toast('章节已添加，展开后可添加知识点')
}

// ---- 章节标题行内编辑（双击标题或点击编辑按钮进入编辑态） ----
const editingChapterId = ref('')
const editingChapterName = ref('')
/** 输入框挂载后自动聚焦并全选，提升编辑流畅度 */
const vFocus = {
  mounted: (el: HTMLInputElement) => { el.focus(); el.select() }
}
function startEditChapter(ch: { id: string; name: string }) {
  editingChapterId.value = ch.id
  editingChapterName.value = ch.name
}
function saveChapterName(chapterId: string) {
  // Enter 与 blur 可能连续触发，幂等守卫避免重复保存
  if (editingChapterId.value !== chapterId) return
  const name = editingChapterName.value.trim()
  const oldName = subject.value?.chapters.find(c => c.id === chapterId)?.name
  if (name && name !== oldName) {
    if (store.updateChapter(props.subjectId, chapterId, name)) toast('章节标题已更新')
  }
  editingChapterId.value = ''
}
function cancelEditChapter() {
  editingChapterId.value = ''
}

// ---- 知识点（小标题）管理 ----
const newTopic = ref<Record<string, string>>({})
function addTopic(chapterId: string) {
  const t = (newTopic.value[chapterId] || '').trim()
  if (!t) return
  store.addTopic(props.subjectId, chapterId, t)
  newTopic.value[chapterId] = ''
  toast('知识点已添加')
}
function removeTopic(chapterId: string, topic: string) {
  store.removeTopic(props.subjectId, chapterId, topic)
  toast('已删除')
}

// ---- 知识点重要程度 + 双击编辑 ----
const IMPORTANCE_OPTIONS: { k: TopicImportance; l: string; cls: string }[] = [
  { k: 'normal', l: '普通', cls: 'text-slate-400 bg-slate-100 dark:bg-slate-700' },
  { k: 'important', l: '重要', cls: 'text-amber-500 bg-amber-50 dark:bg-amber-900/30' },
  { k: 'must', l: '必考', cls: 'text-red-500 bg-red-50 dark:bg-red-900/30' }
]
function importanceOf(topic: string): TopicImportance {
  return subject.value?.topicImportance?.[topic] || 'normal'
}
function importanceMeta(topic: string) {
  return IMPORTANCE_OPTIONS.find(o => o.k === importanceOf(topic)) || IMPORTANCE_OPTIONS[0]
}

const showTopicModal = ref(false)
const editTopic = ref<{ chapterId: string; old: string; text: string; importance: TopicImportance }>({
  chapterId: '', old: '', text: '', importance: 'normal'
})
function openTopicEdit(chapterId: string, topic: string) {
  editTopic.value = { chapterId, old: topic, text: topic, importance: importanceOf(topic) }
  showTopicModal.value = true
}
function saveTopicEdit() {
  const text = editTopic.value.text.trim()
  if (!text) { toast('知识点内容不能为空'); return }
  const ok = store.updateTopic(props.subjectId, editTopic.value.chapterId, editTopic.value.old, text, editTopic.value.importance)
  if (!ok) { toast('保存失败：与本章节其他知识点重名'); return }
  showTopicModal.value = false
  toast('知识点已更新')
}
function removeChapter(chapterId: string) {
  if (!window.confirm('删除该章节及其全部知识点？')) return
  store.removeChapter(props.subjectId, chapterId)
  toast('章节已删除')
}

const expanded = ref<Record<string, boolean>>({})
const totalMin = computed(() => subjectRecords.value.reduce((s, r) => s + r.minutes, 0))
</script>

<template>
  <div v-if="subject" class="space-y-4">
    <!-- 概览 -->
    <div class="grid grid-cols-3 gap-3">
      <div class="card !p-3 text-center">
        <div class="text-xl font-black" :style="{ color: subject.color }">{{ formatMinutes(totalMin) }}</div>
        <div class="text-[11px] text-slate-400">累计学习</div>
      </div>
      <div class="card !p-3 text-center">
        <div class="text-xl font-black" :style="{ color: subject.color }">{{ subjectProblems.reduce((s, p) => s + p.total, 0) }}</div>
        <div class="text-[11px] text-slate-400">累计刷题</div>
      </div>
      <div class="card !p-3 text-center">
        <div class="text-xl font-black" :style="{ color: subject.color }">{{ accuracy }}%</div>
        <div class="text-[11px] text-slate-400">总正确率</div>
      </div>
    </div>

    <!-- Tab -->
    <div class="flex gap-1 overflow-x-auto bg-slate-100 dark:bg-slate-800 rounded-xl p-1">
      <button v-for="t in [
        { k: 'chapters', l: '📚 章节掌握' }, { k: 'records', l: '⏱ 学习记录' },
        { k: 'problems', l: '✏️ 刷题' }, { k: 'exams', l: '📄 真题' }, { k: 'notes', l: '📝 笔记' }
      ]" :key="t.k" class="flex-1 whitespace-nowrap text-xs px-3 py-2 rounded-lg font-medium transition-colors"
        :class="tab === t.k ? 'bg-white dark:bg-slate-700 shadow-sm' : 'text-slate-500'"
        @click="tab = t.k as any">{{ t.l }}</button>
    </div>

    <!-- 章节树 + 掌握度 -->
    <div v-show="tab === 'chapters'" class="space-y-3">
      <div v-if="radarTopics.length" class="card">
        <div class="section-title">🎯 掌握度雷达（薄弱环节一目了然）</div>
        <div ref="radarEl" class="h-64"></div>
      </div>
      <div class="card">
        <div class="section-title">章节知识点（点击星星评估掌握度，双击知识点可编辑内容与重要程度）</div>
        <div class="space-y-1">
          <div v-for="ch in subject.chapters" :key="ch.id" class="border border-slate-100 dark:border-slate-700 rounded-xl overflow-hidden">
            <div class="w-full flex items-center justify-between px-3 py-2.5 text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-700/50 group cursor-pointer"
              role="button" tabindex="0"
              @click="editingChapterId === ch.id ? null : (expanded[ch.id] = !expanded[ch.id])"
              @keyup.enter="editingChapterId === ch.id ? null : (expanded[ch.id] = !expanded[ch.id])"
              @keyup.space.prevent="editingChapterId === ch.id ? null : (expanded[ch.id] = !expanded[ch.id])">
              <span class="flex items-center gap-1.5 min-w-0">
                <!-- 编辑态：行内输入框，保持原标题字号与字重，排版不受影响 -->
                <input v-if="editingChapterId === ch.id" v-model="editingChapterName" v-focus
                  class="input !py-0.5 !px-1.5 !text-sm !font-medium !w-48 max-w-full"
                  @click.stop @dblclick.stop @keyup.enter.stop="saveChapterName(ch.id)"
                  @keyup.esc="cancelEditChapter" @blur="saveChapterName(ch.id)" />
                <template v-else>
                  <span class="cursor-text select-none" title="双击编辑章节标题" @dblclick.stop="startEditChapter(ch)">{{ ch.name }}</span>
                  <span class="text-xs text-slate-400 ml-1.5">{{ ch.topics.length }} 个知识点</span>
                  <span class="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-primary-500 text-xs cursor-pointer transition-opacity"
                    title="编辑章节标题" @click.stop="startEditChapter(ch)">✏️</span>
                </template>
              </span>
              <span class="flex items-center gap-2 shrink-0">
                <span class="text-red-400 text-xs hover:underline" @click.stop="removeChapter(ch.id)">删除</span>
                <span class="text-slate-400 text-xs">{{ expanded[ch.id] ? '▲' : '▼' }}</span>
              </span>
            </div>
            <div v-if="expanded[ch.id]" class="px-3 pb-2 space-y-1.5">
              <div v-if="!ch.topics.length" class="text-xs text-slate-400 py-1">暂无知识点，在下方添加小标题后可评估掌握度</div>
              <div v-for="topic in ch.topics" :key="topic" class="flex items-center justify-between text-sm py-0.5 group">
                <span class="text-slate-600 dark:text-slate-300 flex items-center gap-2 cursor-pointer select-none"
                  title="双击编辑知识点内容与重要程度" @dblclick="openTopicEdit(ch.id, topic)">
                  {{ topic }}
                  <span v-if="importanceOf(topic) !== 'normal'" class="text-[10px] px-1.5 py-0.5 rounded font-medium" :class="importanceMeta(topic).cls">
                    {{ importanceMeta(topic).l }}
                  </span>
                  <button class="opacity-0 group-hover:opacity-100 text-red-400 text-xs" title="删除知识点" @click.stop="removeTopic(ch.id, topic)" @dblclick.stop>×</button>
                </span>
                <StarRating :model-value="subject.mastery[topic] || 0" @update:model-value="v => store.setMastery(subject.id, topic, v)" />
              </div>
              <!-- 添加知识点 -->
              <div class="flex gap-2 pt-1">
                <input v-model="newTopic[ch.id]" class="input !py-1 !text-xs" placeholder="添加知识点小标题，如：洛必达法则" @keyup.enter="addTopic(ch.id)" />
                <button class="btn-ghost !py-1 !text-xs shrink-0" @click="addTopic(ch.id)">+ 添加</button>
              </div>
            </div>
          </div>
        </div>
        <div class="flex gap-2 mt-3">
          <input v-model="newChapter" class="input" placeholder="自定义添加章节…" @keyup.enter="addChapter" />
          <button class="btn-ghost shrink-0" @click="addChapter">添加</button>
        </div>
      </div>
    </div>

    <!-- 学习记录 -->
    <div v-show="tab === 'records'" class="space-y-3">
      <div class="card space-y-3">
        <div class="section-title">⏱ 记录本次学习</div>
        <!-- 计时器 -->
        <div class="flex items-center justify-center gap-3 py-2">
          <span class="text-3xl font-mono font-bold tabular-nums" :class="timerRunning ? 'text-emerald-500' : ''">{{ fmtTimer(timerSeconds) }}</span>
          <button v-if="!timerRunning" class="btn-primary" @click="startTimer">▶ 开始</button>
          <button v-else class="btn-ghost" @click="pauseTimer">⏸ 暂停</button>
          <button class="btn-danger" :disabled="!timerSeconds" @click="stopTimer">⏹ 结束</button>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="label">时长（分钟）</label>
            <input v-model.number="recMinutes" type="number" min="1" class="input" />
          </div>
          <div>
            <label class="label">章节</label>
            <select v-model="recChapter" class="input">
              <option value="">不限</option>
              <option v-for="ch in subject.chapters" :key="ch.id" :value="ch.id">{{ ch.name }}</option>
            </select>
          </div>
        </div>
        <div>
          <label class="label">知识点 / 备注</label>
          <input v-model="recNote" class="input" placeholder="例如：洛必达法则错题整理" />
        </div>
        <button class="btn-primary w-full" @click="addRecord">保存记录（+积分）</button>
      </div>
      <div class="card">
        <div class="section-title">历史记录</div>
        <div v-if="!subjectRecords.length" class="text-xs text-slate-400 text-center py-3">暂无记录</div>
        <div class="space-y-1.5 max-h-72 overflow-y-auto">
          <div v-for="r in subjectRecords" :key="r.id" class="flex items-center gap-2 text-sm group">
            <span class="text-xs text-slate-400 w-20 shrink-0">{{ r.date }}</span>
            <span class="font-medium w-16 shrink-0" :style="{ color: subject.color }">{{ r.minutes }}分钟</span>
            <span class="flex-1 text-slate-500 truncate text-xs">{{ r.note || '—' }}</span>
            <button class="opacity-0 group-hover:opacity-100 text-red-400 text-xs" @click="store.deleteRecord(r.id)">删除</button>
          </div>
        </div>
      </div>
    </div>

    <!-- 刷题 -->
    <div v-show="tab === 'problems'" class="space-y-3">
      <div class="card space-y-3">
        <div class="section-title">✏️ 记录本次刷题</div>
        <div class="grid grid-cols-2 gap-3">
          <div><label class="label">做题数量</label><input v-model.number="pTotal" type="number" min="0" class="input" /></div>
          <div><label class="label">答对数量</label><input v-model.number="pCorrect" type="number" min="0" class="input" /></div>
        </div>
        <div class="grid gap-2" :class="typeDefs.length > 4 ? 'grid-cols-5' : 'grid-cols-4'">
          <div v-for="t in typeDefs" :key="t.key">
            <label class="label">{{ t.label }}</label>
            <input v-model.number="pTypes[t.key]" type="number" min="0" class="input" />
          </div>
        </div>
        <button class="btn-primary w-full" @click="addProblems">保存刷题记录</button>
      </div>
      <div class="card">
        <div class="section-title">刷题历史</div>
        <div class="space-y-1.5 max-h-72 overflow-y-auto">
          <div v-for="p in subjectProblems" :key="p.id" class="flex items-center gap-2 text-sm group">
            <span class="text-xs text-slate-400 w-20">{{ p.date }}</span>
            <span class="flex-1">{{ p.correct }}/{{ p.total }} 题</span>
            <span class="text-xs font-semibold" :class="p.correct / p.total >= 0.8 ? 'text-emerald-500' : p.correct / p.total >= 0.6 ? 'text-amber-500' : 'text-red-400'">
              {{ Math.round(p.correct / p.total * 100) }}%
            </span>
            <button class="opacity-0 group-hover:opacity-100 text-red-400 text-xs" @click="store.deleteProblemSession(p.id)">删除</button>
          </div>
        </div>
      </div>
    </div>

    <!-- 真题 -->
    <div v-show="tab === 'exams'" class="space-y-3">
      <div class="card">
        <div class="flex items-center justify-between mb-2">
          <div class="section-title !mb-0">📄 真题成绩趋势（得分率%）</div>
          <button class="btn-primary !py-1.5" @click="showExamModal = true">+ 记录真题</button>
        </div>
        <div v-if="subjectExams.length" ref="examTrendEl" class="h-52"></div>
        <div v-else class="text-xs text-slate-400 text-center py-6">暂无真题记录</div>
        <div class="space-y-1.5 mt-2">
          <div v-for="e in subjectExams" :key="e.id" class="flex items-center gap-2 text-sm group">
            <span class="text-xs text-slate-400 w-20">{{ e.date }}</span>
            <span class="flex-1 truncate">{{ e.title }}</span>
            <span class="font-semibold">{{ e.score }}/{{ e.totalScore }}</span>
            <span class="text-xs text-slate-400">{{ e.minutes }}分钟</span>
            <button class="opacity-0 group-hover:opacity-100 text-red-400 text-xs" @click="store.deleteExam(e.id)">删除</button>
          </div>
        </div>
      </div>
    </div>

    <!-- 笔记 -->
    <div v-show="tab === 'notes'" class="space-y-3"
      @dragenter.prevent="onNoteDragEnter"
      @dragover.prevent
      @dragleave.prevent="onNoteDragLeave"
      @drop.prevent="onNoteDrop">
      <div class="card transition-shadow" :class="noteDragging ? 'ring-2 ring-primary-400 border-dashed' : ''">
        <div class="flex gap-2 mb-3">
          <input v-model="noteSearch" class="input" placeholder="🔍 全文检索笔记（标题/内容/标签）" />
          <button class="btn-ghost shrink-0" title="从本地选择文件上传为笔记" @click="noteFileInput?.click()">📁 上传文件</button>
          <button class="btn-primary shrink-0" @click="openNote()">+ 新建</button>
          <input ref="noteFileInput" type="file" multiple accept=".md,.markdown,.txt,text/markdown,text/plain" class="hidden" @change="onNoteFileChange" />
        </div>
        <p class="text-[10px] text-slate-400 mb-2">支持 .md / .markdown / .txt 上传或拖拽导入；PDF 导入与预览请前往「笔记」页面 · 点击卡片进入全屏编辑</p>
        <div v-if="!filteredNotes.length" class="text-xs text-slate-400 text-center py-4">暂无笔记</div>
        <div class="grid sm:grid-cols-2 gap-2">
          <div v-for="n in filteredNotes" :key="n.id" class="border border-slate-100 dark:border-slate-700 rounded-xl p-3 cursor-pointer hover:shadow-sm" @click="openNote(n)">
            <div class="font-medium text-sm truncate">{{ n.title }}</div>
            <div class="text-xs text-slate-400 line-clamp-2 mt-1">{{ n.content.replace(/\$+/g, '').slice(0, 80) }}</div>
            <div class="flex gap-1 mt-2 flex-wrap">
              <span v-for="t in n.tags" :key="t" class="text-[10px] px-1.5 py-0.5 rounded bg-primary-50 dark:bg-primary-900/30 text-primary-500">#{{ t }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 知识点编辑弹窗（双击知识点唤起） -->
    <Modal title="编辑知识点" :show="showTopicModal" @close="showTopicModal = false">
      <div class="space-y-3">
        <div>
          <label class="label">知识点内容</label>
          <input v-model="editTopic.text" class="input" placeholder="知识点名称" @keyup.enter="saveTopicEdit" />
        </div>
        <div>
          <label class="label">重要程度</label>
          <div class="flex gap-2">
            <button v-for="o in IMPORTANCE_OPTIONS" :key="o.k" type="button"
              class="flex-1 text-xs px-3 py-2 rounded-xl font-medium transition-all"
              :class="[o.cls, editTopic.importance === o.k ? 'ring-2 ring-primary-400' : 'opacity-60 hover:opacity-100']"
              @click="editTopic.importance = o.k">{{ o.l }}</button>
          </div>
        </div>
      </div>
      <template #footer>
        <button class="btn-ghost" @click="showTopicModal = false">取消</button>
        <button class="btn-primary" @click="saveTopicEdit">保存</button>
      </template>
    </Modal>

    <!-- 真题弹窗 -->
    <Modal title="记录真题/套卷" :show="showExamModal" @close="showExamModal = false">
      <div class="space-y-3">
        <div><label class="label">试卷名称</label><input v-model="examForm.title" class="input" placeholder="如：2023年真题卷" /></div>
        <div class="grid grid-cols-3 gap-2">
          <div><label class="label">得分</label><input v-model.number="examForm.score" type="number" class="input" /></div>
          <div><label class="label">总分</label><input v-model.number="examForm.totalScore" type="number" class="input" /></div>
          <div><label class="label">用时(分)</label><input v-model.number="examForm.minutes" type="number" class="input" /></div>
        </div>
      </div>
      <template #footer>
        <button class="btn-ghost" @click="showExamModal = false">取消</button>
        <button class="btn-primary" @click="addExam">保存</button>
      </template>
    </Modal>

  </div>
</template>
