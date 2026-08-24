<script setup lang="ts">
/** 关注按钮：四态文案（+ 关注 / 回关 / 已关注 / 互相关注），乐观更新失败回滚。本人场景由父组件不渲染 */
import { computed, inject, ref } from 'vue'
import { useRouter } from 'vue-router'
import { communityApi } from '../../api/community'
import { requireLogin } from '../../services/auth'

const props = defineProps<{ userId: string; followedByMe: boolean; followsMe?: boolean }>()
const emit = defineEmits<{ change: [following: boolean] }>()
const toast = inject<(m: string) => void>('toast', () => {})
const router = useRouter()

const submitting = ref(false)
const label = computed(() =>
  props.followedByMe
    ? (props.followsMe ? '互相关注' : '已关注')
    : (props.followsMe ? '回关' : '+ 关注'))

async function toggle() {
  if (requireLogin(router)) return
  if (submitting.value) return
  submitting.value = true
  const next = !props.followedByMe
  emit('change', next) // 乐观更新
  try {
    const res = await communityApi.follow(props.userId)
    if (res.following !== next) emit('change', res.following) // 以服务端为准纠偏
  } catch (e: any) {
    emit('change', !next) // 回滚
    toast(e?.message || '操作失败')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <button class="text-xs px-3 py-1.5 rounded-full font-medium transition-colors shrink-0"
    :class="followedByMe
      ? 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 hover:text-red-500'
      : 'bg-primary-500 text-white hover:bg-primary-600'"
    :disabled="submitting" @click.stop="toggle">{{ label }}</button>
</template>
