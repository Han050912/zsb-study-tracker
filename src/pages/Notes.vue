<script setup lang="ts">
import { computed, inject, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAppStore } from '../stores/app'
import { renderMarkdown } from '../utils/markdown'
import { extractPdfText } from '../utils/pdf'
import PdfPreviewModal from '../components/PdfPreviewModal.vue'
import type { Note } from '../types'

const store = useAppStore()
const route = useRoute()
const router = useRouter()
const toast = inject<(m: string) => void>('toast', () => {})

// ---- 笔记列表（全部科目，按更新时间倒序） ----
const search = ref('')
const allNotes = computed(() =>
  store.notes.slice().sort((a, b) => b.updatedAt - a.updatedAt)
)
const filteredNotes = computed(() => {
  const kw = search.value.trim().toLowerCase()
  if (!kw) return allNotes.value
  return allNotes.value.filter(n =>
    n.title.toLowerCase().includes(kw) ||
    n.content.toLowerCase().includes(kw) ||
    n.tags.some(t => t.toLowerCase().includes(kw)))
})

// ---- 当前编辑的笔记（草稿模式：未保存的新笔记不落入 store） ----
const draft = ref<Partial<Note> | null>(null)
const dirty = ref(false)
const previewMode = ref<'edit' | 'split' | 'preview'>('split')

const selectedId = computed(() => (route.query.id as string) || '')

function subjectOf(n: Partial<Note>) {
  return store.subjectMap[n.subjectId || '']
}

function fmtTime(ts?: number) {
  if (!ts) return ''
  const d = new Date(ts)
  return `${d.getMonth() + 1}-${d.getDate()}`
}

/** 打开笔记：有未保存改动先静默保存，避免切换丢内容 */
function openNote(n: Note) {
  flushIfDirty()
  router.replace({ path: '/notes', query: { id: n.id } })
}

function newNote() {
  flushIfDirty()
  const subjectId = (route.query.subject as string) || store.subjects[0]?.id || ''
  router.replace({ path: '/notes', query: { new: '1', subject: subjectId } })
}

function backToList() {
  flushIfDirty()
  router.replace({ path: '/notes' })
}

function flushIfDirty() {
  if (dirty.value && draft.value) doSave(true)
}

function doSave(silent = false) {
  if (!draft.value) return
  if (!draft.value.title?.trim() && !draft.value.content?.trim()) {
    if (!silent) toast('标题与内容均为空，未保存')
    return
  }
  store.saveNote({ ...draft.value, subjectId: draft.value.subjectId || store.subjects[0]?.id || '' })
  dirty.value = false
  // 新建保存后，将 URL 切换为该笔记的固定链接
  if (!draft.value.id) {
    const created = store.notes.slice().sort((a, b) => b.updatedAt - a.updatedAt)[0]
    if (created) router.replace({ path: '/notes', query: { id: created.id } })
  }
  if (!silent) toast('笔记已保存')
}

function removeNote() {
  // 未保存的新草稿：直接丢弃（置 dirty=false 防止 backToList 静默保存）
  if (!draft.value?.id) {
    dirty.value = false
    backToList()
    return
  }
  if (!window.confirm('删除这篇笔记？')) return
  store.deleteNote(draft.value.id)
  dirty.value = false
  toast('笔记已删除')
  backToList()
}

// 路由变化 -> 载入目标笔记；无 id 时清空草稿回到列表态
watch(selectedId, (id) => {
  if (id) {
    const n = store.notes.find(x => x.id === id)
    draft.value = n ? { ...n, tags: [...n.tags] } : null
  } else if (route.query.new !== '1') {
    draft.value = null
  }
  dirty.value = false
}, { immediate: true })

// 「新建」模式：/notes?new=1&subject=xxx
watch(() => route.query.new, (v) => {
  if (v === '1') {
    draft.value = {
      subjectId: (route.query.subject as string) || store.subjects[0]?.id || '',
      title: '', content: '', tags: []
    }
    dirty.value = false
    previewMode.value = 'edit'
  }
}, { immediate: true })

// dirty 仅由用户编辑行为标记（模板 @input/@change 调用），避免加载笔记时被误判为已修改

