<script setup lang="ts">
import type { Component } from 'vue'

defineProps<{ icon: Component; label: string; disabled?: boolean }>()
const emit = defineEmits<{ click: [event: MouseEvent] }>()
</script>

<template>
  <button
    type="button"
    class="arrow-control"
    :aria-label="label"
    :disabled="disabled"
    @click.stop="emit('click', $event)"
  >
    <component :is="icon" :size="18" aria-hidden="true" />
  </button>
</template>
