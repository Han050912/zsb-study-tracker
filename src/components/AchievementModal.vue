<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import PostComposer from './community/PostComposer.vue'

interface Ach { id: string; name: string; desc: string; icon: string }
const current = ref<Ach | null>(null)
const confetti = ref<number[]>([])
/** 彩纸色板（纯 CSS 色块替代 emoji，避免跨端渲染不一致） */
const CONFETTI_COLORS = ['#f59e0b', '#3b82f6', '#10b981', '#ef4444', '#8b5cf6', '#ec4899']

// ---- 分享到社区广场 ----
const showComposer = ref(false)
const shareContent = ref('')
const shareRefId = ref('')

function onUnlock(e: Event) {
  current.value = (e as CustomEvent).detail
  confetti.value = Array.from({ length: 30 }, (_, i) => i)
  setTimeout(() => { current.value = null; confetti.value = [] }, 3500)
}

/** 「炫耀一下」：生成成就展示帖，可编辑后发布 */
function share() {
  if (!current.value) return
  shareContent.value = `我解锁了成就「${current.value.name}」！\n${current.value.icon} ${current.value.desc}\n继续加油，下一个成就见！`
  shareRefId.value = current.value.id
  current.value = null
  confetti.value = []
  showComposer.value = true
}

onMounted(() => window.addEventListener('achievement', onUnlock))
onUnmounted(() => window.removeEventListener('achievement', onUnlock))
</script>

<template>
  <Teleport to="body">
    <div v-if="current" class="fixed inset-0 z-[60] flex items-center justify-center bg-black/40" @click="current = null">
      <span v-for="i in confetti" :key="i" class="fixed top-0 w-2 h-3 rounded-sm pointer-events-none"
        :style="{ left: (i * 37 % 100) + 'vw', background: CONFETTI_COLORS[i % CONFETTI_COLORS.length], animation: `confetti-fall ${2 + (i % 5) * 0.3}s linear ${(i % 10) * 0.15}s forwards` }"></span>
      <div class="card !p-8 text-center animate-pop max-w-xs mx-4" @click.stop>
        <div class="text-6xl mb-3">{{ current.icon }}</div>
        <div class="text-xs text-primary-500 font-semibold mb-1">成就解锁！</div>
        <div class="text-xl font-bold">{{ current.name }}</div>
        <div class="text-sm text-slate-500 mt-1">{{ current.desc }}</div>
        <button class="btn-primary w-full mt-4" @click="share">炫耀一下</button>
      </div>
    </div>
  </Teleport>
  <PostComposer v-model:show="showComposer" type="achievement" :preset-content="shareContent"
    ref-type="achievement" :ref-id="shareRefId" />
</template>
