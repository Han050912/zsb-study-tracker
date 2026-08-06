<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { getDocument, classifyPdfError } from '../utils/pdf'
import type { PDFDocumentLoadingTask } from 'pdfjs-dist/types/src/display/api'
import Modal from './Modal.vue'

/**
 * PDF 预览弹窗：canvas 逐页渲染，支持翻页查看；
 * 「导入为笔记」由父组件监听 import 事件后执行文本提取。
 */
const props = defineProps<{ show: boolean; file: File | null }>()
const emit = defineEmits<{ close: []; import: [] }>()

const canvasRef = ref<HTMLCanvasElement>()
const pageNum = ref(1)
const pageCount = ref(0)
const loading = ref(false)
const loadError = ref('')

let loadingTask: PDFDocumentLoadingTask | null = null
let doc: any = null
let renderSeq = 0 // 渲染序号：翻页/关闭竞态时丢弃过期渲染

async function loadDoc() {
  if (!props.file) return
  loading.value = true
  loadError.value = ''
  pageNum.value = 1
  try {
    const buf = await props.file.arrayBuffer()
    loadingTask = getDocument({ data: buf })
    doc = await loadingTask.promise
    pageCount.value = doc.numPages
    await renderPage()
  } catch (e: unknown) {
    console.error('PDF preview load failed:', e)
    loadError.value = classifyPdfError(e)
  } finally {
    loading.value = false
  }
}

async function renderPage() {
  if (!doc) return
  const seq = ++renderSeq
  await nextTick()
  const canvas = canvasRef.value
  if (!canvas) return
  try {
    const page = await doc.getPage(pageNum.value)
    if (seq !== renderSeq) return // 期间已翻页/关闭，丢弃本次渲染
    // 按容器宽度自适应缩放，限制 DPR 避免高分屏内存膨胀
    const containerWidth = Math.min(canvas.parentElement?.clientWidth || 640, 720)
    const base = page.getViewport({ scale: 1 })
    const scale = (containerWidth / base.width) * Math.min(window.devicePixelRatio || 1, 2)
    const viewport = page.getViewport({ scale })
    canvas.width = viewport.width
    canvas.height = viewport.height
    canvas.style.width = '100%'
    canvas.style.height = 'auto'
    await page.render({ canvasContext: canvas.getContext('2d')!, viewport }).promise
    page.cleanup()
  } catch {
    if (seq === renderSeq) loadError.value = '页面渲染失败'
  }
}

function go(delta: number) {
  const next = pageNum.value + delta
  if (next < 1 || next > pageCount.value) return
  pageNum.value = next
  renderPage()
}

watch(() => props.show, async (v) => {
  if (v) {
    await loadDoc()
  } else {
    renderSeq++
    if (loadingTask) { loadingTask.destroy().catch(() => {}); loadingTask = null }
    doc = null
    pageCount.value = 0
    loadError.value = ''
  }
})
</script>

<template>
  <Modal :title="file ? `PDF 预览 · ${file.name}` : 'PDF 预览'" :show="show" @close="emit('close')">
    <div class="space-y-3">
      <div v-if="loading" class="text-center text-xs text-slate-400 py-10">PDF 加载中…</div>
      <div v-else-if="loadError" class="text-center text-xs text-red-400 py-10">{{ loadError }}</div>
      <template v-else>
        <div class="flex items-center justify-between text-xs text-slate-500">
          <button class="btn-ghost !py-1 !px-2" :disabled="pageNum <= 1" @click="go(-1)">← 上一页</button>
          <span>{{ pageNum }} / {{ pageCount }} 页</span>
          <button class="btn-ghost !py-1 !px-2" :disabled="pageNum >= pageCount" @click="go(1)">下一页 →</button>
        </div>
        <div class="max-h-[55vh] overflow-y-auto rounded-lg border border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-900">
          <canvas ref="canvasRef" class="mx-auto"></canvas>
        </div>
      </template>
    </div>
    <template #footer>
      <button class="btn-ghost" @click="emit('close')">关闭</button>
      <button class="btn-primary" :disabled="loading || !!loadError || !pageCount" @click="emit('import')">📝 提取文本导入为笔记</button>
    </template>
  </Modal>
</template>
