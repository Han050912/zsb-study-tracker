<script setup lang="ts">
import { computed } from 'vue'

export interface TimePreset {
  label: string
  /** HH:mm，或特殊值 'now' 表示当前时刻 */
  value: string
}

const props = defineProps<{
  modelValue: string
  title: string
  desc: string
  accent: 'sky' | 'amber'
  presets: TimePreset[]
}>()
const emit = defineEmits<{ 'update:modelValue': [string] }>()

// Tailwind 无法动态拼接类名，按 accent 预定义整套配色
const accentStyles = {
  sky: {
    iconBox: 'from-sky-400 to-blue-500 shadow-sky-200 dark:shadow-none',
    cardActive: 'border-sky-300 dark:border-sky-600 ring-2 ring-sky-100 dark:ring-sky-900/50 bg-sky-50/60 dark:bg-sky-900/10',
    chipActive: 'bg-sky-500 border-sky-500 text-white shadow-sm shadow-sky-200 dark:shadow-none',
    chipHover: 'hover:border-sky-300 hover:text-sky-600 dark:hover:border-sky-500 dark:hover:text-sky-300',
    inputFocus: 'hover:border-sky-300 dark:hover:border-sky-500 focus:border-sky-400 focus:ring-sky-200 dark:focus:ring-sky-800',
    clear: 'text-sky-500 hover:bg-sky-100/70 dark:hover:bg-sky-900/40'
  },
  amber: {
    iconBox: 'from-amber-400 to-orange-500 shadow-amber-200 dark:shadow-none',
    cardActive: 'border-amber-300 dark:border-amber-600 ring-2 ring-amber-100 dark:ring-amber-900/50 bg-amber-50/60 dark:bg-amber-900/10',
    chipActive: 'bg-amber-500 border-amber-500 text-white shadow-sm shadow-amber-200 dark:shadow-none',
    chipHover: 'hover:border-amber-300 hover:text-amber-600 dark:hover:border-amber-500 dark:hover:text-amber-300',
    inputFocus: 'hover:border-amber-300 dark:hover:border-amber-500 focus:border-amber-400 focus:ring-amber-200 dark:focus:ring-amber-800',
    clear: 'text-amber-600 hover:bg-amber-100/70 dark:hover:bg-amber-900/40'
  }
} as const

const ac = computed(() => accentStyles[props.accent])

function pick(value: string) {
  if (value === 'now') {
    const d = new Date()
    const hh = String(d.getHours()).padStart(2, '0')
    const mm = String(d.getMinutes()).padStart(2, '0')
    emit('update:modelValue', `${hh}:${mm}`)
    return
  }
  emit('update:modelValue', value)
}
</script>

<template>
  <div
    class="rounded-2xl border p-4 transition-all duration-200"
    :class="modelValue
      ? [ac.cardActive, 'shadow-md']
      : 'border-slate-100 dark:border-slate-700 bg-gradient-to-br from-slate-50/80 to-white dark:from-slate-700/30 dark:to-slate-800 hover:shadow-md hover:border-slate-200 dark:hover:border-slate-600'"
  >
    <div class="flex gap-3">
      <div
        class="w-10 h-10 rounded-xl bg-gradient-to-br text-white flex items-center justify-center shadow-md shrink-0 transition-transform duration-200"
        :class="[ac.iconBox, modelValue ? 'scale-105' : '']"
      >
        <slot name="icon" />
      </div>
      <div class="flex-1 min-w-0">
        <div class="flex items-center justify-between gap-2 h-6">
          <span class="text-sm font-semibold text-slate-700 dark:text-slate-200">{{ title }}</span>
          <button
            v-if="modelValue"
            type="button"
            class="text-[11px] px-2 py-0.5 rounded-full transition-colors"
            :class="ac.clear"
            @click="emit('update:modelValue', '')"
          >清除</button>
        </div>
        <p class="text-[11px] leading-relaxed text-slate-400 mt-0.5">{{ desc }}</p>
        <input
          :value="modelValue"
          type="time"
          class="mt-2.5 w-full rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700/60 px-3 py-2 text-base font-semibold tabular-nums text-slate-700 dark:text-slate-100 outline-none cursor-pointer transition-all duration-150 focus:ring-2 [color-scheme:light] dark:[color-scheme:dark]"
          :class="ac.inputFocus"
          @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
        />
        <div class="flex flex-wrap gap-1.5 mt-2.5">
          <button
            v-for="p in presets"
            :key="p.label"
            type="button"
            class="px-2.5 py-1 rounded-full border text-[11px] font-medium transition-all duration-150 active:scale-95"
            :class="modelValue === p.value
              ? ac.chipActive
              : ['border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-700/60', ac.chipHover]"
            @click="pick(p.value)"
          >{{ p.label }}</button>
        </div>
      </div>
    </div>
  </div>
</template>
