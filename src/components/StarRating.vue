<script setup lang="ts">
const props = withDefaults(defineProps<{ modelValue: number; readonly?: boolean }>(), { readonly: false })
const emit = defineEmits<{ 'update:modelValue': [number] }>()

function set(v: number) {
  if (!props.readonly) emit('update:modelValue', v)
}
</script>

<template>
  <span class="inline-flex gap-0.5" role="radiogroup" aria-label="掌握度评分">
    <button v-for="i in 5" :key="i" type="button" :disabled="readonly"
      class="text-base leading-none transition-transform"
      :class="[i <= modelValue ? 'text-amber-400' : 'text-slate-300 dark:text-slate-600', readonly ? 'cursor-default' : 'hover:scale-125 cursor-pointer']"
      :aria-checked="i === modelValue" role="radio"
      @click="set(i)">★</button>
  </span>
</template>
