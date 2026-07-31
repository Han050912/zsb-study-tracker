<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useAppStore } from '../stores/app'
import SubjectPanel from '../components/SubjectPanel.vue'

const route = useRoute()
const store = useAppStore()
const subject = computed(() => store.subjectMap[route.params.id as string])
</script>

<template>
  <div class="p-4 md:p-6 max-w-5xl mx-auto">
    <template v-if="subject">
      <h1 class="page-title mb-4">{{ subject.icon }} {{ subject.name }}</h1>
      <SubjectPanel :subject-id="subject.id" />
    </template>
    <div v-else class="text-center text-slate-400 py-20">科目不存在</div>
  </div>
</template>
