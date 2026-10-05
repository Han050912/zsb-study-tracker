<script setup lang="ts">
import type { Component } from 'vue'
import {
  Award,
  BookMarked,
  BookOpen,
  CalendarCheck,
  ChartNoAxesColumn,
  CircleUserRound,
  Library,
  ListChecks,
  MessagesSquare,
  NotebookPen,
  Settings,
  ShieldCheck,
  SquarePen,
  Timer,
  Users
} from '@lucide/vue'
import SubjectIcon from './SubjectIcon.vue'

defineProps<{ icon: string; subject?: boolean }>()
const icons: Record<string, Component> = {
  Award,
  BookMarked,
  BookOpen,
  CalendarCheck,
  ChartNoAxesColumn,
  CircleUserRound,
  Library,
  ListChecks,
  MessagesSquare,
  NotebookPen,
  Settings,
  ShieldCheck,
  SquarePen,
  Timer,
  Users
}
</script>

<template>
  <SubjectIcon v-if="subject || !icons[icon]" :icon="icon" aria-hidden="true" />
  <component :is="icons[icon]" v-else :size="19" :stroke-width="1.7" aria-hidden="true" />
</template>
