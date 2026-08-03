<script setup lang="ts">
import { computed, inject, ref } from 'vue'
import { useAppStore } from '../stores/app'
import Modal from '../components/Modal.vue'
import { normalizeUrl } from '../utils/url'
import type { Material } from '../types'

const store = useAppStore()
const toast = inject<(m: string) => void>('toast', () => {})

const filterType = ref('')
const filterSubject = ref('')

const TYPES = [
  { k: 'book', l: '📕 书籍' }, { k: 'video', l: '🎬 视频' }, { k: 'link', l: '🔗 链接' }, { k: 'doc', l: '📄 文档' }
]

const list = computed(() => {
  let l = store.materials.slice().reverse()
  if (filterType.value) l = l.filter(m => m.type === filterType.value)
  if (filterSubject.value) l = l.filter(m => m.subjectId === filterSubject.value)
  return l
})

const showModal = ref(false)
const form = ref<Partial<Material>>({ type: 'book', priority: '中' })
function open(m?: Material) {
  form.value = m ? { ...m } : { type: 'book', priority: '中', title: '' }
  // 编辑已有资料时，根据 url 形态还原链接模式
  linkMode.value = m?.fileName || (m?.url && m.url.startsWith('data:')) ? 'file' : 'url'
  showModal.value = true
}
function save() {
  if (!form.value.title?.trim()) { toast('请填写标题'); return }
  if (linkMode.value === 'url') form.value.fileName = undefined
  if (form.value.id) store.updateMaterial(form.value.id, form.value)
  else store.addMaterial(form.value as any)
  showModal.value = false
  toast('已保存')
}

// ---- 链接输入 / 文件上传 双模式 ----
const linkMode = ref<'url' | 'file'>('url')
const fileInput = ref<HTMLInputElement>()
const fileDragging = ref(false)
let fileDragDepth = 0
/** 上传文件大小上限（dataURL 内嵌存储，过大影响本地数据库读写性能） */
const FILE_SIZE_LIMIT = 8 * 1024 * 1024

function readMaterialFile(file: File | undefined) {
  if (!file) return
  if (file.size > FILE_SIZE_LIMIT) {
    toast(`「${file.name}」超过 8MB，建议改用链接方式引用`)
    return
  }
  const reader = new FileReader()
  reader.onload = () => {
    form.value.url = reader.result as string
    form.value.fileName = file.name
    if (!form.value.title?.trim()) form.value.title = file.name.replace(/\.[^.]+$/, '')
    toast(`已附加文件「${file.name}」`)
  }
  reader.onerror = () => toast(`读取「${file.name}」失败`)
  reader.readAsDataURL(file)
}

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  readMaterialFile(input.files?.[0])
  input.value = ''
}
function onFileDragEnter() { fileDragDepth++; fileDragging.value = true }
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
      toast('文件打开失败')
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

function remove() {
  if (!window.confirm('删除该资料？')) return
  store.deleteMaterial(form.value.id!)
  showModal.value = false
  toast('已删除')
}

const priorityColor: Record<string, string> = { 高: 'text-red-500 bg-red-50 dark:bg-red-900/30', 中: 'text-amber-500 bg-amber-50 dark:bg-amber-900/30', 低: 'text-slate-400 bg-slate-50 dark:bg-slate-700' }
</script>

