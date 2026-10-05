<script setup lang="ts">
import { ArrowRight } from '@lucide/vue'
import { computed } from 'vue'
import { useAppStore } from '../stores/app'
import SubjectPanel from '../components/SubjectPanel.vue'

const store = useAppStore()
// 「高等数学」科目可能被用户在设置页删除，此时页面整体隐藏
const subjectExists = computed(() => !!store.subjectMap.math)
</script>

<template>
  <div class="study-page">
    <template v-if="subjectExists">
      <header class="study-page-heading mb-6">
        <div>
          <h1 class="page-title">高等数学</h1>
          <p class="mt-1 text-sm text-muted">梳理章节知识点，记录刷题与真题练习。</p>
        </div>
        <RouterLink to="/error-book" class="btn-ghost shrink-0"
          >我的错题 <ArrowRight class="arrow-inline" :size="16" aria-hidden="true"
        /></RouterLink>
      </header>
      <SubjectPanel subject-id="math" />
    </template>
    <div v-else class="card text-center py-16 text-slate-400">
      <p class="text-sm">「高等数学」科目已被删除，此页面已隐藏</p>
      <RouterLink to="/settings" class="text-action text-xs underline mt-2 inline-block arrow-link"
        >前往设置页管理科目 <ArrowRight class="arrow-inline" :size="16" aria-hidden="true"
      /></RouterLink>
    </div>
  </div>
</template>
