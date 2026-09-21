<script setup lang="ts">
import { ref } from 'vue'
import { ThumbsDown } from '@lucide/vue'

const props = defineProps<{ disliked: boolean; count: number }>()
const emit = defineEmits<{ toggle: [] }>()

const beating = ref(false)
function onClick() {
  beating.value = false
  requestAnimationFrame(() => {
    beating.value = true
  })
  emit('toggle')
}
</script>

<template>
  <button
    type="button"
    class="inline-flex items-center gap-1 text-xs transition-colors select-none"
    :class="
      props.disliked ? 'text-slate-600 dark:text-slate-300' : 'text-slate-300 dark:text-slate-600 hover:text-slate-500'
    "
    :aria-pressed="props.disliked"
    :aria-label="props.disliked ? '取消点踩' : '点踩'"
    @click.stop="onClick"
  >
    <ThumbsDown
      :size="17"
      :stroke-width="1.75"
      :class="{ 'animate-like': beating }"
      aria-hidden="true"
      @animationend="beating = false"
    />
    <span>{{ props.count || '' }}</span>
  </button>
</template>

<style scoped>
@keyframes like-beat {
  0% {
    transform: scale(1);
  }
  40% {
    transform: scale(1.16);
  }
  100% {
    transform: scale(1);
  }
}
.animate-like {
  animation: like-beat var(--motion-enter) ease;
  display: inline-block;
}
</style>
