<script setup lang="ts">
import { ArrowLeft, BookOpen, FileText, Plus, Search, Upload } from '@lucide/vue'
import IconAction from '../shared/components/IconAction.vue'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useToast } from '../composables/useToast'
import { useConfirm } from '../composables/useConfirm'
import { useRoute, useRouter } from 'vue-router'
import { useAppStore } from '../stores/app'
import { useMarkdownHtml } from '../composables/useMarkdownHtml'
import PdfViewer from '../components/PdfViewer.vue'
import PartnerShareModal from '../components/partner/PartnerShareModal.vue'
import SubjectIcon from '../components/SubjectIcon.vue'
import { uploadPdf, fetchPdf, PDF_MAX_BYTES, PDF_MAX_MB } from '../api/pdfs'
import { uid } from '../utils/date'
import { subjectLabel } from '../utils/subject'
import { getErrorMessage } from '../utils/error'
import type { Note } from '../types'
import { sessionUser } from '../services/auth'
import { getNoteBody, noteBodyExcerpt, noteBodyIncludes, noteBodyIndexVersion } from '../services/noteBodies'

const store = useAppStore()
const route = useRoute()
const router = useRouter()
const toast = useToast()
const confirm = useConfirm()
const noteOwner = sessionUser.value?.id
let disposed = false
const sameAccount = () => !!noteOwner && sessionUser.value?.id === noteOwner

// ---- 笔记列表（全部科目，按更新时间倒序） ----
const search = ref('')
const allNotes = computed(() => store.notes.slice().sort((a, b) => b.updatedAt - a.updatedAt))
const filteredNotes = computed(() => {
  const _indexVersion = noteBodyIndexVersion.value
  const kw = search.value.trim().toLowerCase()
  if (!kw) return allNotes.value
  // PDF 不参与正文检索；Markdown 由本地 IndexedDB 搜索索引提供同步查询。
  return allNotes.value.filter(
    (n) =>
      n.title.toLowerCase().includes(kw) ||
      (n.type !== 'pdf' && noteBodyIncludes(n.id, kw)) ||
      n.tags.some((t) => t.toLowerCase().includes(kw))
  )
})

// ---- 当前编辑的笔记（草稿模式：未保存的新笔记不落入 store） ----
type NoteDraft = Partial<Note> & { content?: string }
const draft = ref<NoteDraft | null>(null)
const dirty = ref(false)
const previewMode = ref<'edit' | 'split' | 'preview'>('split')

/**
 * 草稿预览 HTML（两阶段渲染 + 输入防抖）：空闲后首个变更立即渲染，连续输入期间合并渲染，
 * 避免长笔记每次按键都全量重排阻塞输入；含公式时异步加载 KaTeX chunk 后原地升级（同一 v-html 容器）。
 * previewPending：防抖等待 / KaTeX 升级进行中为 true，用于预览区「渲染中」提示。
 */
const previewPending = ref(false)
const draftHtml = useMarkdownHtml(() => draft.value?.content || '', previewPending)

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

/** 开始一份全新的空草稿（「＋新建笔记」与 ?new=1 的 watcher 共用，保证两个入口口径一致） */
function startNewDraft(subjectId: string) {
  search.value = ''
  draft.value = { subjectId, title: '', content: '', tags: [] }
  dirty.value = false
  previewMode.value = 'edit'
}

function newNote() {
  flushIfDirty()
  const subjectId = (route.query.subject as string) || store.subjects[0]?.id || ''
  // 显式丢弃上一份草稿：与当前 ?new=1 同址的 replace 不会触发 watcher，残留内容会被再保存成第二条笔记
  startNewDraft(subjectId)
  router.replace({ path: '/notes', query: { new: '1', subject: subjectId } })
}

function backToList() {
  flushIfDirty()
  // 显式退出编辑态：新建草稿时 selectedId 前后都是 ""，watcher 不会触发——只 replace 路由
  // 会让移动端一直停在编辑区（空草稿时连保存 / 删除都退不出去）
  draft.value = null
  dirty.value = false
  router.replace({ path: '/notes' })
}

