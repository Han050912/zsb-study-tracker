<script setup lang="ts">
import { Heart } from '@lucide/vue'

const props = withDefaults(defineProps<{ liked: boolean; count: number; vertical?: boolean }>(), { vertical: false })
const emit = defineEmits<{ toggle: [] }>()
</script>

<template>
  <button
    type="button"
    class="transition-colors select-none"
    :class="[
      props.vertical ? 'flex flex-col items-center gap-0.5' : 'inline-flex items-center gap-1 text-xs',
      props.liked ? 'text-action' : 'text-slate-400 hover:text-action'
    ]"
    :aria-pressed="props.liked"
    :aria-label="props.liked ? '取消点赞' : '点赞'"
    @click.stop="emit('toggle')"
  >
    <Heart
      :size="props.vertical ? 21 : 17"
      :stroke-width="1.75"
      :fill="props.liked ? 'currentColor' : 'none'"
      aria-hidden="true"
    />
    <span :class="props.vertical ? 'text-xs' : ''">{{ props.count || '' }}</span>
  </button>
</template>
