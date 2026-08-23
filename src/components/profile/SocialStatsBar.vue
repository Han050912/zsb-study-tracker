<script setup lang="ts">
/** 社交数据卡：帖子 / 点赞(仅本人) / 粉丝 / 关注 / 互关。帖子/点赞切同页 Tab，关系格跳列表页 */
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import type { CommunityUserProfile } from '../../types'

const props = defineProps<{ profile: CommunityUserProfile; isSelf: boolean }>()
const emit = defineEmits<{ 'show-works': [tab: 'posts' | 'likes'] }>()
const router = useRouter()

const cells = computed(() => {
  const list: { label: string; value: number; action: () => void }[] = [
    { label: '帖子', value: props.profile.threadsCount, action: () => emit('show-works', 'posts') }
  ]
  if (props.isSelf) {
    list.push({ label: '点赞', value: props.profile.likedCount ?? 0, action: () => emit('show-works', 'likes') })
  }
  const p = props.profile
  list.push(
    { label: '粉丝', value: p.followers, action: () => router.push(`/follows/${p.userId}?tab=fans`) },
    { label: '关注', value: p.followingCount, action: () => router.push(`/follows/${p.userId}?tab=following`) },
    { label: '互关', value: p.mutualCount, action: () => router.push(`/follows/${p.userId}?tab=mutual`) }
  )
  return list
})
</script>

<template>
  <div class="card !p-2 grid gap-1" :class="isSelf ? 'grid-cols-5' : 'grid-cols-4'">
    <button v-for="c in cells" :key="c.label" class="py-2.5 rounded-xl text-center hover:bg-slate-50 dark:hover:bg-slate-700/40 transition-colors"
      @click="c.action">
      <div class="text-lg font-bold text-slate-700 dark:text-slate-200">{{ c.value }}</div>
      <div class="text-xs text-slate-400">{{ c.label }}</div>
    </button>
  </div>
</template>
