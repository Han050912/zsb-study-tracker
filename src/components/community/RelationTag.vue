<script setup lang="ts">
/** 关系标签：按用户关系渲染「互相关注 / 已关注 / 粉丝」，无特殊关系不渲染 */
import { computed } from 'vue'
import { BADGES } from '../../data/relationBadges'
import type { RelationStatus } from '../../types'

const props = defineProps<{ relation?: RelationStatus }>()

const badge = computed(() => (props.relation ? BADGES[props.relation] : null))
</script>

<template>
  <span
    v-if="badge"
    class="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full shrink-0"
    :class="badge.cls"
  >
    <component :is="badge.icon" :size="10" />{{ badge.label }}
  </span>
</template>
