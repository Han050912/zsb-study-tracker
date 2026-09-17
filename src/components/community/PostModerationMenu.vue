<script setup lang="ts">
import type { CommunityPost } from '../../types'
defineProps<{ post: CommunityPost }>()
defineEmits<{ pin: []; feature: []; daily: []; hide: [] }>()
</script>
<template>
  <details class="relative">
    <summary class="cursor-pointer px-2 text-sm flex items-center min-h-11">管理 ···</summary>
    <div class="absolute right-0 top-full z-20 card !p-2 w-36 flex flex-col text-sm">
      <button class="text-left px-2 min-h-11" @click="$emit('pin')">{{ post.isPinned ? '取消置顶' : '置顶' }}</button
      ><button class="text-left px-2 min-h-11" @click="$emit('feature')">
        {{ post.isFeatured ? '取消加精' : '加精' }}</button
      ><button class="text-left px-2 min-h-11" @click="$emit('daily')">
        {{ post.isDaily ? '取消一题' : '每日一题' }}</button
      ><button class="text-left px-2 min-h-11 text-red-500" @click="$emit('hide')">
        {{ post.isHidden ? '取消隐藏' : '隐藏' }}
      </button>
    </div>
  </details>
</template>
