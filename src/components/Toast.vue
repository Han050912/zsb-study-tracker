<script setup lang="ts">
import { onBeforeUnmount } from 'vue'
import { OVERLAY_LAYER } from '../composables/useOverlayDismiss'
import { createToastQueue } from '../composables/useToast'

// 队列逻辑（多条堆叠 / 独立定时器 / 清理）见 composables/useToast.ts 的 createToastQueue
const queue = createToastQueue()
const { toasts, show } = queue

onBeforeUnmount(queue.dispose)
defineExpose({ show })
</script>

<template>
  <Teleport to="body">
    <!-- 常驻 aria-live 容器：提示注入到「已存在」的 live region 中，读屏器才会可靠播报；
         z-[100] 保证提示永远浮在所有弹层之上（含 Lightbox 的深色遮罩）。
         多条 toast 按发起顺序纵向堆叠（flex-col + gap），互不覆盖 -->
    <div
      role="status"
      aria-live="polite"
      class="fixed top-6 inset-x-0 flex flex-col items-center gap-2 pointer-events-none px-4"
      :class="OVERLAY_LAYER.toast"
    >
      <TransitionGroup name="fade">
        <div
          v-for="item in toasts"
          :key="item.id"
          class="bg-slate-800 dark:bg-slate-200 text-white dark:text-slate-800 text-sm px-4 py-2 rounded-full shadow-lg max-w-[calc(100vw-2rem)] break-words"
        >
          {{ item.message }}
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>
