<script setup lang="ts">
import { ref } from 'vue'
import { Star } from '@lucide/vue'

const props = withDefaults(defineProps<{ modelValue: number; readonly?: boolean; label?: string }>(), {
  readonly: false,
  label: '知识点自评'
})
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
  <span ref="groupEl" class="inline-flex shrink-0" role="radiogroup" :aria-label="label" @keydown="onKeydown">
    <button
      v-for="i in 5"
      :key="i"
      type="button"
      data-star
      :disabled="readonly"
      :tabindex="i === (modelValue || 1) ? 0 : -1"
      class="inline-flex items-center justify-center w-7 h-9 rounded leading-none hover:bg-action-soft active:bg-surface-soft"
      :class="[i <= modelValue ? 'text-action' : 'text-muted', readonly ? 'cursor-default' : 'cursor-pointer']"
      :aria-checked="i === modelValue"
      :aria-label="`${i} 分，满分 5 分`"
      role="radio"
      @click="set(i)"
    >
      <!-- 空星描边、选中星实心（currentColor 随 text-* 着色，深浅色主题下轮廓均 ≥3:1） -->
      <Star class="block w-4 h-4" :fill="i <= modelValue ? 'currentColor' : 'none'" aria-hidden="true" />
    </button>
  </span>
</template>
