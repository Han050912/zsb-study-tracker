<script setup lang="ts">
import { ref } from 'vue'

const visible = ref(false)
const message = ref('')
let timer: ReturnType<typeof setTimeout> | null = null

function show(msg: string) {
  message.value = msg
  visible.value = true
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => (visible.value = false), 2000)
}
defineExpose({ show })
</script>

<template>
  <Transition name="fade">
    <div v-if="visible" class="fixed top-6 left-1/2 -translate-x-1/2 z-50 bg-slate-800 dark:bg-slate-200 text-white dark:text-slate-800 text-sm px-4 py-2 rounded-full shadow-lg">
      {{ message }}
    </div>
  </Transition>
</template>
