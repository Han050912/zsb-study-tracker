<script lang="ts">
/**
 * 科目图标渲染收敛点（P6-02）：subject.icon 命中预置 lucide 图标名时渲染 SVG，
 * 否则按原文渲染（兼容内置科目/旧数据的 emoji 与空值），映射与渲染只此一份。
 */
import type { Component } from 'vue'
import {
  Atom,
  Beaker,
  BookOpen,
  Calculator,
  Compass,
  FlaskConical,
  Globe,
  GraduationCap,
  Guitar,
  HeartPulse,
  Languages,
  Laptop,
  Lightbulb,
  Map,
  Music2,
  Palette
} from '@lucide/vue'

/** 预置科目图标库：key 即存入 subject.icon 的 lucide 图标名（设置页选择器与各渲染处共用同一份映射） */
export const SUBJECT_ICONS: Record<string, Component> = {
  Atom,
  Beaker,
  BookOpen,
  Calculator,
  Compass,
  FlaskConical,
  Globe,
  GraduationCap,
  Guitar,
  HeartPulse,
  Languages,
  Laptop,
  Lightbulb,
  Map,
  Music2,
  Palette
}
</script>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{ icon?: string | null }>()
const preset = computed(() => (props.icon ? (SUBJECT_ICONS[props.icon] ?? null) : null))
</script>

<template>
  <!-- 命中预置图标名：渲染 SVG，尺寸跟随父级 font-size（1em） -->
  <component :is="preset" v-if="preset" class="inline-block w-[1em] h-[1em] align-[-0.15em]" />
  <!-- 未命中：按原文渲染（emoji / 旧数据），空值不渲染 -->
  <span v-else-if="icon">{{ icon }}</span>
</template>