// ---- 文件导入（.md/.txt 直接导入；.pdf 打开预览后提取导入） ----
const fileInput = ref<HTMLInputElement>()
const TEXT_EXTS = ['.md', '.markdown', '.txt']
const pdfFile = ref<File | null>(null)
const showPdf = ref(false)
const importing = ref(false)

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files || [])
  input.value = ''
  for (const file of files) {
    const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase()
    if (ext === '.pdf') {
      pdfFile.value = file
      showPdf.value = true
    } else if (TEXT_EXTS.includes(ext)) {
      if (file.size > 1024 * 1024) { toast(`「${file.name}」超过 1MB，已跳过`); continue }
      file.text().then(content => {
        if (!content.trim()) { toast(`「${file.name}」内容为空，已跳过`); return }
        store.importNotes(draftSubjectForImport(), [{ title: file.name.replace(/\.[^.]+$/, ''), content, tags: ['导入'] }])
        toast(`已导入「${file.name}」`)
      }).catch(() => toast(`读取「${file.name}」失败`))
    } else {
      toast(`「${file.name}」格式不支持，仅接受 .md / .txt / .pdf`)
    }
  }
}

/** 文件导入归属科目：当前草稿科目，否则第一个科目 */
function draftSubjectForImport() {
  return draft.value?.subjectId || (route.query.subject as string) || store.subjects[0]?.id || ''
}

async function importPdfAsNote() {
  if (!pdfFile.value || importing.value) return
  importing.value = true
  try {
    const result = await extractPdfText(pdfFile.value)
    if (!result.content.trim()) {
      toast('未能从该 PDF 提取到文本（可能是扫描件图片型 PDF）')
      return
    }
    store.importNotes(draftSubjectForImport(), [{ title: result.title, content: result.content, tags: ['导入', 'PDF'] }])
    toast(`已导入 PDF（${result.pages} 页）为笔记`)
    showPdf.value = false
  } catch {
    toast('PDF 解析失败，文件可能已损坏')
  } finally {
    importing.value = false
  }
}

// ---- 移动端：列表/编辑 视图切换 ----
const isEditing = computed(() => !!draft.value)

// 离开页面前兜底保存
onMounted(() => window.addEventListener('beforeunload', flushIfDirty))
onUnmounted(() => {
  window.removeEventListener('beforeunload', flushIfDirty)
  flushIfDirty()
})
</script>

