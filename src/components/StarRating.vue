<script setup lang="ts">
const props = withDefaults(defineProps<{ modelValue: number; readonly?: boolean }>(), { readonly: false })
const emit = defineEmits<{ 'update:modelValue': [number] }>()

function set(v: number) {
  if (!props.readonly) emit('update:modelValue', v)
}
</script>

<template>
  <span class="inline-flex gap-0.5" role="radiogroup" aria-label="掌握度评分">
    <!-- 视觉尺寸不变（★ 仍 16px、间距仍 2px），命中区由 after 伪元素扩到本排版的安全上限 18×28：
         相邻星中心距 18px、相邻知识点行 30px，再扩就会被后绘制的邻星/下一行抢占
         （点本星却改到邻星），44×44 需要 44px 的星间距（整组会从 88px 撑到 228px） -->
    <button
      v-for="i in 5"
      :key="i"
      type="button"
      :disabled="readonly"
      class="relative text-base leading-none transition-transform after:absolute after:-inset-x-px after:-inset-y-1.5 after:content-[''] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
      :class="[
        i <= modelValue ? 'text-amber-400' : 'text-slate-300 dark:text-slate-600',
        readonly ? 'cursor-default' : 'hover:scale-125 cursor-pointer'
      ]"
      :aria-checked="i === modelValue"
      role="radio"
      @click="set(i)"
    >
      ★
    </button>
  </span>
</template>
