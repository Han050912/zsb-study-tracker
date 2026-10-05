<script setup lang="ts">
import { ThumbsDown } from '@lucide/vue'

const props = defineProps<{ disliked: boolean; count: number }>()
const emit = defineEmits<{ toggle: [] }>()
</script>

<template>
  <button
    type="button"
    class="inline-flex items-center gap-1 text-xs transition-colors select-none"
    :class="props.disliked ? 'text-action' : 'text-muted hover:text-action'"
    :aria-pressed="props.disliked"
    :aria-label="props.disliked ? '取消不赞同' : '不赞同'"
    @click.stop="emit('toggle')"
  >
    <ThumbsDown :size="17" :stroke-width="1.75" aria-hidden="true" />
    <span>{{ props.count || '' }}</span>
  </button>
</template>
