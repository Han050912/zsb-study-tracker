<script setup lang="ts">
defineProps<{ loading?: boolean; error?: string; empty?: boolean; message?: string }>()
defineEmits<{ retry: [] }>()
</script>
<template>
  <div v-if="loading" role="status" aria-label="正在加载" class="space-y-3">
    <div v-for="i in 3" :key="i" class="card space-y-4 animate-pulse" aria-hidden="true">
      <div class="flex gap-3 items-center">
        <div class="h-10 w-10 rounded-full bg-slate-200 dark:bg-slate-700"></div>
        <div class="h-3 w-28 rounded bg-slate-200 dark:bg-slate-700"></div>
      </div>
      <div class="h-3 w-4/5 rounded bg-slate-200 dark:bg-slate-700"></div>
      <div class="h-3 w-3/5 rounded bg-slate-200 dark:bg-slate-700"></div>
      <div class="h-8"></div>
    </div>
  </div>
  <div v-else-if="error" class="card flex flex-wrap items-center gap-3" role="status">
    <p class="flex-1 text-sm">{{ error }}</p>
    <button class="btn-ghost" @click="$emit('retry')">重试</button>
  </div>
  <div v-else-if="empty" class="card py-10 text-center">
    <p class="text-sm text-slate-500 dark:text-slate-400">{{ message }}</p>
    <div class="mt-4"><slot name="action" /></div>
  </div>
  <slot v-else />
</template>
