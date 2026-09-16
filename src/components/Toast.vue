<script setup lang="ts">
import { ref } from 'vue'
import { OVERLAY_LAYER } from '../composables/useOverlayDismiss'

const visible = ref(false)
const message = ref('')
let timer: ReturnType<typeof setTimeout> | null = null

function show(msg: string) {
  message.value = msg
  visible.value = true
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => (visible.value = false), 2000)
}
defineExpose({ show })
</script>

<template>
  <Teleport to="body">
    <!-- 常驻 aria-live 容器：提示注入到「已存在」的 live region 中，读屏器才会可靠播报；
         z-[100] 保证提示永远浮在所有弹层之上（含 Lightbox 的深色遮罩） -->
    <div
      role="status"
      aria-live="polite"
      class="fixed top-6 inset-x-0 flex justify-center pointer-events-none"
      :class="OVERLAY_LAYER.toast"
    >
      <Transition name="fade">
        <div
          v-if="visible"
          class="bg-slate-800 dark:bg-slate-200 text-white dark:text-slate-800 text-sm px-4 py-2 rounded-full shadow-lg"
        >
          {{ message }}
        </div>
      </Transition>
    </div>
  </Teleport>
</template>
