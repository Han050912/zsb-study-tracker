<script setup lang="ts">
/** 社区用户头像：自定义头像（/api/avatar/ 路径）优先，加载失败或未设置时回退首字母渐变底 */
import { ref, watch } from 'vue'
import { imageUrl } from '../../api/community'

const props = withDefaults(defineProps<{ name: string; size?: 'sm' | 'md'; avatar?: string }>(), { size: 'md' })

const failed = ref(false)
// 换新头像后允许重新尝试加载
watch(() => props.avatar, () => { failed.value = false })
</script>

<template>
  <img v-if="avatar && !failed" :src="imageUrl(avatar)" alt="" loading="lazy"
    class="rounded-full object-cover shrink-0 bg-slate-200 dark:bg-slate-700"
    :class="size === 'sm' ? 'w-5 h-5' : 'w-9 h-9'" @error="failed = true">
  <div v-else class="rounded-full bg-gradient-to-br from-primary-500 to-indigo-600 text-white font-bold flex items-center justify-center shrink-0 select-none"
    :class="size === 'sm' ? 'w-5 h-5 text-[10px]' : 'w-9 h-9 text-sm'">
    {{ (name || '升').trim().slice(0, 1).toUpperCase() }}
  </div>
</template>
