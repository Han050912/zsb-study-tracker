<script setup lang="ts">
import { RefreshCw } from '@lucide/vue'

/**
 * 图表 chunk 加载失败的统一占位：提示 + 重试入口。
 * 供 useChart 的调用方在 status === 'error' 时替换图表容器（尺寸类由调用方透传）。
 * 点击重试抛出事件，由调用方转交 useChart 暴露的 retry（重新发起 import）。
 */
const emit = defineEmits<{ retry: [] }>()
</script>

<template>
  <div
    class="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-200 dark:border-slate-700 text-slate-400"
  >
    <p class="text-xs">图表组件加载失败，请检查网络后重试</p>
    <button class="btn-ghost !py-1 !text-xs" @click="emit('retry')">
      <RefreshCw :size="14" aria-hidden="true" />
      重试
    </button>
  </div>
</template>