/**
 * 兜底保存（切换笔记 / 返回列表 / 离开页面 / 卸载前）：只写数据。
 * teardown（卸载 / beforeunload）时禁止操作路由——router.replace 会劫持正在进行的导航，
 * 打断 out-in 过渡导致空白页。
 */
function flushIfDirty(teardown = false) {
  if (dirty.value && draft.value) doSave(true, !teardown)
}

/**
 * 保存草稿，返回落库的笔记 id（未保存返回 null）。
 * - silent：兜底静默保存（不 toast）
 * - navigate：新建笔记落库后是否把 URL 固定到该 id
 */
function doSave(silent = false, navigate = true): string | null {
  if (!draft.value || !sameAccount()) return null
  if (!draft.value.title?.trim() && !draft.value.content?.trim()) {
    if (!silent) toast('标题与内容均为空，未保存')
    return null
  }
  const created = !draft.value.id
  const savedId = store.saveNote({ ...draft.value, subjectId: draft.value.subjectId || store.subjects[0]?.id || '' })
  if (!savedId) return null
  // 把新建出来的 id 写回草稿：此后这份草稿是「已保存」态，再点保存只会更新同一篇
  // （不回填就会再走一次新建，同一份内容落成两条笔记）
  draft.value.id = savedId
  draft.value.title = store.notes.find((n) => n.id === savedId)?.title || '未命名'
  dirty.value = false
  if (created) search.value = ''
  if (created && navigate) router.replace({ path: '/notes', query: { id: savedId } })
  if (!silent) toast('笔记已保存')
  return savedId
}

async function removeNote() {
  // 未保存的新草稿：直接丢弃（置 dirty=false 防止 backToList 静默保存）
  if (!draft.value?.id) {
    dirty.value = false
    backToList()
    return
  }
  if (!(await confirm('删除这篇笔记？', { danger: true }))) return
  store.deleteNote(draft.value.id)
  dirty.value = false
  toast('笔记已删除')
  backToList()
}

// 路由变化 -> 先兜底保存当前未保存改动（watcher 先于 onUnmounted 执行，
// 若直接清空 dirty/draft，卸载时的 flushIfDirty 会被跳过导致编辑丢失），再载入目标笔记
watch(
  selectedId,
  (id) => {
    flushIfDirty()
    if (id) {
      const n = store.notes.find((x) => x.id === id)
      draft.value = n
        ? {
            ...n,
            title: n.title.trim() || '未命名',
            content: n.type === 'pdf' ? '' : getNoteBody(n.id),
            tags: [...n.tags]
          }
        : null
    } else if (route.query.new !== '1') {
      draft.value = null
    }
    dirty.value = false
  },
  { immediate: true }
)

// 「新建」模式：/notes?new=1&subject=xxx
watch(
  () => route.query.new,
  (v) => {
    if (v === '1') startNewDraft((route.query.subject as string) || store.subjects[0]?.id || '')
  },
  { immediate: true }
)

// dirty 仅由用户编辑行为标记（模板 @input/@change 调用），避免加载笔记时被误判为已修改

// ---- 文件导入（.md/.txt 导入为 Markdown 笔记；.pdf 原文上传至 D1 分片，元数据仅存 note id） ----
const fileInput = ref<HTMLInputElement>()
const TEXT_EXTS = ['.md', '.markdown', '.txt']
/** 进行中的 PDF 上传数（>0 时禁用导入按钮，避免批量并发上传失控） */
const uploadingCount = ref(0)

/**
 * PDF 导入：先生成笔记 id 并以其为键将原文上传至服务端 D1 分片表，成功后再落笔记。
 * PDF 原文直接以 note id 定位——PDF 不进入 Pinia/同步载荷，30MB 文件也不会拖慢日常保存。
 */
