<script setup lang="ts">
import { ref } from 'vue'
import { Heart } from '@lucide/vue'

const props = withDefaults(defineProps<{ liked: boolean; count: number; vertical?: boolean }>(), { vertical: false })
const emit = defineEmits<{ toggle: [] }>()

/** 点赞缩放动效触发器：每次点击重新触发动画 */
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
    class="transition-colors select-none"
    :class="[
      props.vertical ? 'flex flex-col items-center gap-0.5' : 'inline-flex items-center gap-1 text-xs',
      props.liked ? 'text-rose-500' : 'text-slate-400 hover:text-rose-400'
    ]"
    :aria-pressed="props.liked"
    :aria-label="props.liked ? '取消点赞' : '点赞'"
    @click.stop="onClick"
  >
    <Heart
      :size="props.vertical ? 21 : 17"
      :stroke-width="1.75"
      :fill="props.liked ? 'currentColor' : 'none'"
      :class="{ 'animate-like': beating }"
      aria-hidden="true"
      @animationend="beating = false"
    />
    <span :class="props.vertical ? 'text-xs' : ''">{{ props.count || '' }}</span>
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