<template>
  <div class="flex h-[calc(100vh-8.5rem)] md:h-[calc(100vh-5rem)] -m-4 md:-m-6">
    <!-- 左侧笔记列表（移动端：编辑时隐藏） -->
    <aside class="w-full md:w-72 shrink-0 flex-col border-r border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-800"
      :class="isEditing ? 'hidden md:flex' : 'flex'">
      <div class="p-3 space-y-2 border-b border-slate-100 dark:border-slate-700">
        <div class="flex gap-2">
          <button class="btn-primary flex-1" @click="newNote">＋ 新建笔记</button>
          <button class="btn-ghost shrink-0" title="导入 .md / .txt / .pdf 文件" @click="fileInput?.click()">📁</button>
          <input ref="fileInput" type="file" multiple accept=".md,.markdown,.txt,.pdf" class="hidden" @change="onFileChange" />
        </div>
        <input v-model="search" class="input" placeholder="🔍 搜索标题 / 内容 / 标签" />
      </div>
      <div class="flex-1 overflow-y-auto p-2 space-y-1">
        <div v-if="!filteredNotes.length" class="text-xs text-slate-400 text-center py-8">
          {{ search ? '没有匹配的笔记' : '暂无笔记，点击上方「新建笔记」开始' }}
        </div>
        <button v-for="n in filteredNotes" :key="n.id"
          class="w-full text-left rounded-xl px-3 py-2.5 transition-colors"
          :class="selectedId === n.id ? 'bg-primary-50 dark:bg-primary-900/30 ring-1 ring-primary-200 dark:ring-primary-800' : 'hover:bg-slate-50 dark:hover:bg-slate-700'"
          @click="openNote(n)">
          <div class="flex items-center gap-1.5">
            <span class="text-xs shrink-0">{{ subjectOf(n)?.icon || '📝' }}</span>
            <span class="font-medium text-sm truncate flex-1">{{ n.title || '未命名' }}</span>
            <span class="text-[10px] text-slate-400 shrink-0">{{ fmtTime(n.updatedAt) }}</span>
          </div>
          <div class="text-xs text-slate-400 truncate mt-0.5">{{ n.content.replace(/\$+/g, '').slice(0, 50) || '（空）' }}</div>
        </button>
      </div>
    </aside>

    <!-- 右侧编辑区 -->
    <section class="flex-1 flex-col min-w-0 bg-slate-50 dark:bg-slate-900" :class="isEditing ? 'flex' : 'hidden md:flex'">
      <template v-if="draft">
        <!-- 工具栏 -->
        <div class="flex items-center gap-2 px-4 py-2.5 bg-white dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700">
          <button class="btn-ghost !py-1 !px-2 md:hidden" title="返回列表" @click="backToList">←</button>
          <input v-model="draft.title" class="flex-1 min-w-0 bg-transparent text-base font-bold outline-none dark:text-slate-100" placeholder="笔记标题" @input="dirty = true" />
          <span v-if="dirty" class="text-[10px] text-amber-500 shrink-0">未保存</span>
          <div class="hidden sm:flex gap-1 bg-slate-100 dark:bg-slate-700 rounded-lg p-0.5 text-xs">
            <button v-for="m in [{ k: 'edit', l: '编辑' }, { k: 'split', l: '分栏' }, { k: 'preview', l: '预览' }]" :key="m.k"
              class="px-2.5 py-1 rounded-md transition-colors"
              :class="previewMode === m.k ? 'bg-white dark:bg-slate-600 shadow-sm font-medium' : 'text-slate-500'"
              @click="previewMode = m.k as any">{{ m.l }}</button>
          </div>
          <button class="sm:hidden btn-ghost !py-1 !px-2 text-xs" @click="previewMode = previewMode === 'preview' ? 'edit' : 'preview'">
            {{ previewMode === 'preview' ? '编辑' : '预览' }}
          </button>
          <button class="btn-danger !py-1.5 shrink-0" @click="removeNote">删除</button>
          <button class="btn-primary !py-1.5 shrink-0" @click="doSave()">保存</button>
        </div>
        <!-- 元信息 -->
        <div class="flex flex-wrap items-center gap-2 px-4 py-2 bg-white dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700">
          <select v-model="draft.subjectId" class="input !w-auto !py-1 !text-xs" @change="dirty = true">
            <option v-for="s in store.subjects" :key="s.id" :value="s.id">{{ s.icon }} {{ s.name }}</option>
          </select>
          <input :value="draft.tags?.join(',')" class="input !flex-1 !py-1 !text-xs min-w-32" placeholder="标签，逗号分隔"
            @input="draft.tags = ($event.target as HTMLInputElement).value.split(',').map(s => s.trim()).filter(Boolean); dirty = true" />
        </div>
        <!-- 编辑 / 预览 -->
        <div class="flex-1 flex min-h-0">
          <textarea v-show="previewMode !== 'preview'" v-model="draft.content"
            class="flex-1 min-w-0 resize-none bg-white dark:bg-slate-800 p-4 text-sm font-mono leading-6 outline-none dark:text-slate-100"
            :class="previewMode === 'split' ? 'border-r border-slate-100 dark:border-slate-700' : ''"
            placeholder="支持 Markdown 语法（标题/列表/表格/代码块/任务列表）与 $LaTeX$ 公式…"
            @input="dirty = true"></textarea>
          <div v-show="previewMode !== 'edit'" class="flex-1 min-w-0 overflow-y-auto bg-white dark:bg-slate-800 p-4">
            <div class="md-body" v-html="renderMarkdown(draft.content || '')"></div>
          </div>
        </div>
      </template>

      <!-- 空状态 -->
      <div v-else class="flex-1 flex flex-col items-center justify-center text-slate-400 gap-3">
        <div class="text-5xl">📔</div>
        <p class="text-sm">从左侧选择一篇笔记，或新建一篇</p>
        <button class="btn-primary" @click="newNote">＋ 新建笔记</button>
      </div>
    </section>

    <!-- PDF 预览 / 导入 -->
    <PdfPreviewModal :show="showPdf" :file="pdfFile" @close="showPdf = false" @import="importPdfAsNote" />
  </div>
</template>