function importPdf(file: File) {
  const id = uid()
  const subjectId = draftSubjectForImport()
  uploadingCount.value++
  uploadPdf(id, file)
    .then(() => {
      if (disposed || !sameAccount()) return
      store.importNotes(subjectId, [
        {
          id,
          title: file.name.replace(/\.[^.]+$/, ''),
          content: '',
          tags: ['PDF'],
          type: 'pdf'
        }
      ])
      toast(`已导入 PDF「${file.name}」`)
    })
    .catch((e) => {
      if (disposed || !sameAccount()) return
      toast(`导入「${file.name}」失败：${getErrorMessage(e, '网络错误')}`)
    })
    .finally(() => {
      uploadingCount.value--
    })
}

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files || [])
  input.value = ''
  const subjectId = draftSubjectForImport()
  for (const file of files) {
    const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase()
    if (ext === '.pdf') {
      if (file.size > PDF_MAX_BYTES) {
        toast(`「${file.name}」超过 ${PDF_MAX_MB}MB 上限，请压缩或拆分后再导入`)
        continue
      }
      importPdf(file)
    } else if (TEXT_EXTS.includes(ext)) {
      if (file.size > 1024 * 1024) {
        toast(`「${file.name}」超过 1MB，已跳过`)
        continue
      }
      file
        .text()
        .then((content) => {
          if (disposed || !sameAccount()) return
          if (!content.trim()) {
            toast(`「${file.name}」内容为空，已跳过`)
            return
          }
          store.importNotes(subjectId, [{ title: file.name.replace(/\.[^.]+$/, ''), content, tags: ['导入'] }])
          toast(`已导入「${file.name}」`)
        })
        .catch(() => {
          if (!disposed && sameAccount()) toast(`读取「${file.name}」失败`)
        })
    } else {
      toast(`「${file.name}」格式不支持，仅接受 .md / .txt / .pdf`)
    }
  }
}

/** 文件导入归属科目：当前草稿科目，否则第一个科目 */
function draftSubjectForImport() {
  return draft.value?.subjectId || (route.query.subject as string) || store.subjects[0]?.id || ''
}

// ---- PDF 原文：以 note.id 回源拉取分片并交给查看器 ----
const pdfBytes = ref<Uint8Array | null>(null)
const pdfFetchError = ref('')
let pdfFetchSeq = 0

function loadPdf(id = selectedId.value) {
  const seq = ++pdfFetchSeq
  pdfBytes.value = null
  pdfFetchError.value = ''
  const n = id ? store.notes.find((x) => x.id === id) : null
  if (n?.type !== 'pdf') return
  fetchPdf(n.id)
    .then((b) => {
      if (seq === pdfFetchSeq) pdfBytes.value = b
    })
    .catch((e) => {
      if (seq === pdfFetchSeq) pdfFetchError.value = getErrorMessage(e, 'PDF 加载失败')
    })
}
watch(selectedId, (id) => loadPdf(id), { immediate: true })

// ---- 分享给搭子（仅已保存的笔记可分享，草稿需先保存） ----
const shareNoteId = ref('')
const preparingShare = ref(false)
async function shareNote() {
  if (preparingShare.value || !sameAccount()) return
  const id = doSave(true)
  if (!id) {
    toast('请先填写笔记标题或内容')
    return
  }
  preparingShare.value = true
  try {
    if (!(await store.saveAsync())) {
      if (!disposed && sameAccount()) toast('笔记尚未同步，请检查网络后重试分享')
      return
    }
    if (!disposed && sameAccount() && draft.value?.id === id) shareNoteId.value = id
  } catch (e) {
    if (!disposed && sameAccount()) toast(getErrorMessage(e, '笔记同步失败，请重试分享'))
  } finally {
    preparingShare.value = false
  }
}

// ---- 移动端：列表/编辑 视图切换 ----
const isEditing = computed(() => !!draft.value)

// 以实际可见空间计算编辑区高度，兼容同步提示、手机安全区与软键盘。
const workspace = ref<HTMLElement>()
const workspaceHeight = ref<number>()
let workspaceObserver: ResizeObserver | undefined
let mainObserver: MutationObserver | undefined
let workspaceFrame = 0