<template>
  <div class="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
    <div class="flex items-center justify-between">
      <h1 class="page-title">📚 学习资料库</h1>
      <button class="btn-primary" @click="open()">+ 添加资料</button>
    </div>

    <div class="flex gap-2 flex-wrap">
      <select v-model="filterType" class="input !w-auto">
        <option value="">全部类型</option>
        <option v-for="t in TYPES" :key="t.k" :value="t.k">{{ t.l }}</option>
      </select>
      <select v-model="filterSubject" class="input !w-auto">
        <option value="">全部科目</option>
        <option v-for="s in store.subjects" :key="s.id" :value="s.id">{{ s.icon }} {{ s.name }}</option>
      </select>
    </div>

    <div v-if="!list.length" class="card text-center text-slate-400 text-sm py-10">资料库空空如也，添加你的第一本教材吧 📖</div>

    <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
      <div v-for="m in list" :key="m.id" class="card cursor-pointer hover:shadow-md transition-shadow" @click="open(m)">
        <div class="flex items-start justify-between gap-2">
          <div class="text-sm font-bold flex-1">{{ TYPES.find(t => t.k === m.type)?.l.split(' ')[0] }} {{ m.title }}</div>
          <span class="text-[10px] px-1.5 py-0.5 rounded shrink-0" :class="priorityColor[m.priority]">{{ m.priority }}</span>
        </div>
        <div class="text-xs text-slate-400 mt-1 space-x-2">
          <span v-if="m.author">✍️ {{ m.author }}</span>
          <span v-if="m.subjectId">{{ store.subjectMap[m.subjectId]?.icon }} {{ store.subjectMap[m.subjectId]?.name }}</span>
        </div>
        <div v-if="progress(m) !== null" class="mt-3">
          <div class="flex justify-between text-[10px] text-slate-400 mb-1">
            <span>阅读进度</span><span>{{ m.readPages }}/{{ m.totalPages }} 页 · {{ progress(m) }}%</span>
          </div>
          <div class="w-full h-1.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
            <div class="h-full bg-primary-400 rounded-full transition-all" :style="{ width: progress(m) + '%' }"></div>
          </div>
        </div>
        <p v-if="m.notes" class="text-xs text-slate-400 mt-2 line-clamp-2">📓 {{ m.notes }}</p>
        <button v-if="m.url" type="button" class="text-xs text-primary-500 mt-2 inline-block hover:underline" @click.stop="openLink(m.url)">
          {{ m.fileName ? `打开文件「${m.fileName}」↗` : '打开链接 ↗' }}
        </button>
      </div>
    </div>

    <Modal title="资料信息" :show="showModal" @close="showModal = false">
      <div class="space-y-3">
        <input v-model="form.title" class="input" placeholder="标题，如：《高等数学（同济版）》*" />
        <div class="grid grid-cols-3 gap-2">
          <div>
            <label class="label">类型</label>
            <select v-model="form.type" class="input">
              <option v-for="t in TYPES" :key="t.k" :value="t.k">{{ t.l }}</option>
            </select>
          </div>
          <div>
            <label class="label">科目</label>
            <select v-model="form.subjectId" class="input">
              <option :value="undefined">无</option>
              <option v-for="s in store.subjects" :key="s.id" :value="s.id">{{ s.name }}</option>
            </select>
          </div>
          <div>
            <label class="label">优先级</label>
            <select v-model="form.priority" class="input"><option>高</option><option>中</option><option>低</option></select>
          </div>
        </div>
        <input v-model="form.author" class="input" placeholder="作者 / UP主（可选）" />

        <!-- 链接 / 文件 双模式 -->
        <div>
          <div class="flex gap-1 bg-slate-100 dark:bg-slate-800 rounded-lg p-1 w-fit mb-2">
            <button type="button" class="text-xs px-3 py-1.5 rounded-md font-medium transition-colors"
              :class="linkMode === 'url' ? 'bg-white dark:bg-slate-600 shadow-sm' : 'text-slate-500'"
              @click="linkMode = 'url'">🔗 URL 链接</button>
            <button type="button" class="text-xs px-3 py-1.5 rounded-md font-medium transition-colors"
              :class="linkMode === 'file' ? 'bg-white dark:bg-slate-600 shadow-sm' : 'text-slate-500'"
              @click="linkMode = 'file'">📎 文件上传</button>
          </div>

          <input v-if="linkMode === 'url'" v-model="form.url" class="input" placeholder="链接 URL（可选），如 https://…" />

          <template v-else>
            <div v-if="!form.fileName"
              class="rounded-xl border-2 border-dashed transition-colors p-5 text-center cursor-pointer"
              :class="fileDragging ? 'border-primary-400 bg-primary-50 dark:bg-primary-900/20' : 'border-slate-200 dark:border-slate-600 hover:border-primary-300'"
              @click="fileInput?.click()"
              @dragenter.prevent="onFileDragEnter"
              @dragover.prevent
              @dragleave.prevent="onFileDragLeave"
              @drop.prevent="onFileDrop">
              <div class="w-9 h-9 mx-auto rounded-full bg-primary-50 dark:bg-primary-900/30 text-primary-500 flex items-center justify-center text-lg font-bold">＋</div>
              <p class="text-xs text-slate-500 dark:text-slate-400 mt-2">点击选择文件，或将文件拖拽到此处</p>
              <p class="text-[10px] text-slate-400 mt-0.5">单个文件 ≤ 8MB（PDF / 图片 / 文档等）</p>
            </div>
            <div v-else class="flex items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-600 px-3 py-2.5">
              <span class="text-lg">📄</span>
              <span class="flex-1 text-xs truncate">{{ form.fileName }}</span>
              <button type="button" class="text-[10px] text-primary-500 hover:underline shrink-0" @click="fileInput?.click()">更换</button>
              <button type="button" class="text-[10px] text-red-400 hover:underline shrink-0" @click="clearFile">移除</button>
            </div>
            <input ref="fileInput" type="file" class="hidden" @change="onFileChange" />
          </template>
        </div>
        <div v-if="form.type === 'book'" class="grid grid-cols-2 gap-2">
          <div><label class="label">总页数</label><input v-model.number="form.totalPages" type="number" min="0" class="input" /></div>
          <div><label class="label">已读页数</label><input v-model.number="form.readPages" type="number" min="0" class="input" /></div>
        </div>
        <textarea v-model="form.notes" rows="3" class="input" placeholder="阅读笔记摘抄…"></textarea>
      </div>
      <template #footer>
        <button v-if="form.id" class="btn-danger mr-auto" @click="remove">删除</button>
        <button class="btn-ghost" @click="showModal = false">取消</button>
        <button class="btn-primary" @click="save">保存</button>
      </template>
    </Modal>
  </div>
</template>
