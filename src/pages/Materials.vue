<script setup lang="ts">
import { ArrowUpRight } from '@lucide/vue'
import IconAction from '../shared/components/IconAction.vue'
import { computed, onUnmounted, ref, watch } from 'vue'
import { useToast } from '../composables/useToast'
import { useConfirm } from '../composables/useConfirm'
import { useAppStore } from '../stores/app'
import { MAX_FIELD_CHARS } from '../stores/app/sync'
import Modal from '../components/Modal.vue'
import EmptyState from '../shared/components/EmptyState.vue'
import { prepareListLeave, resetEnteringItem } from '../utils/motion'
import { normalizeUrl } from '../utils/url'
import { subjectLabel } from '../utils/subject'
import type { Material } from '../types'
import { materialPagesError } from '../utils/studyValidation'
import { sessionUser } from '../services/auth'

const store = useAppStore()
const toast = useToast()
const confirm = useConfirm()

const filterType = ref('')
const filterSubject = ref('')

const TYPES = [
  { k: 'book', l: '书籍' },
  { k: 'video', l: '视频' },
  { k: 'link', l: '链接' },
  { k: 'doc', l: '文档' }
]

const list = computed(() => {
  let l = store.materials.slice().reverse()
  if (filterType.value) l = l.filter((m) => m.type === filterType.value)
  if (filterSubject.value) l = l.filter((m) => m.subjectId === filterSubject.value)
  return l
})

const hasFilter = computed(() => !!filterType.value || !!filterSubject.value)

function clearFilters() {
  filterType.value = ''
  filterSubject.value = ''
}

const showModal = ref(false)
const form = ref<Partial<Material>>({ type: 'book', priority: '中' })
function open(m?: Material) {
  cancelFileRead()
  form.value = m ? { ...m } : { type: 'book', priority: '中', title: '' }
  // 编辑已有资料时按 fileName 还原模式：有 fileName 即文件模式，否则链接模式。
  // 不再以「url 是否以 data: 开头」判定模式（那会把链接字段里的 base64 误判成文件上传）。
  linkMode.value = form.value.fileName ? 'file' : 'url'
  showModal.value = true
}
function save() {
  if (!showModal.value || fileReading.value) return
  const title = form.value.title?.trim() ?? ''
  if (!title) {
    toast('请填写标题')
    return
  }
  // 超限内容落库后会让每次推送都被服务端 413 整批拒绝（且永远重试），必须在写入前拦下并指明是哪条
  if ((form.value.url ?? '').length > MAX_FIELD_CHARS) {
    toast(`「${title}」的内容超过云端单条 1MB 上限，无法保存：请移除附件或改用链接方式引用`)
    return
  }
  const next = { ...form.value, title }
  // Vue 数字输入清空后仍是空字符串；可选页数应按未填写处理。
  if ((next.totalPages as unknown) === '') next.totalPages = undefined
  if ((next.readPages as unknown) === '') next.readPages = undefined
  const error = materialPagesError(next.totalPages, next.readPages)
  if (error) {
    toast(error)
    return
  }
  if (linkMode.value === 'url') {
    next.fileName = undefined
    if (next.url?.trim()) {
      const url = normalizeUrl(next.url)
      if (!url) {
        toast('链接格式无效，请填写有效的网页地址')
        return
      }
      next.url = url
    } else next.url = undefined
  }
  if (next.id) store.updateMaterial(next.id, next)
  else store.addMaterial(next as Omit<Material, 'id' | 'createdAt'>)
  showModal.value = false
  toast('已保存')
}

// ---- 链接输入 / 文件上传 双模式 ----
const linkMode = ref<'url' | 'file'>('url')
/**
 * 切换链接/文件模式时清空两个模式的字段（url 同时承载链接与文件 dataURL，无法按字段隔离）。
 * 否则会出现「切到链接模式却把之前附加文件的 dataURL 留在 url 字段」的混合态（issue #35）。
 */
