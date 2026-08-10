<script setup lang="ts">
import { ref } from 'vue'

const props = defineProps<{ liked: boolean; count: number }>()
const emit = defineEmits<{ toggle: [] }>()

/** 点赞缩放动效触发器：每次点击重新触发动画 */
const beating = ref(false)
function onClick() {
  beating.value = false
  requestAnimationFrame(() => { beating.value = true })
  emit('toggle')
}
</script>

<template>
  <button type="button"
    class="inline-flex items-center gap-1 text-xs transition-colors select-none"
    :class="props.liked ? 'text-rose-500' : 'text-slate-400 hover:text-rose-400'"
    :aria-pressed="props.liked"
    @click.stop="onClick">
    <span :class="{ 'animate-like': beating }">{{ props.liked ? '❤️' : '🤍' }}</span>
    <span>{{ props.count || '' }}</span>
  </button>
</template>

<style scoped>
@keyframes like-beat {
  0% { transform: scale(1); }
  40% { transform: scale(1.35); }
  100% { transform: scale(1); }
}
.animate-like { animation: like-beat 0.3s ease; display: inline-block; }
</style>
