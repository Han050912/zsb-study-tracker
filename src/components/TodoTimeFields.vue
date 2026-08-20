<script setup lang="ts">
import { computed } from 'vue'
import TimeFieldCard, { type TimePreset } from './TimeFieldCard.vue'

const props = withDefaults(defineProps<{
  start: string
  due: string
  hint?: string
}>(), {
  hint: '时间均为「当日」的时刻，待办须在今日完成。'
})
const emit = defineEmits<{ 'update:start': [string]; 'update:due': [string] }>()

const startPresets: TimePreset[] = [
  { label: '现在', value: 'now' },
  { label: '08:00', value: '08:00' },
  { label: '10:00', value: '10:00' },
  { label: '14:00', value: '14:00' },
  { label: '19:00', value: '19:00' }
]
const duePresets: TimePreset[] = [
  { label: '12:00', value: '12:00' },
  { label: '18:00', value: '18:00' },
  { label: '20:00', value: '20:00' },
  { label: '22:00', value: '22:00' },
  { label: '23:59', value: '23:59' }
]

const invalid = computed(() => !!props.start && !!props.due && props.due < props.start)

const summary = computed(() => {
  const parts: string[] = []
  if (props.start) parts.push(`${props.start} 开始`)
  if (props.due) parts.push(`${props.due} 前完成`)
  return parts.length ? `今日 ${parts.join(' · ')}` : ''
})
</script>

<template>
  <div class="space-y-3.5">
    <div class="flex items-center gap-2 rounded-xl border border-primary-100 dark:border-primary-800/40 bg-gradient-to-r from-primary-50 to-sky-50 dark:from-primary-900/20 dark:to-sky-900/20 px-3 py-2.5">
      <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
        class="text-primary-500 shrink-0">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 16v-4" />
        <path d="M12 8h.01" />
      </svg>
      <p class="text-[11px] leading-relaxed text-primary-600/90 dark:text-primary-300/80">{{ hint }}</p>
    </div>

    <TimeFieldCard
      :model-value="start"
      title="开始时间"
      desc="到点提醒你「任务已开始」，留空则不提醒"
      accent="sky"
      :presets="startPresets"
      @update:model-value="emit('update:start', $event)"
    >
      <template #icon>
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polygon points="6 3 20 12 6 21 6 3" />
        </svg>
      </template>
    </TimeFieldCard>

    <TimeFieldCard
      :model-value="due"
      title="最晚截止时间"
      desc="到点若仍未勾选完成，会提醒你该待办未完成；已完成则不提醒"
      accent="amber"
      :presets="duePresets"
      @update:model-value="emit('update:due', $event)"
    >
      <template #icon>
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M5 22h14" />
          <path d="M5 2h14" />
          <path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22" />
          <path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2" />
        </svg>
      </template>
    </TimeFieldCard>

    <Transition name="fade">
      <div
        v-if="invalid"
        class="flex items-center justify-center gap-1.5 rounded-xl border border-rose-200 dark:border-rose-800/50 bg-rose-50 dark:bg-rose-900/20 px-3 py-2"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
          class="text-rose-500 shrink-0">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" x2="12" y1="8" y2="12" />
          <line x1="12" x2="12.01" y1="16" y2="16" />
        </svg>
        <span class="text-xs font-medium text-rose-500 dark:text-rose-300">最晚截止时间早于开始时间，请调整</span>
      </div>
      <div
        v-else-if="summary"
        class="flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700/40 px-3 py-2"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
          class="text-slate-400 shrink-0">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
        <span class="text-xs font-medium text-slate-600 dark:text-slate-300 tabular-nums">{{ summary }}</span>
      </div>
    </Transition>
  </div>
</template>