function setLinkMode(mode: 'url' | 'file') {
  if (linkMode.value === mode) return
  cancelFileRead()
  linkMode.value = mode
  form.value.url = ''
  form.value.fileName = undefined
}
const fileInput = ref<HTMLInputElement>()
const fileReading = ref(false)
let fileReadGeneration = 0
let fileReader: FileReader | null = null
function cancelFileRead() {
  fileReadGeneration++
  fileReader?.abort()
  fileReader = null
  fileReading.value = false
}
watch(showModal, (show) => {
  if (!show) cancelFileRead()
})
onUnmounted(cancelFileRead)
const fileDragging = ref(false)
let fileDragDepth = 0
/**
 * 上传文件大小上限：文件以 dataURL 整段存入 `materials.url`，而该字段随记录参与**整批**推送
 * （一条超限记录会让服务端以 413 拒绝本次推送的全部域：笔记 / 错题 / 学习记录全被连累）。
 * 服务端单条字符串上限为 MAX_FIELD_CHARS，base64 体积是原始字节的 4/3，扣除 `data:<mime>;base64,` 前缀后
 * 即为可安全内嵌的最大文件字节数（≈732KB）。
 */
const FILE_SIZE_LIMIT = Math.floor(((MAX_FIELD_CHARS - 64) * 3) / 4)
const FILE_SIZE_LIMIT_KB = Math.floor(FILE_SIZE_LIMIT / 1024)

function readMaterialFile(file: File | undefined) {
  if (!file) return
  if (file.size > FILE_SIZE_LIMIT) {
    toast(`「${file.name}」超过 ${FILE_SIZE_LIMIT_KB}KB 内嵌上限，请改用链接方式引用`)
    return
  }
  cancelFileRead()
  const generation = fileReadGeneration
  const target = form.value
  const owner = sessionUser.value?.id
  const reader = new FileReader()
  fileReader = reader
  fileReading.value = true
  const stillCurrent = () =>
    generation === fileReadGeneration &&
    showModal.value &&
    form.value === target &&
    linkMode.value === 'file' &&
    sessionUser.value?.id === owner
  reader.onload = () => {
    if (!stillCurrent()) return
    form.value.url = reader.result as string
    form.value.fileName = file.name
    if (!form.value.title?.trim()) form.value.title = file.name.replace(/\.[^.]+$/, '')
    toast(`已附加文件「${file.name}」`)
    fileReading.value = false
    fileReader = null
  }
  reader.onerror = () => {
    if (!stillCurrent()) return
    fileReading.value = false
    fileReader = null
    toast(`读取「${file.name}」失败，请重新选择文件`)
  }
  reader.readAsDataURL(file)
}

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  readMaterialFile(input.files?.[0])
  input.value = ''
}
function onFileDragEnter() {
  fileDragDepth++
  fileDragging.value = true
}
function onFileDragLeave() {
  fileDragDepth = Math.max(0, fileDragDepth - 1)
  if (fileDragDepth === 0) fileDragging.value = false
}
function onFileDrop(e: DragEvent) {
  fileDragDepth = 0
  fileDragging.value = false
  readMaterialFile(e.dataTransfer?.files?.[0])
}
function clearFile() {
  cancelFileRead()
  form.value.url = ''
  form.value.fileName = undefined
}

function progress(m: Material) {
  return m.totalPages ? Math.round(((m.readPages || 0) / m.totalPages) * 100) : null
}

/** 打开资料链接：dataURL（上传的文件）转 Blob 对象 URL 打开；普通链接先规范化再新标签页打开 */
function openLink(url?: string) {
  if (!url) return
  if (url.startsWith('data:')) {
    try {
      const [meta, base64] = url.split(',')
      const mime = meta.match(/data:(.*?)(;|$)/)?.[1] || 'application/octet-stream'
      const bin = atob(base64)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      const blobUrl = URL.createObjectURL(new Blob([bytes], { type: mime }))
      window.open(blobUrl, '_blank', 'noopener,noreferrer')
      // 延迟回收对象 URL，给浏览器留出打开时间
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000)
    } catch {
      toast('文件未能打开，请检查文件是否仍在原位置')
    }
    return
  }
  const target = normalizeUrl(url)
  if (!target) {
    toast('链接格式无效，请检查 URL 后重试')
    return
  }
  window.open(target, '_blank', 'noopener,noreferrer')
}

async function remove() {
  if (!(await confirm('删除该资料？', { danger: true }))) return
  store.deleteMaterial(form.value.id!)
  showModal.value = false
  toast('已删除')
}

const priorityColor: Record<string, string> = {
  高: 'text-correction bg-correction-soft',
  中: 'text-muted bg-surface-soft',
  低: 'text-slate-400 bg-slate-50 dark:bg-slate-700'
}
</script>

