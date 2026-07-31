<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'

interface Ach { id: string; name: string; desc: string; icon: string }
const current = ref<Ach | null>(null)
const confetti = ref<number[]>([])

function onUnlock(e: Event) {
  current.value = (e as CustomEvent).detail
  confetti.value = Array.from({ length: 30 }, (_, i) => i)
  setTimeout(() => { current.value = null; confetti.value = [] }, 3500)
}
onMounted(() => window.addEventListener('achievement', onUnlock))
onUnmounted(() => window.removeEventListener('achievement', onUnlock))
</script>

<template>
  <Teleport to="body">
    <div v-if="current" class="fixed inset-0 z-[60] flex items-center justify-center bg-black/40" @click="current = null">
      <span v-for="i in confetti" :key="i" class="fixed top-0 text-2xl pointer-events-none"
        :style="{ left: (i * 37 % 100) + 'vw', animation: `confetti-fall ${2 + (i % 5) * 0.3}s linear ${(i % 10) * 0.15}s forwards` }">
        {{ ['🎉', '✨', '🎊', '⭐'][i % 4] }}
      </span>
      <div class="card !p-8 text-center animate-pop max-w-xs mx-4">
        <div class="text-6xl mb-3">{{ current.icon }}</div>
        <div class="text-xs text-primary-500 font-semibold mb-1">成就解锁！</div>
        <div class="text-xl font-bold">{{ current.name }}</div>
        <div class="text-sm text-slate-500 mt-1">{{ current.desc }}</div>
      </div>
    </div>
  </Teleport>
</template>
