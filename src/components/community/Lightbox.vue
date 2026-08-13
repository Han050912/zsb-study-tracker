<script setup lang="ts">
import { onUnmounted, watch } from 'vue'
import { imageUrl } from '../../api/community'

/** 图片灯箱预览：左右切换 + Esc/点击遮罩关闭 */
const props = withDefaults(defineProps<{
  show: boolean
  urls: string[]
  index?: number
}>(), { index: 0 })

const emit = defineEmits<{ 'update:show': [boolean]; 'update:index': [number] }>()

function close() { emit('update:show', false) }
function prev() { if (props.index > 0) emit('update:index', props.index - 1) }
function next() { if (props.index < props.urls.length - 1) emit('update:index', props.index + 1) }

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
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="show" class="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 p-4" @click.self="close">
        <img :src="imageUrl(urls[index])" class="max-w-full max-h-full object-contain rounded-lg" alt="图片预览" />
        <button class="absolute top-4 right-4 w-9 h-9 rounded-full bg-white/15 text-white text-xl leading-none hover:bg-white/25"
          @click="close" aria-label="关闭">×</button>
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
