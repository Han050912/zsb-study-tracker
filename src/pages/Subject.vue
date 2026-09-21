<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useAppStore } from '../stores/app'
import SubjectPanel from '../components/SubjectPanel.vue'
import SubjectIcon from '../components/SubjectIcon.vue'

const route = useRoute()
const store = useAppStore()
const subject = computed(() => store.subjectMap[route.params.id as string])
</script>

<template>
  <div class="p-4 md:p-6 max-w-5xl mx-auto">
    <template v-if="subject">
      <h1 class="page-title mb-4">
        <SubjectIcon v-if="subject.icon" :icon="subject.icon" class="mr-2" />{{ subject.name }}
      </h1>
      <SubjectPanel :subject-id="subject.id" />
    </template>
    <div v-else class="text-center py-20 space-y-4">
      <h1 class="page-title">科目不存在或已删除</h1>
      <p class="text-sm text-slate-500">可在设置中查看和添加科目。</p>
      <RouterLink to="/settings" class="btn-primary">管理科目</RouterLink>
    </div>
  </div>
</template>
