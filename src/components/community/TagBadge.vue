<script setup lang="ts">
defineProps<{ tag: string; active?: boolean }>()
const emit = defineEmits<{ click: [] }>()
</script>

<template>
  <button
    type="button"
    class="text-xs px-2 py-1 rounded-full transition-colors whitespace-nowrap shrink-0"
    :class="
      active
        ? 'bg-action text-on-action'
        : 'bg-primary-50 dark:bg-primary-900/30 text-action dark:text-action hover:bg-primary-100 dark:hover:bg-primary-900/50'
    "
    :aria-pressed="active ?? false"
    @click.stop="emit('click')"
  >
    {{ tag }}
  </button>
</template>
