<script setup lang="ts">
import { ref } from 'vue'
import { Star } from '@lucide/vue'

const props = withDefaults(defineProps<{ modelValue: number; readonly?: boolean }>(), { readonly: false })
const emit = defineEmits<{ 'update:modelValue': [number] }>()

function set(v: number) {
  if (!props.readonly) emit('update:modelValue', v)
}

/** 方向键调整评分（radiogroup 惯例：右/上加档、左/下减档，0~5 夹取；0 为未评分） */
const groupEl = ref<HTMLElement | null>(null)
function onKeydown(e: KeyboardEvent) {
  const delta =
    e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0
  if (!delta || props.readonly) return
  e.preventDefault()
  const next = Math.min(5, Math.max(0, props.modelValue + delta))
  set(next)
  // 焦点跟随到对应星档（0 档无对应星，保持原地）
  groupEl.value?.querySelectorAll<HTMLElement>('[data-star]')[next - 1]?.focus()
}
</script>

<template>
  <span ref="groupEl" class="inline-flex gap-0.5" role="radiogroup" aria-label="掌握度评分" @keydown="onKeydown">
    <!-- 视觉尺寸不变（星 16px、间距 2px），命中区由 after 伪元素扩到本排版的安全上限 18×28：
         相邻星中心距 18px、相邻知识点行 30px，再扩就会被后绘制的邻星/下一行抢占
         （点本星却改到邻星），44×44 需要 44px 的星间距（整组会从 88px 撑到 228px） -->
    <button
      v-for="i in 5"
      :key="i"
      type="button"
      data-star
      :disabled="readonly"
      class="relative leading-none transition-transform after:absolute after:-inset-x-px after:-inset-y-1.5 after:content-[''] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
      :class="[
        i <= modelValue ? 'text-amber-400' : 'text-slate-500 dark:text-slate-400',
        readonly ? 'cursor-default' : 'hover:scale-125 cursor-pointer'
      ]"
      :aria-checked="i === modelValue"
      :aria-label="`${i} 星`"
      role="radio"
      @click="set(i)"
    >
      <!-- 空星描边、选中星实心（currentColor 随 text-* 着色，深浅色主题下轮廓均 ≥3:1） -->
      <Star class="block w-4 h-4" :fill="i <= modelValue ? 'currentColor' : 'none'" aria-hidden="true" />
    </button>
  </span>
</template>