function measureWorkspace() {
  const element = workspace.value
  if (!element) return
  const viewport = window.visualViewport
  const viewportTop = viewport?.offsetTop || 0
  let bottom = viewportTop + (viewport?.height || window.innerHeight)
  const mobileNav = document.querySelector<HTMLElement>('.mobile-nav')
  if (mobileNav && getComputedStyle(mobileNav).display !== 'none') {
    const navBounds = mobileNav.getBoundingClientRect()
    if (navBounds.top < bottom && navBounds.bottom > viewportTop) bottom = Math.min(bottom, navBounds.top)
  }
  workspaceHeight.value = Math.max(280, Math.floor(bottom - element.getBoundingClientRect().top - 16))
}

function queueWorkspaceMeasure() {
  cancelAnimationFrame(workspaceFrame)
  workspaceFrame = requestAnimationFrame(measureWorkspace)
}

watch(isEditing, () => nextTick(queueWorkspaceMeasure))
onMounted(() => {
  workspaceObserver = new ResizeObserver(queueWorkspaceMeasure)
  const page = workspace.value?.parentElement
  const main = workspace.value?.closest('main')
  if (page) workspaceObserver.observe(page)
  if (main) {
    workspaceObserver.observe(main)
    mainObserver = new MutationObserver(queueWorkspaceMeasure)
    mainObserver.observe(main, { childList: true })
  }
  window.addEventListener('resize', queueWorkspaceMeasure)
  window.visualViewport?.addEventListener('resize', queueWorkspaceMeasure)
  window.visualViewport?.addEventListener('scroll', queueWorkspaceMeasure)
  queueWorkspaceMeasure()
})
onUnmounted(() => {
  cancelAnimationFrame(workspaceFrame)
  workspaceObserver?.disconnect()
  mainObserver?.disconnect()
  window.removeEventListener('resize', queueWorkspaceMeasure)
  window.visualViewport?.removeEventListener('resize', queueWorkspaceMeasure)
  window.visualViewport?.removeEventListener('scroll', queueWorkspaceMeasure)
})

// 离开页面前兜底保存（teardown：不操作路由）
function flushOnUnload() {
  flushIfDirty(true)
}
onMounted(() => window.addEventListener('beforeunload', flushOnUnload))
onUnmounted(() => {
  window.removeEventListener('beforeunload', flushOnUnload)
  flushIfDirty(true)
  disposed = true
  pdfFetchSeq++
})
</script>

