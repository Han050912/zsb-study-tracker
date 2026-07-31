<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  percent: number
  size?: number
  stroke?: number
  color?: string
  label?: string
}>(), { size: 72, stroke: 7, color: '#3b82f6', label: '' })

const r = computed(() => (props.size - props.stroke) / 2)
const c = computed(() => 2 * Math.PI * r.value)
const offset = computed(() => c.value * (1 - Math.min(100, Math.max(0, props.percent)) / 100))
</script>

<template>
  <div class="relative inline-flex items-center justify-center" :style="{ width: size + 'px', height: size + 'px' }">
    <svg :width="size" :height="size" class="-rotate-90">
      <circle :cx="size / 2" :cy="size / 2" :r="r" fill="none" :stroke-width="stroke" class="stroke-slate-100 dark:stroke-slate-700" />
      <circle :cx="size / 2" :cy="size / 2" :r="r" fill="none" :stroke="color" :stroke-width="stroke"
        stroke-linecap="round" :stroke-dasharray="c" :stroke-dashoffset="offset" class="transition-all duration-700" />
    </svg>
    <div class="absolute inset-0 flex flex-col items-center justify-center">
      <span class="text-sm font-bold" :style="{ color }">{{ Math.round(percent) }}%</span>
      <span v-if="label" class="text-[9px] text-slate-400 max-w-[56px] truncate">{{ label }}</span>
    </div>
  </div>
</template>
