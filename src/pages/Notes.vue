<script setup lang="ts">
import { computed, inject, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAppStore } from '../stores/app'
import { renderMarkdown } from '../utils/markdown'
import PdfViewer from '../components/PdfViewer.vue'
import PartnerShareModal from '../components/partner/PartnerShareModal.vue'
import { uploadPdf, fetchPdf, PDF_MAX_BYTES, PDF_MAX_MB, PDF_REF_PREFIX, pdfRefOf } from '../api/pdfs'
import { uid } from '../utils/date'
import { subjectLabel } from '../utils/subject'
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
  // PDF 笔记正文是云端 R2 引用（非文本），不参与内容检索，仅匹配标题与标签
  return allNotes.value.filter(n =>
    n.title.toLowerCase().includes(kw) ||
    (n.type !== 'pdf' && n.content.toLowerCase().includes(kw)) ||
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
  // 兜底保存（切换笔记/离开页面/关闭页面前）：只写数据，绝不操作路由——
  // 卸载期间 router.replace 会劫持正在进行的导航，打断 out-in 过渡导致空白页
  if (dirty.value && draft.value) doSave(true, false)
}

function doSave(silent = false, navigate = true) {
  if (!draft.value) return
  if (!draft.value.title?.trim() && !draft.value.content?.trim()) {
    if (!silent) toast('标题与内容均为空，未保存')
    return
  }
  store.saveNote({ ...draft.value, subjectId: draft.value.subjectId || store.subjects[0]?.id || '' })
  dirty.value = false
  // 新建保存后，将 URL 切换为该笔记的固定链接（仅用户主动点保存时；兜底保存禁止跳转）
  if (navigate && !draft.value.id) {
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

// 路由变化 -> 先兜底保存当前未保存改动（watcher 先于 onUnmounted 执行，
// 若直接清空 dirty/draft，卸载时的 flushIfDirty 会被跳过导致编辑丢失），再载入目标笔记
watch(selectedId, (id) => {
  flushIfDirty()
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

// ---- 文件导入（.md/.txt 导入为 Markdown 笔记；.pdf 原文上传至 R2，笔记仅存引用） ----
const fileInput = ref<HTMLInputElement>()
const TEXT_EXTS = ['.md', '.markdown', '.txt']
/** 进行中的 PDF 上传数（>0 时禁用导入按钮，避免批量并发上传失控） */
const uploadingCount = ref(0)

/**
 * PDF 导入：先生成笔记 id 并以其为键将原文上传至服务端 D1 分片表，成功后再落笔记。
 * content 仅存 'd1:<id>' 引用——PDF 不进入全量同步载荷，30MB 文件也不会拖慢日常保存。
 */
function importPdf(file: File) {
  const id = uid()
  uploadingCount.value++
  uploadPdf(id, file).then(() => {
    store.importNotes(draftSubjectForImport(), [{
      id,
      title: file.name.replace(/\.[^.]+$/, ''),
      content: PDF_REF_PREFIX + id,
      tags: ['PDF'],
      type: 'pdf'
    }])
    toast(`已导入 PDF「${file.name}」`)
  }).catch(e => {
    toast(`导入「${file.name}」失败：${e instanceof Error ? e.message : '网络错误'}`)
  }).finally(() => { uploadingCount.value-- })
}

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files || [])
  input.value = ''
  for (const file of files) {
    const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase()
    if (ext === '.pdf') {
      if (file.size > PDF_MAX_BYTES) { toast(`「${file.name}」超过 ${PDF_MAX_MB}MB 上限，请压缩或拆分后再导入`); continue }
      importPdf(file)
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

// ---- PDF 笔记正文：content 为 'd1:<id>' 引用，选中笔记时回源拉取分片拼装交给查看器 ----
const pdfBytes = ref<Uint8Array | null>(null)
const pdfFetchError = ref('')
let pdfFetchSeq = 0

watch(selectedId, (id) => {
  const seq = ++pdfFetchSeq
  pdfBytes.value = null
  pdfFetchError.value = ''
  const n = id ? store.notes.find(x => x.id === id) : null
  if (n?.type !== 'pdf') return
  fetchPdf(pdfRefOf(n.content)).then(b => {
    if (seq === pdfFetchSeq) pdfBytes.value = b
  }).catch(e => {
    if (seq === pdfFetchSeq) pdfFetchError.value = e instanceof Error ? e.message : 'PDF 加载失败'
  })
}, { immediate: true })

// ---- 分享给搭子（仅已保存的笔记可分享，草稿需先保存） ----
const shareNoteId = ref('')
function shareNote() {
  if (!draft.value?.id) { toast('请先保存笔记再分享'); return }
  shareNoteId.value = draft.value.id
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
  <!-- 编辑态无 pt-14（工具栏置顶），高度按 pt-0 计算；列表态保留 pt-14 -->
  <div class="flex" :class="isEditing ? 'h-[calc(100vh-5rem)] md:h-[calc(100vh-1.5rem)]' : 'h-[calc(100vh-8.5rem)] md:h-[calc(100vh-5rem)]'">
    <!-- 左侧笔记列表（移动端：编辑时隐藏） -->
    <aside class="w-full md:w-72 shrink-0 flex-col border-r border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-800"
      :class="isEditing ? 'hidden md:flex' : 'flex'">
      <div class="p-3 space-y-2 border-b border-slate-100 dark:border-slate-700">
        <div class="flex gap-2">
          <button class="btn-primary flex-1" @click="newNote">＋ 新建笔记</button>
          <button class="btn-ghost shrink-0" :title="`导入 .md / .txt / .pdf 文件（PDF 单文件 ≤${PDF_MAX_MB}MB）`" :disabled="uploadingCount > 0" @click="fileInput?.click()">{{ uploadingCount ? '上传中…' : '📁' }}</button>
          <input ref="fileInput" type="file" multiple accept=".md,.markdown,.txt,.pdf" class="hidden" @change="onFileChange" />
        </div>
        <input v-model="search" class="input" placeholder="搜索标题 / 内容 / 标签" />
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
          <div class="text-xs text-slate-400 truncate mt-0.5">{{ n.type === 'pdf' ? 'PDF 文档' : (n.content.replace(/\$+/g, '').slice(0, 50) || '（空）') }}</div>
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
          <template v-if="draft.type !== 'pdf'">
            <div class="hidden sm:flex gap-1 bg-slate-100 dark:bg-slate-700 rounded-lg p-0.5 text-xs">
              <button v-for="m in [{ k: 'edit', l: '编辑' }, { k: 'split', l: '分栏' }, { k: 'preview', l: '预览' }]" :key="m.k"
                class="px-2.5 py-1 rounded-md transition-colors"
                :class="previewMode === m.k ? 'bg-white dark:bg-slate-600 shadow-sm font-medium' : 'text-slate-500'"
                @click="previewMode = m.k as any">{{ m.l }}</button>
            </div>
            <button class="sm:hidden btn-ghost !py-1 !px-2 text-xs" @click="previewMode = previewMode === 'preview' ? 'edit' : 'preview'">
              {{ previewMode === 'preview' ? '编辑' : '预览' }}
            </button>
          </template>
          <button class="btn-ghost !py-1.5 !text-xs shrink-0" @click="shareNote">分享给搭子</button>
          <button class="btn-danger !py-1.5 shrink-0" @click="removeNote">删除</button>
          <button class="btn-primary !py-1.5 shrink-0" @click="doSave()">保存</button>
        </div>
        <!-- 元信息 -->
        <div class="flex flex-wrap items-center gap-2 px-4 py-2 bg-white dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700">
          <select v-model="draft.subjectId" class="input !w-auto !py-1 !text-xs" @change="dirty = true">
            <option v-for="s in store.subjects" :key="s.id" :value="s.id">{{ subjectLabel(s) }}</option>
          </select>
          <input :value="draft.tags?.join(',')" class="input !flex-1 !py-1 !text-xs min-w-32" placeholder="标签，逗号分隔"
            @input="draft.tags = ($event.target as HTMLInputElement).value.split(',').map(s => s.trim()).filter(Boolean); dirty = true" />
        </div>
        <!-- 正文区：PDF 笔记为查看器（正文只读，字节回源拉取），Markdown 笔记为编辑 / 预览 -->
        <div v-if="draft.type === 'pdf'" class="flex-1 min-h-0 flex flex-col">
          <div v-if="pdfFetchError" class="flex-1 flex items-center justify-center text-xs text-red-400 px-6 text-center">{{ pdfFetchError }}</div>
          <PdfViewer v-else :bytes="pdfBytes" class="flex-1 min-h-0" />
        </div>
        <div v-else class="flex-1 flex min-h-0">
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

    <!-- 分享给搭子弹窗 -->
    <PartnerShareModal v-if="shareNoteId" item-type="note" :item-id="shareNoteId" @close="shareNoteId = ''" />
  </div>
</template>