<template>
  <div class="study-page notes-page" :class="{ 'is-editing': isEditing }">
    <h1 v-if="isEditing" class="sr-only md:hidden">笔记编辑</h1>
    <header class="study-page-heading notes-page-heading">
      <div>
        <h1 class="page-title">我的笔记</h1>
        <p class="mt-1 text-sm text-muted">整理学习思路，保存 Markdown 笔记与 PDF 文档。</p>
      </div>
      <div class="notes-page-actions">
        <button
          class="btn-ghost"
          :title="`导入 .md / .txt / .pdf 文件（PDF 单文件 ≤${PDF_MAX_MB}MB）`"
          :disabled="uploadingCount > 0"
          @click="fileInput?.click()"
        >
          <Upload :size="16" aria-hidden="true" />{{ uploadingCount ? '导入中…' : '导入文件' }}
        </button>
        <button class="btn-primary" @click="newNote"><Plus :size="16" aria-hidden="true" />新建笔记</button>
      </div>
    </header>
    <input
      ref="fileInput"
      type="file"
      multiple
      accept=".md,.markdown,.txt,.pdf"
      class="hidden"
      @change="onFileChange"
    />

    <div
      ref="workspace"
      class="notes-workspace"
      :style="workspaceHeight ? { height: `${workspaceHeight}px` } : undefined"
    >
      <aside class="notes-list" :class="isEditing ? 'hidden md:flex' : 'flex'" aria-label="笔记列表">
        <div class="notes-list-toolbar">
          <div class="notes-list-heading">
            <h2>全部笔记</h2>
            <span>{{ allNotes.length }} 篇</span>
          </div>
          <div class="notes-search">
            <Search :size="16" aria-hidden="true" />
            <input v-model="search" aria-label="搜索笔记" class="input" placeholder="搜索标题、内容或标签" />
          </div>
        </div>
        <div class="notes-list-items">
          <div v-if="!filteredNotes.length" class="notes-list-empty">
            <FileText :size="24" aria-hidden="true" />
            <p>{{ search ? '没有匹配的笔记' : '还没有笔记' }}</p>
            <span>{{ search ? '试试更短的关键词。' : '记下今天的思路，方便下次复习。' }}</span>
          </div>
          <button
            v-for="n in filteredNotes"
            :key="n.id"
            class="notes-list-item"
            :class="{ 'is-selected': selectedId === n.id }"
            :aria-current="selectedId === n.id ? 'true' : undefined"
            @click="openNote(n)"
          >
            <div class="notes-list-item-title">
              <SubjectIcon v-if="subjectOf(n)?.icon" :icon="subjectOf(n)?.icon" class="notes-subject-icon" />
              <FileText v-else :size="16" class="notes-subject-icon" aria-hidden="true" />
              <span>{{ n.title.trim() || '未命名' }}</span>
            </div>
            <p class="notes-excerpt">{{ n.type === 'pdf' ? 'PDF 文档' : noteBodyExcerpt(n.id, 50) || '暂无正文' }}</p>
            <div class="notes-list-item-meta">
              <span>{{ subjectOf(n)?.name || '未分类' }}</span>
              <time>{{ fmtTime(n.updatedAt) }}</time>
            </div>
          </button>
        </div>
      </aside>

      <section class="notes-editor" :class="isEditing ? 'flex' : 'hidden md:flex'" aria-label="笔记编辑器">
        <template v-if="draft">
          <div class="notes-editor-heading">
            <IconAction :icon="ArrowLeft" label="返回列表" class="md:hidden" @click="backToList" />
            <input
              v-model="draft.title"
              class="notes-title-input"
              aria-label="笔记标题"
              placeholder="笔记标题"
              @input="dirty = true"
            />
            <span class="notes-save-state" role="status">{{ dirty ? '未保存' : draft.id ? '已保存' : '新笔记' }}</span>
          </div>
          <div class="notes-editor-toolbar">
            <template v-if="draft.type !== 'pdf'">
              <div class="notes-view-switch hidden sm:flex" role="group" aria-label="编辑视图">
                <button
                  v-for="m in [
                    { k: 'edit', l: '编辑' },
                    { k: 'split', l: '分栏' },
                    { k: 'preview', l: '预览' }
                  ]"
                  :key="m.k"
                  :aria-pressed="previewMode === m.k"
                  @click="previewMode = m.k as any"
                >
                  {{ m.l }}
                </button>
              </div>
              <button
                class="sm:hidden btn-ghost"
                :aria-pressed="previewMode === 'preview'"
                @click="previewMode = previewMode === 'preview' ? 'edit' : 'preview'"
              >
                {{ previewMode === 'preview' ? '编辑' : '预览' }}
              </button>
            </template>
            <div class="notes-editor-actions">
              <button class="btn-ghost" :disabled="preparingShare" @click="shareNote">
                {{ preparingShare ? '准备中…' : '分享给搭子' }}
              </button>
              <button class="notes-delete" @click="removeNote">删除</button>
              <button class="btn-primary" @click="doSave()">保存</button>
            </div>
          </div>
          <div class="notes-editor-meta">
            <div>
              <label class="label" for="note-subject">科目</label>
              <select id="note-subject" v-model="draft.subjectId" class="input" @change="dirty = true">
                <option v-for="s in store.subjects" :key="s.id" :value="s.id">{{ subjectLabel(s) }}</option>
              </select>
            </div>
            <div>
              <label class="label" for="note-tags">标签</label>
              <input
                id="note-tags"
                :value="draft.tags?.join(',')"
                class="input"
                placeholder="逗号分隔，例如：重点,复习"
                @input="
                  ($event) => {
                    draft!.tags = ($event.target as HTMLInputElement).value
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean)
                    dirty = true
                  }
                "
              />
            </div>
          </div>
          <div v-if="draft.type === 'pdf'" class="notes-editor-body flex flex-col">
            <div
              v-if="pdfFetchError"
              class="flex-1 flex flex-col gap-3 items-center justify-center text-sm text-correction px-6 text-center"
            >
              {{ pdfFetchError }}
              <button class="btn-ghost" @click="loadPdf()">重新加载 PDF</button>
            </div>
            <PdfViewer v-else :bytes="pdfBytes" class="flex-1 min-h-0" />
          </div>
          <div v-else class="notes-editor-body flex">
            <textarea
              v-show="previewMode !== 'preview'"
              v-model="draft.content"
              class="notes-content-input"
              :class="{ 'is-split': previewMode === 'split' }"
              aria-label="笔记正文，支持 Markdown 与 LaTeX 公式"
              placeholder="从这里开始记录…&#10;&#10;支持 Markdown 标题、列表、表格、代码块与 $LaTeX$ 公式。"
              @input="dirty = true"
            ></textarea>
            <div
              v-show="previewMode !== 'edit'"
              class="notes-preview"
              :class="previewMode === 'split' ? 'hidden sm:block' : ''"
            >
              <span v-if="previewPending" class="notes-preview-status" role="status">渲染中…</span>
              <div class="md-body" v-html="draftHtml"></div>
            </div>
          </div>
        </template>
        <div v-else class="notes-editor-empty">
          <BookOpen :size="32" aria-hidden="true" />
          <h2>打开一篇笔记</h2>
          <p>从左侧选择笔记，或记录新的学习思路。</p>
          <button class="btn-primary" @click="newNote"><Plus :size="16" aria-hidden="true" />新建笔记</button>
        </div>
      </section>
    </div>
    <PartnerShareModal v-if="shareNoteId" item-type="note" :item-id="shareNoteId" @close="shareNoteId = ''" />
  </div>
