<script setup lang="ts">
/** 社区用户头像：首字母 + 渐变底（MVP 无头像上传，沿用右上角账号头像样式） */
withDefaults(defineProps<{ name: string; size?: 'sm' | 'md' }>(), { size: 'md' })
</script>

<template>
  <div class="rounded-full bg-gradient-to-br from-primary-500 to-indigo-600 text-white font-bold flex items-center justify-center shrink-0 select-none"
    :class="size === 'sm' ? 'w-5 h-5 text-[10px]' : 'w-9 h-9 text-sm'">
    {{ (name || '升').trim().slice(0, 1).toUpperCase() }}
  </div>
</template>
