<script setup lang="ts">
import { computed } from 'vue'
import { useAppStore } from '../stores/app'
import SubjectPanel from '../components/SubjectPanel.vue'

const store = useAppStore()
// 「高等数学」科目可能被用户在设置页删除，此时页面整体隐藏
const subjectExists = computed(() => !!store.subjectMap.math)
</script>

<template>
  <div class="p-4 md:p-6 max-w-5xl mx-auto">
    <template v-if="subjectExists">
      <div class="flex items-center justify-between mb-4">
        <h1 class="page-title">高等数学</h1>
        <RouterLink to="/error-book" class="btn-ghost !py-1.5 text-xs">错题本 →</RouterLink>
      </div>
      <SubjectPanel subject-id="math" />
    </template>
    <div v-else class="card text-center py-16 text-slate-400">
      <div class="text-4xl mb-2"></div>
      <p class="text-sm">「高等数学」科目已被删除，此页面已隐藏</p>
      <RouterLink to="/settings" class="text-primary-500 text-xs underline mt-2 inline-block">前往设置页管理科目 →</RouterLink>
    </div>
  </div>
</template>
