<script setup lang="ts">
import { computed } from 'vue'
import Heatmap from '../Heatmap.vue'
import { useAppStore } from '../../stores/app'
const props = defineProps<{ data: { date: string; minutes: number }[] }>()
const emit = defineEmits<{ select: [date: string] }>()
const store = useAppStore()
const minutes = computed(() => Object.fromEntries(props.data.map((d) => [d.date, d.minutes])))
</script>
<template>
  <Heatmap :data="minutes" :weeks="30" :end-date="store.todayKey" @select="emit('select', $event)" />
</template>
