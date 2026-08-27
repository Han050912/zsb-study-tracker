<script setup lang="ts">
/** 关系标签：按用户关系渲染「互相关注 / 粉丝 / 你的关注」，无特殊关系不渲染 */
import { computed } from 'vue'
import { Users, UserPlus, UserCheck } from '@lucide/vue'
import type { RelationStatus } from '../../types'

const props = defineProps<{ relation?: RelationStatus }>()

const BADGES: Record<RelationStatus, { label: string; cls: string; icon: any } | null> = {
  mutual: { label: '互相关注', cls: 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400', icon: Users },
  follower: { label: '粉丝', cls: 'bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400', icon: UserPlus },
  following: { label: '你的关注', cls: 'bg-sky-50 dark:bg-sky-900/30 text-sky-600 dark:text-sky-400', icon: UserCheck },
  none: null
}
const badge = computed(() => (props.relation ? BADGES[props.relation] : null))
</script>

<template>
  <span v-if="badge" class="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full shrink-0" :class="badge.cls">
    <component :is="badge.icon" :size="10" />{{ badge.label }}
  </span>
</template>
