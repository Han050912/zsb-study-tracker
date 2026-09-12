<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { ImageOff } from '@lucide/vue'
import { resolveErrorImageUrl } from '../api/errorImages'

/**
 * 统一异步图片组件：渲染引用式私有图片（'r2:<id>'）。
 * 经认证通道拉取字节转 blob URL（会话级缓存，见 resolveErrorImageUrl）；
 * 加载中显示骨架占位、失败显示占位提示；点击抛出已解析的真实 URL 供放大查看。
 * 注意：组件为多根节点（fragment），class 不会自动透传；调用方须用 imgClass 传样式类。
 */
const props = defineProps<{ image: string; alt?: string; imgClass?: string }>()
const emit = defineEmits<{ open: [url: string] }>()

const src = ref('')
const imgEl = ref<HTMLImageElement | null>(null)
const failed = ref(false)
let seq = 0

async function resolve() {
  const s = ++seq
  src.value = ''
  failed.value = false
  try {
    const url = await resolveErrorImageUrl(props.image)
    if (s !== seq) return
    src.value = url
  } catch {
    if (s !== seq) return
    failed.value = true
  }
}

onMounted(resolve)
watch(() => props.image, resolve)

/** 仅在事件来自当前绑定元素时置失败态，避免已卸载旧元素迟到的 error 误伤新图 */
function onDecodeError(e: Event) {
  if (e.target !== imgEl.value) return
  src.value = ''
  failed.value = true
}
</script>

<template>
  <img
    v-if="src"
    ref="imgEl"
    :src="src"
    :alt="alt || ''"
    :class="imgClass"
    @error="onDecodeError"
    @click="emit('open', src)"
  />
  <div
    v-else-if="failed"
    :class="imgClass"
    class="flex items-center justify-center text-slate-400 bg-slate-50 dark:bg-slate-700/50"
  >
    <ImageOff :size="20" aria-hidden="true" />
  </div>
  <div v-else :class="imgClass" class="animate-pulse bg-slate-100 dark:bg-slate-700" />
</template>
