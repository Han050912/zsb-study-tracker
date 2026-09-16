<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { CloudOff } from '@lucide/vue'
import { useRouter } from 'vue-router'
import { useToast } from '../../composables/useToast'
import { useAppStore } from '../../stores/app'
import type { Note } from '../../types'
import { noteBodyExcerpt, noteBodyIncludes, noteBodyIndexVersion, pendingNoteBodyIds } from '../../services/noteBodies'

const props = defineProps<{ subjectId: string }>()
const store = useAppStore()
const toast = useToast()

const subjectNotes = computed(() => store.notes.filter((n) => n.subjectId === props.subjectId))

// ---- 笔记（点击跳转全屏笔记页面，弹窗编辑已废弃） ----
const router = useRouter()
function openNote(n?: Note) {
  if (n) router.push({ path: '/notes', query: { id: n.id } })
  else router.push({ path: '/notes', query: { new: '1', subject: props.subjectId } })
}
const noteSearch = ref('')
const filteredNotes = computed(() => {
  const _indexVersion = noteBodyIndexVersion.value
  const kw = noteSearch.value.trim().toLowerCase()
  if (!kw) return subjectNotes.value
  return subjectNotes.value.filter(
    (n) =>
      n.title.toLowerCase().includes(kw) ||
      (n.type !== 'pdf' && noteBodyIncludes(n.id, kw)) ||
      n.tags.some((t) => t.toLowerCase().includes(kw))
  )
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
</script>

<template>
  <div
    class="space-y-3"
    @dragenter.prevent="onNoteDragEnter"
    @dragover.prevent
    @dragleave.prevent="onNoteDragLeave"
    @drop.prevent="onNoteDrop"
  >
    <div class="card transition-shadow" :class="noteDragging ? 'ring-2 ring-primary-400 border-dashed' : ''">
      <div class="flex gap-2 mb-3">
        <input v-model="noteSearch" class="input" placeholder="全文检索笔记（标题/内容/标签）" />
        <button class="btn-ghost shrink-0" title="从本地选择文件上传为笔记" @click="noteFileInput?.click()">
          📁 上传文件
        </button>
        <button class="btn-primary shrink-0" @click="openNote()">+ 新建</button>
        <input
          ref="noteFileInput"
          type="file"
          multiple
          accept=".md,.markdown,.txt,text/markdown,text/plain"
          class="hidden"
          @change="onNoteFileChange"
        />
      </div>
      <p class="text-[10px] text-slate-400 mb-2">
        支持 .md / .markdown / .txt 上传或拖拽导入；PDF 导入与预览请前往「笔记」页面 · 点击卡片进入全屏编辑
      </p>
      <div v-if="!filteredNotes.length" class="text-xs text-slate-400 text-center py-4">暂无笔记</div>
      <div class="grid sm:grid-cols-2 gap-2">
        <div
          v-for="n in filteredNotes"
          :key="n.id"
          class="border border-slate-100 dark:border-slate-700 rounded-xl p-3 cursor-pointer hover:shadow-sm"
          @click="openNote(n)"
        >
          <div class="flex items-center gap-1.5">
            <span class="font-medium text-sm truncate">{{ n.title }}</span>
            <!-- 正文没上云的笔记在换设备后是空的：必须在列表上可见，不能只留在控制台日志里 -->
            <span
              v-if="pendingNoteBodyIds.has(n.id)"
              class="shrink-0 inline-flex items-center gap-0.5 rounded bg-amber-50 dark:bg-amber-900/20 px-1.5 py-0.5 text-[10px] text-amber-600 dark:text-amber-400"
              title="正文尚未同步到云端，其他设备看不到最新内容"
            >
              <CloudOff :size="10" />未同步
            </span>
          </div>
          <div class="text-xs text-slate-400 line-clamp-2 mt-1">
            {{ n.type === 'pdf' ? 'PDF 文档' : noteBodyExcerpt(n.id) }}
          </div>
          <div class="flex gap-1 mt-2 flex-wrap">
            <span
              v-for="t in n.tags"
              :key="t"
              class="text-[10px] px-1.5 py-0.5 rounded bg-primary-50 dark:bg-primary-900/30 text-primary-500"
              >#{{ t }}</span
            >
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