<template>
  <div class="study-page space-y-4">
    <div class="study-page-heading">
      <div>
        <h1 class="page-title">学习资料</h1>
        <p class="page-description">按科目整理书籍、视频和文档，接着上次的进度学习。</p>
      </div>
      <button class="btn-primary" @click="open()">添加资料</button>
    </div>

    <div class="page-toolbar">
      <select aria-label="筛选资料类型" v-model="filterType" class="input !w-auto">
        <option value="">全部类型</option>
        <option v-for="t in TYPES" :key="t.k" :value="t.k">{{ t.l }}</option>
      </select>
      <select aria-label="筛选资料科目" v-model="filterSubject" class="input !w-auto">
        <option value="">全部科目</option>
        <option v-for="s in store.subjects" :key="s.id" :value="s.id">{{ subjectLabel(s) }}</option>
      </select>
    </div>

    <EmptyState
      v-if="!list.length"
      class="card"
      :title="hasFilter ? '没有符合条件的资料' : '整理你的学习资料'"
      :description="hasFilter ? '换个条件试试，或查看全部资料。' : '把教材、课程和常用链接放在一起，随时继续学习。'"
    >
      <button v-if="hasFilter" class="btn-ghost" @click="clearFilters">清除筛选</button>
      <button v-else class="btn-primary" @click="open()">添加第一份资料</button>
    </EmptyState>

    <TransitionGroup
      name="list"
      tag="div"
      class="relative grid sm:grid-cols-2 lg:grid-cols-3 gap-3"
      @before-leave="prepareListLeave"
      @before-enter="resetEnteringItem"
    >
      <div v-for="m in list" :key="m.id" class="card interactive-card cursor-pointer" @click="open(m)">
        <div class="flex items-start justify-between gap-2">
          <button type="button" class="text-sm text-left font-bold flex-1 min-w-0 break-words" @click.stop="open(m)">
            {{ TYPES.find((t) => t.k === m.type)?.l.split(' ')[0] }} {{ m.title }}
          </button>
          <span class="text-[10px] px-1.5 py-0.5 rounded shrink-0" :class="priorityColor[m.priority]">{{
            m.priority
          }}</span>
        </div>
        <div class="text-xs text-slate-400 mt-1 space-x-2">
          <span v-if="m.author">{{ m.author }}</span>
          <span v-if="m.subjectId">{{ subjectLabel(store.subjectMap[m.subjectId]) }}</span>
        </div>
        <div v-if="progress(m) !== null" class="mt-3">
          <div class="flex justify-between text-[10px] text-slate-400 mb-1">
            <span>阅读进度</span><span>{{ m.readPages }}/{{ m.totalPages }} 页 · {{ progress(m) }}%</span>
          </div>
          <div class="w-full h-1.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
            <div class="h-full bg-primary-400 rounded-full transition-all" :style="{ width: progress(m) + '%' }"></div>
          </div>
        </div>
        <p v-if="m.notes" class="text-xs text-slate-400 mt-2 line-clamp-2">{{ m.notes }}</p>
        <span
          v-if="m.url"
          class="text-xs text-action mt-2 inline-block hover:underline arrow-action"
          @click.stop="openLink(m.url)"
        >
          {{ m.fileName ? `打开文件「${m.fileName}」` : '打开链接' }}
          <IconAction
            :icon="ArrowUpRight"
            :label="m.fileName ? `打开文件「${m.fileName}」` : '打开链接'"
            @click.stop="openLink(m.url)"
          />
        </span>
      </div>
    </TransitionGroup>

    <Modal title="资料信息" :show="showModal" @close="showModal = false">
      <div class="space-y-3">
        <input
          v-model="form.title"
          class="input"
          aria-label="标题，如：《高等数学（同济版）》*"
          placeholder="标题，如：《高等数学（同济版）》*"
          data-autofocus
        />
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <div>
            <label class="label" for="mat-type">类型</label>
            <select id="mat-type" v-model="form.type" class="input">
              <option v-for="t in TYPES" :key="t.k" :value="t.k">{{ t.l }}</option>
            </select>
          </div>
          <div>
            <label class="label" for="mat-subject">科目</label>
            <select id="mat-subject" v-model="form.subjectId" class="input">
              <option :value="undefined">无</option>
              <option v-for="s in store.subjects" :key="s.id" :value="s.id">{{ s.name }}</option>
            </select>
          </div>
          <div>
            <label class="label" for="mat-priority">优先级</label>
            <select id="mat-priority" v-model="form.priority" class="input">
              <option>高</option>
              <option>中</option>
              <option>低</option>
            </select>
          </div>
        </div>
        <input v-model="form.author" class="input" aria-label="作者 / UP主（可选）" placeholder="作者 / UP主（可选）" />

        <!-- 链接 / 文件 双模式 -->
        <div>
          <div class="flex gap-1 bg-slate-100 dark:bg-slate-800 rounded-lg p-1 w-fit mb-2">
            <button
              type="button"
              class="text-xs px-3 py-1.5 rounded-md font-medium transition-colors"
              :class="linkMode === 'url' ? 'bg-white dark:bg-slate-600 shadow-sm' : 'text-slate-500'"
              :aria-pressed="linkMode === 'url'"
              @click="setLinkMode('url')"
            >
              URL 链接
            </button>
            <button
              type="button"
              class="text-xs px-3 py-1.5 rounded-md font-medium transition-colors"
              :class="linkMode === 'file' ? 'bg-white dark:bg-slate-600 shadow-sm' : 'text-slate-500'"
              :aria-pressed="linkMode === 'file'"
              @click="setLinkMode('file')"
            >
              文件上传
            </button>
          </div>

          <input
            v-if="linkMode === 'url'"
            v-model="form.url"
            class="input"
            aria-label="链接 URL（可选），如 https://…"
            placeholder="链接 URL（可选），如 https://…"
          />

          <template v-else>
            <button
              v-if="!form.fileName"
              type="button"
              class="w-full rounded-lg border-2 border-dashed transition-colors p-5 text-center cursor-pointer"
              aria-label="选择资料文件，也可拖放文件到这里"
              :class="
                fileDragging
                  ? 'border-primary-400 bg-primary-50 dark:bg-primary-900/20'
                  : 'border-slate-200 dark:border-slate-600 hover:border-primary-300'
              "
              @click="fileInput?.click()"
              @dragenter.prevent="onFileDragEnter"
              @dragover.prevent
              @dragleave.prevent="onFileDragLeave"
              @drop.prevent="onFileDrop"
            >
              <div
                class="w-9 h-9 mx-auto rounded-full bg-primary-50 dark:bg-primary-900/30 text-action flex items-center justify-center text-lg font-bold"
              >
                ＋
              </div>
              <p class="text-xs text-slate-500 dark:text-slate-400 mt-2">点击选择文件，或将文件拖拽到此处</p>
              <p class="text-xs text-muted mt-0.5">
                单个文件 ≤ {{ FILE_SIZE_LIMIT_KB }}KB（内嵌云端同步上限 1MB，更大的文件请改用链接引用）
              </p>
            </button>
            <div
              v-else
              class="flex items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-600 px-3 py-2.5"
            >
              <span class="text-lg"></span>
              <span class="flex-1 text-xs truncate">{{ form.fileName }}</span>
              <button
                type="button"
                class="min-h-11 min-w-11 text-xs text-action hover:underline shrink-0"
                @click="fileInput?.click()"
              >
                更换
              </button>
              <button
                type="button"
                class="min-h-11 min-w-11 text-xs text-correction hover:underline shrink-0"
                @click="clearFile"
              >
                移除
              </button>
            </div>
            <input ref="fileInput" type="file" class="hidden" @change="onFileChange" />
          </template>
        </div>
        <div v-if="form.type === 'book'" class="grid grid-cols-2 gap-2">
          <div>
            <label class="label" for="mat-total-pages">总页数</label
            ><input id="mat-total-pages" v-model.number="form.totalPages" type="number" min="0" class="input" />
          </div>
          <div>
            <label class="label" for="mat-read-pages">已读页数</label
            ><input id="mat-read-pages" v-model.number="form.readPages" type="number" min="0" class="input" />
          </div>
        </div>
        <textarea
          v-model="form.notes"
          rows="3"
          class="input"
          aria-label="阅读笔记摘抄…"
          placeholder="阅读笔记摘抄…"
        ></textarea>
      </div>
      <template #footer>
        <button v-if="form.id" class="btn-danger mr-auto" @click="remove">删除</button>
        <button class="btn-ghost" @click="showModal = false">取消</button>
        <button class="btn-primary" :disabled="fileReading" @click="save">
          {{ fileReading ? '正在读取文件…' : '保存' }}
        </button>
      </template>
    </Modal>
  </div>
</template>
