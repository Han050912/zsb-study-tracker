<script setup lang="ts">
import SubjectPanel from '../components/SubjectPanel.vue'
</script>

<template>
  <div class="p-4 md:p-6 max-w-5xl mx-auto">
    <div class="flex items-center justify-between mb-4">
      <h1 class="page-title">📐 高等数学</h1>
      <RouterLink to="/error-book" class="btn-ghost !py-1.5 text-xs">📕 错题本 →</RouterLink>
    </div>
    <SubjectPanel subject-id="math" />
  </div>
</template>
