<script setup lang="ts">
import { onUnmounted, ref, watch } from 'vue'
import { imageUrl } from '../../api/community'
import { useOverlayDismiss } from '../../composables/useOverlayDismiss'

/** 图片灯箱预览：左右切换 + Esc/点击遮罩关闭 + 缩放查看原图（点击切换 / 滚轮缩放 / 拖拽平移） */
const props = withDefaults(defineProps<{
  show: boolean
  urls: string[]
  index?: number
}>(), { index: 0 })

const emit = defineEmits<{ 'update:show': [boolean]; 'update:index': [number] }>()

function close() { emit('update:show', false) }
function prev() { if (props.index > 0) emit('update:index', props.index - 1) }
function next() { if (props.index < props.urls.length - 1) emit('update:index', props.index + 1) }

const { onOverlayMousedown, onOverlayClick } = useOverlayDismiss(close)

function onKey(e: KeyboardEvent) {
  if (!props.show) return
  if (e.key === 'Escape') close()
  else if (e.key === 'ArrowLeft') prev()
  else if (e.key === 'ArrowRight') next()
}

watch(() => props.show, v => {
  if (v) window.addEventListener('keydown', onKey)
  else window.removeEventListener('keydown', onKey)
})
onUnmounted(() => window.removeEventListener('keydown', onKey))

// ---- 缩放查看原图 ----
const scale = ref(1)
const tx = ref(0)
const ty = ref(0)
const dragging = ref(false)
let startX = 0
let startY = 0
let startTx = 0
let startTy = 0

function resetTransform() { scale.value = 1; tx.value = 0; ty.value = 0 }
watch(() => props.index, resetTransform)
watch(() => props.show, v => { if (v) resetTransform() })

function onWheel(e: WheelEvent) {
  e.preventDefault()
  const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15
  scale.value = Math.min(5, Math.max(1, scale.value * factor))
  if (scale.value <= 1) { tx.value = 0; ty.value = 0 }
}

/** 点击图片：1x 与 3x 之间切换（缩放查看原图细节） */
function toggleZoom() {
  if (scale.value > 1) { scale.value = 1; tx.value = 0; ty.value = 0 }
  else scale.value = 3
}

function onImgMousedown(e: MouseEvent) {
  if (scale.value <= 1) return
  dragging.value = true
  startX = e.clientX; startY = e.clientY
  startTx = tx.value; startTy = ty.value
  window.addEventListener('mousemove', onPan)
  window.addEventListener('mouseup', onPanEnd)
}
function onPan(e: MouseEvent) {
  if (!dragging.value) return
  tx.value = startTx + (e.clientX - startX)
  ty.value = startTy + (e.clientY - startY)
}
function onPanEnd() {
  dragging.value = false
  window.removeEventListener('mousemove', onPan)
  window.removeEventListener('mouseup', onPanEnd)
}
onUnmounted(onPanEnd)
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="show" class="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 p-4 overflow-hidden"
        @mousedown="onOverlayMousedown" @click="onOverlayClick" @wheel="onWheel">
        <img :src="imageUrl(urls[index])"
          class="max-w-full max-h-full object-contain rounded-lg select-none"
          :class="scale > 1 ? (dragging ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-zoom-in'"
          :style="{ transform: `translate(${tx}px, ${ty}px) scale(${scale})` }"
          alt="图片预览" draggable="false"
          @click.stop="toggleZoom" @mousedown.stop.prevent="onImgMousedown" />
        <button class="absolute top-4 right-4 w-9 h-9 rounded-full bg-white/15 text-white text-xl leading-none hover:bg-white/25"
          @click="close" aria-label="关闭">×</button>
        <div v-if="scale > 1" class="absolute top-4 left-4 text-white/60 text-xs">缩放 {{ Math.round(scale * 100) }}%（点击图片复位）</div>
        <template v-if="urls.length > 1">
          <button v-if="index > 0"
            class="absolute left-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-white/15 text-white text-lg hover:bg-white/25"
            @click.stop="prev" aria-label="上一张">‹</button>
          <button v-if="index < urls.length - 1"
            class="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-white/15 text-white text-lg hover:bg-white/25"
            @click.stop="next" aria-label="下一张">›</button>
          <div class="absolute bottom-4 inset-x-0 text-center text-white/70 text-xs">{{ index + 1 }} / {{ urls.length }}</div>
        </template>
      </div>
    </Transition>
  </Teleport>
</template>
