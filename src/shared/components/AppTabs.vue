<script setup lang="ts">
const props = defineProps<{
  modelValue: string
  items: { value: string; label: string }[]
  label: string
  id: string
}>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
function move(event: KeyboardEvent, index: number) {
  const offset = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
  if (!offset && event.key !== 'Home' && event.key !== 'End') return
  event.preventDefault()
  const next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? props.items.length - 1
        : (index + offset + props.items.length) % props.items.length
  emit('update:modelValue', props.items[next].value)
  ;(event.currentTarget as HTMLElement).parentElement?.querySelectorAll<HTMLButtonElement>('[role=tab]')[next]?.focus()
}
</script>
<template>
  <div role="tablist" :aria-label="label" class="app-tabs">
    <button
      v-for="(item, index) in items"
      :id="`${id}-tab-${item.value}`"
      :key="item.value"
      role="tab"
      type="button"
      :aria-selected="modelValue === item.value"
      :aria-controls="`${id}-panel`"
      :tabindex="modelValue === item.value ? 0 : -1"
      @click="emit('update:modelValue', item.value)"
      @keydown="move($event, index)"
    >
      {{ item.label }}
    </button>
  </div>
</template>
