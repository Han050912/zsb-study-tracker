<script setup lang="ts">
import { useOverlayDismiss } from '../composables/useOverlayDismiss'

defineProps<{ title: string; show: boolean }>()
const emit = defineEmits<{ close: [] }>()

const { onOverlayMousedown, onOverlayClick } = useOverlayDismiss(() => emit('close'))
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="show" class="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-6" @mousedown="onOverlayMousedown" @click="onOverlayClick">
        <div class="bg-white dark:bg-slate-800 w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl max-h-[88vh] flex flex-col animate-pop">
          <div class="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-700">
            <h3 class="font-bold">{{ title }}</h3>
            <button class="text-slate-400 hover:text-slate-600 text-xl leading-none" @click="emit('close')" aria-label="关闭">×</button>
          </div>
          <div class="overflow-y-auto px-5 py-4 flex-1">
            <slot />
          </div>
          <div v-if="$slots.footer" class="px-5 py-3 border-t border-slate-100 dark:border-slate-700 flex justify-end gap-2">
            <slot name="footer" />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
