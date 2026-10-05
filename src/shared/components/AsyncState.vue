<script setup lang="ts">
import { TriangleAlert } from '@lucide/vue'
import EmptyState from './EmptyState.vue'
defineProps<{ loading?: boolean; error?: string; empty?: boolean; message?: string }>()
defineEmits<{ retry: [] }>()
</script>
<template>
  <div v-if="loading" role="status" aria-label="正在加载" class="space-y-3">
    <p class="text-sm text-slate-500 flex items-center gap-2">正在加载…</p>
    <div v-for="i in 3" :key="i" class="card space-y-4" aria-hidden="true">
      <div class="flex gap-3 items-center">
        <div class="h-10 w-10 rounded-full bg-slate-200 dark:bg-slate-700"></div>
        <div class="h-3 w-28 rounded bg-slate-200 dark:bg-slate-700"></div>
      </div>
      <div class="h-3 w-4/5 rounded bg-slate-200 dark:bg-slate-700"></div>
      <div class="h-3 w-3/5 rounded bg-slate-200 dark:bg-slate-700"></div>
      <div class="h-8"></div>
    </div>
  </div>
  <div v-else-if="error" class="card flex flex-wrap items-center gap-3" role="alert">
    <TriangleAlert :size="20" class="text-correction shrink-0" aria-hidden="true" />
    <p class="flex-1 min-w-0 break-words text-sm">{{ error }}</p>
    <button class="btn-ghost" @click="$emit('retry')">重试</button>
  </div>
  <EmptyState v-else-if="empty" class="card" :title="message || '还没有内容'">
    <template v-if="$slots.action" #default><slot name="action" /></template>
  </EmptyState>
  <slot v-else />
</template>
