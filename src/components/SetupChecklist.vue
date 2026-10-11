<script setup lang="ts">
import { computed, ref } from 'vue'
import { useAppStore } from '../stores/app'
import Onboarding from './Onboarding.vue'
const store = useAppStore()
const open = ref(false)
const missing = computed(() =>
  [
    !store.settings.examDate && '考试日期',
    !store.subjects.some((s) => s.weight > 0) && '考试科目',
    !(store.todos.length || store.records.length || store.pomodoro.records.length) && '第一项任务'
  ].filter(Boolean)
)
</script>
<template>
  <section
    v-if="store.settings.onboarded && missing.length"
    class="card flex flex-wrap items-center justify-between gap-3"
    aria-label="学习准备"
  >
    <p class="text-sm">继续完成学习准备：{{ missing.join('、') }}。</p>
    <button class="btn-ghost" @click="open = true">继续设置</button>
  </section>
  <Onboarding v-if="open" @complete="open = false" />
</template>
