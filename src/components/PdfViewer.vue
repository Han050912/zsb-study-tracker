<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { ZoomIn, ZoomOut, Maximize, FileWarning } from '@lucide/vue'
import { getDocument, classifyPdfError } from '../utils/pdf'
import type { PDFDocumentLoadingTask } from 'pdfjs-dist/types/src/display/api'

/**
 * PDF 连续滚动查看器：与系统 PDF 查看器一致的阅读体验。
 * - 全部页面纵向连续滚动，IntersectionObserver 懒渲染（只渲染视口附近的页）
 * - 工具栏：页码指示、缩小 / 放大 / 适应宽度；放大后页面超出容器可横向滚动
 * props.bytes 为 PDF 原始字节（由父组件从云端 R2 拉取），null 表示加载中。
 */
const props = defineProps<{ bytes: Uint8Array | null }>()

const scrollerRef = ref<HTMLElement>()
const loading = ref(true)
const loadError = ref('')
const pageCount = ref(0)
const currentPage = ref(1)
/** 用户缩放倍率（1 = 适应容器宽度） */
const zoom = ref(1)
/** 各页占位纵横比（宽/高），保证未渲染页也占住正确高度，避免全部页挤在顶部同时触发渲染 */
const pageRatios = ref<number[]>([])

let loadingTask: PDFDocumentLoadingTask | null = null
let doc: any = null
let renderSeq = 0
let observer: IntersectionObserver | null = null
/** 页码从 1 开始，下标 0 空置 */
const pageEls: (HTMLElement | null)[] = []
const renderedPages = new Set<number>()

async function load() {
  loading.value = true
  loadError.value = ''
  pageCount.value = 0
  currentPage.value = 1
  renderedPages.clear()
  pageEls.length = 0
  const seq = ++renderSeq
  // 字节未就绪（父组件仍在回源拉取）：保持加载态等待 props.bytes 变化触发重新 load
  if (!props.bytes) return
  try {
    // slice() 拷贝一份：pdf.js 默认将 data 转移给 worker，原缓冲区会被 neuter
    loadingTask = getDocument({ data: props.bytes.slice() })
    doc = await loadingTask.promise
    if (seq !== renderSeq) return
    pageCount.value = doc.numPages
    // 以第 1 页纵横比作为所有页占位（绝大多数 PDF 页面尺寸一致，渲染时再逐页校正）
    const first = await doc.getPage(1)
    const vp = first.getViewport({ scale: 1 })
    pageRatios.value = Array.from({ length: doc.numPages }, () => vp.width / vp.height)
    first.cleanup()
  } catch (e: unknown) {
    if (seq === renderSeq) loadError.value = classifyPdfError(e)
    doc = null
  } finally {
    if (seq === renderSeq) loading.value = false
  }
  if (doc) {
    await nextTick()
    setupObserver()
  }
}

/** 页占位元素挂载回调（v-for ref） */
function setPageEl(el: any, page: number) {
  pageEls[page] = el as HTMLElement | null
}

async function renderPage(pageNum: number) {
  if (!doc || renderedPages.has(pageNum)) return
  renderedPages.add(pageNum)
  const seq = renderSeq
  const el = pageEls[pageNum]
  const canvas = el?.querySelector('canvas')
  if (!el || !canvas) { renderedPages.delete(pageNum); return }
  try {
    const page = await doc.getPage(pageNum)
    if (seq !== renderSeq) return
    // 占位宽度 × DPR（上限 2），canvas 像素高于显示尺寸保证清晰度
    const displayWidth = el.clientWidth || 640
    const base = page.getViewport({ scale: 1 })
    const scale = (displayWidth / base.width) * Math.min(window.devicePixelRatio || 1, 2)
    const viewport = page.getViewport({ scale })
    canvas.width = viewport.width
    canvas.height = viewport.height
    await page.render({ canvasContext: canvas.getContext('2d')!, viewport }).promise
    // 校正该页真实纵横比（个别页尺寸不同的文档）
    if (pageRatios.value[pageNum - 1] !== base.width / base.height) {
      pageRatios.value[pageNum - 1] = base.width / base.height
    }
    page.cleanup()
  } catch {
    renderedPages.delete(pageNum)
  }
}

