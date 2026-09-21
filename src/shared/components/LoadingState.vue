<script setup lang="ts">
import { LoaderCircle } from '@lucide/vue'
withDefaults(defineProps<{ message?: string }>(), { message: '正在加载，请稍候…' })
</script>

<template>
  <div
    class="flex flex-col items-center justify-center gap-4 py-10 px-4"
    role="status"
    aria-live="polite"
    aria-busy="true"
  >
    <div class="flex items-center gap-2 text-sm" style="color: var(--muted)">
      <LoaderCircle :size="18" class="loading-spinner shrink-0" aria-hidden="true" />
      <span>{{ message }}</span>
    </div>
    <div class="w-40 space-y-2" aria-hidden="true">
      <div class="skeleton-line w-full"></div>
      <div class="skeleton-line w-3/4 mx-auto"></div>
    </div>
  </div>
</template>