</template>

<style scoped>
.notes-page-heading {
  margin-bottom: 20px;
}
.notes-page-actions,
.notes-editor-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.notes-workspace {
  display: flex;
  height: calc(100dvh - var(--app-header-height, 56px) - var(--app-bottom-space, 0px) - 128px);
  min-height: 280px;
  overflow: hidden;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius-card);
}
.notes-list {
  flex-direction: column;
  width: 288px;
  flex-shrink: 0;
  min-height: 0;
  border-right: 1px solid var(--line);
}
.notes-list-toolbar {
  padding: 16px;
  border-bottom: 1px solid var(--line);
}
.notes-list-heading {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
  margin-bottom: 12px;
}
.notes-list-heading h2 {
  font-size: 14px;
  font-weight: 700;
}
.notes-list-heading span {
  font-size: 12px;
  color: var(--muted);
}
.notes-search {
  position: relative;
}
.notes-search > svg {
  position: absolute;
  left: 12px;
  top: 14px;
  color: var(--muted);
  pointer-events: none;
}
.notes-search .input {
  padding-left: 36px;
}
.notes-list-items {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 8px;
}
.notes-list-item {
  width: 100%;
  text-align: left;
  padding: 12px;
  border: 1px solid transparent;
  border-radius: var(--radius-control);
  transition: background-color var(--motion-fast);
}
.notes-list-item + .notes-list-item {
  margin-top: 4px;
}
.notes-list-item:hover {
  background: var(--surface-soft);
}
.notes-list-item.is-selected {
  background: var(--action-soft);
  border-color: var(--line);
}
.notes-list-item-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 700;
}
.notes-list-item-title > span:last-child {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.notes-subject-icon {
  flex-shrink: 0;
  color: var(--action);
}
.notes-excerpt {
  margin-top: 6px;
  color: var(--muted);
  font-size: 12px;
  overflow: hidden;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  white-space: pre-line;
  overflow-wrap: anywhere;
}
.notes-list-item-meta {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin-top: 8px;
  color: var(--muted);
  font-size: 11px;
}
.notes-list-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 36px 12px;
  text-align: center;
  color: var(--muted);
  font-size: 13px;
}
.notes-list-empty span {
  font-size: 12px;
}
.notes-editor {
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}
.notes-editor-heading {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 20px 12px;
}
.notes-title-input {
  flex: 1;
  min-width: 0;
  min-height: 32px;
  background: transparent;
  font-size: 18px;
  font-weight: 700;
  color: var(--ink);
  border-radius: 4px;
}
.notes-title-input::placeholder {
  color: var(--muted);
  font-weight: 400;
}
.notes-save-state {
  flex-shrink: 0;
  color: var(--muted);
  font-size: 12px;
}
.notes-editor-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px 16px;
  padding: 0 20px 12px;
  border-bottom: 1px solid var(--line);
}
.notes-view-switch {
  gap: 2px;
  padding: 3px;
  border-radius: var(--radius-control);
  background: var(--surface-soft);
}
.notes-view-switch button {
  min-height: 36px;
  padding: 6px 12px;
  color: var(--muted);
  font-size: 12px;
  border-radius: 5px;
}
.notes-view-switch button[aria-pressed='true'] {
  background: var(--surface);
  color: var(--action);
  font-weight: 700;
}
.notes-editor-actions {
  margin-left: auto;
}
.notes-editor-actions .btn-ghost,
.notes-editor-actions .btn-primary {
  font-size: 12px;
  padding-inline: 12px;
}
.notes-delete {
  min-height: 44px;
  padding: 8px;
  font-size: 12px;
  color: var(--correction);
  border-radius: var(--radius-control);
}
.notes-delete:hover {
  background: var(--correction-soft);
}
.notes-editor-meta {
  display: grid;
  grid-template-columns: minmax(140px, 1fr) minmax(0, 2fr);
  gap: 12px;
  padding: 12px 20px 16px;
  border-bottom: 1px solid var(--line);
}
.notes-editor-body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
.notes-content-input {
  flex: 1;
  min-width: 0;
  resize: none;
  padding: 20px;
  color: var(--ink);
  background: var(--surface);
  font-size: 14px;
  line-height: 1.8;
  caret-color: var(--action);
  outline-offset: -2px;
}
.notes-content-input::placeholder {
  color: var(--muted);
}
.notes-content-input.is-split {
  border-right: 1px solid var(--line);
}
.notes-preview {
  position: relative;
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding: 20px;
}
.notes-preview-status {
  position: absolute;
  right: 16px;
  top: 12px;
  padding: 2px 8px;
  border-radius: var(--radius-control);
  background: var(--surface-soft);
  color: var(--muted);
  font-size: 11px;
  pointer-events: none;
}
.notes-editor-empty {
  display: flex;
  flex: 1;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 12px;
  padding: 24px;
  color: var(--muted);
  text-align: center;
}
.notes-editor-empty h2 {
  color: var(--ink);
  font-size: 18px;
  font-weight: 700;
}
.notes-editor-empty p {
  margin-bottom: 4px;
  font-size: 14px;
}
@media (max-width: 1100px) {
  .notes-list {
    width: 250px;
  }
}
@media (max-width: 767px) {
  .notes-page-actions {
    width: 100%;
  }
  .notes-page-actions .btn-primary {
    flex: 1;
  }
  .notes-list {
    width: 100%;
    border-right: 0;
  }
  .notes-page.is-editing .notes-page-heading {
    display: none;
  }
  .notes-editor-heading {
    padding: 12px;
    gap: 8px;
  }
  .notes-title-input {
    font-size: 17px;
  }
  .notes-editor-toolbar {
    padding: 0 12px 12px;
    gap: 8px;
  }
  .notes-editor-actions {
    gap: 4px;
  }
  .notes-editor-actions .btn-ghost,
  .notes-editor-actions .btn-primary {
    padding-inline: 8px;
  }
  .notes-editor-meta {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.3fr);
    padding: 12px;
    gap: 8px;
  }
  .notes-editor-meta .input {
    font-size: 12px;
    padding-inline: 8px;
  }
  .notes-content-input,
  .notes-preview {
    padding: 16px;
  }
}
</style>