/** 缩放变化：清空渲染状态，observer 按需重渲染可视页 */
function reRenderAll() {
  if (!doc) return
  renderedPages.clear()
  nextTick(() => observeAllPages())
}

function observeAllPages() {
  if (!observer) return
  for (let p = 1; p <= pageCount.value; p++) {
    const el = pageEls[p]
    if (el) observer.observe(el)
  }
}

function setupObserver() {
  observer?.disconnect()
  observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      const page = Number((entry.target as HTMLElement).dataset.page)
      if (page) renderPage(page)
    }
  }, { root: scrollerRef.value, rootMargin: '400px 0px' })
  observeAllPages()
}

/** 滚动时以视口顶部附近的页作为当前页码 */
function onScroll() {
  const scroller = scrollerRef.value
  if (!scroller) return
  const top = scroller.scrollTop
  let best = 1
  for (let p = 1; p <= pageCount.value; p++) {
    const el = pageEls[p]
    if (el && el.offsetTop - scroller.clientHeight / 3 <= top) best = p
  }
  currentPage.value = best
}

function zoomBy(delta: number) {
  const next = Math.round((zoom.value + delta) * 10) / 10
  zoom.value = Math.min(3, Math.max(0.5, next))
  reRenderAll()
}

function fitWidth() {
  zoom.value = 1
  reRenderAll()
}

function destroy() {
  renderSeq++
  observer?.disconnect()
  observer = null
  if (loadingTask) { loadingTask.destroy().catch(() => {}); loadingTask = null }
  doc = null
  // 释放 DOM 引用与渲染记录，避免组件反复挂载/卸载时的内存泄漏
  pageEls.length = 0
  renderedPages.clear()
}

watch(() => props.bytes, () => { destroy(); load() })
onMounted(load)
onUnmounted(destroy)
</script>

<template>
  <div class="flex flex-col h-full min-h-0">
    <!-- 工具栏：页码 + 缩放，与常见 PDF 查看器一致 -->
    <div class="flex items-center justify-between px-3 py-2 bg-white dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700 text-xs text-slate-500 shrink-0">
      <span v-if="pageCount">{{ currentPage }} / {{ pageCount }} 页</span>
      <span v-else>&nbsp;</span>
      <div class="flex items-center gap-1">
        <button class="btn-ghost !p-1.5" title="缩小" :disabled="zoom <= 0.5" @click="zoomBy(-0.1)">
          <ZoomOut :size="16" />
        </button>
        <span class="w-12 text-center tabular-nums">{{ Math.round(zoom * 100) }}%</span>
        <button class="btn-ghost !p-1.5" title="放大" :disabled="zoom >= 3" @click="zoomBy(0.1)">
          <ZoomIn :size="16" />
        </button>
        <button class="btn-ghost !p-1.5" title="适应宽度" @click="fitWidth">
          <Maximize :size="16" />
        </button>
      </div>
    </div>

    <!-- 连续滚动页面区：放大后页宽超过容器，支持横向滚动 -->
    <div ref="scrollerRef" class="flex-1 min-h-0 overflow-auto bg-slate-100 dark:bg-slate-900 p-3" @scroll.passive="onScroll">
      <div v-if="loading" class="text-center text-xs text-slate-400 py-10">PDF 加载中…</div>
      <div v-else-if="loadError" class="flex flex-col items-center gap-2 text-red-400 py-10">
        <FileWarning :size="32" />
        <span class="text-xs">{{ loadError }}</span>
      </div>
      <div v-else class="space-y-3 mx-auto" :style="{ width: `${zoom * 100}%`, minWidth: 'min(100%, 280px)' }">
        <div v-for="p in pageCount" :key="p" :ref="(el) => setPageEl(el, p)" :data-page="p"
          class="rounded-lg shadow-sm bg-white dark:bg-slate-800 overflow-hidden"
          :style="{ aspectRatio: String(pageRatios[p - 1] || 0.707) }">
          <canvas class="block w-full h-full"></canvas>
        </div>
      </div>
    </div>
  </div>
</template>
