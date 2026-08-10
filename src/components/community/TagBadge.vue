<script setup lang="ts">
defineProps<{ tag: string; active?: boolean }>()
const emit = defineEmits<{ click: [] }>()
</script>

<template>
  <button type="button"
    class="text-xs px-2 py-1 rounded-full transition-colors"
    :class="active
      ? 'bg-primary-500 text-white'
      : 'bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 hover:bg-primary-100 dark:hover:bg-primary-900/50'"
    @click.stop="emit('click')">
    {{ tag }}
  </button>
</template>
