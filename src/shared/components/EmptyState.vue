<script setup lang="ts">
import { Inbox } from '@lucide/vue'

withDefaults(defineProps<{ title?: string; description?: string }>(), { title: '还没有内容', description: '' })
</script>

<template>
  <div class="empty-state">
    <div class="state-icon" aria-hidden="true">
      <slot name="icon"><Inbox :size="24" :stroke-width="1.6" /></slot>
    </div>
    <p class="state-title">{{ title }}</p>
    <p v-if="description" class="state-description">{{ description }}</p>
    <div v-if="$slots.default" class="flex flex-wrap justify-center gap-2"><slot /></div>
  </div>
</template>
