<script setup lang="ts">
/** 搭子通知 Item：按 targetType 精准路由（分享/批注→预览页，番茄/计划/复盘→对应列表页，提醒→首页，解除→不跳转，其余→搭子列表）；点头像跳对方主页 */
import { useRouter } from 'vue-router'
import UserAvatar from './UserAvatar.vue'
import { fromNow } from '../../utils/date'
import type { CommunityNotification } from '../../types'

const props = defineProps<{ n: CommunityNotification }>()
const emit = defineEmits<{ read: [] }>()
const router = useRouter()

function openProfile() {
  emit('read')
  if (props.n.actorId) router.push(`/profile/${props.n.actorId}`)
}

function openPartners() {
  emit('read')
  const tt = props.n.targetType
  // 解除搭子：不跳转，仅展示文案
  if (tt === 'partner_unbind') return
  // 周报通知：跳搭子页并自动打开该搭子周报对比
  if (tt === 'partner_weekly') {
    if (props.n.targetId) router.push(`/community/partners?weekly=${props.n.targetId}`)
    else router.push('/community/partners')
    return
  }
  // 分享 / 批注：跳分享预览页
  if (tt === 'partner_share' || tt === 'partner_comment') {
    if (props.n.targetId) router.push(`/partners/shares/preview/${props.n.targetId}`)
    else router.push('/community/partners')
    return
  }
  // 番茄邀请 / 备考计划 / 复盘邀约：跳对应列表页
  if (tt === 'partner_study') { router.push('/partners/study'); return }
  if (tt === 'partner_plan') { router.push('/partners/plans'); return }
  if (tt === 'partner_review') { router.push('/partners/reviews'); return }
  // 监督提醒：跳首页打卡
  if (tt === 'partner_remind') { router.push('/'); return }
  // 搭子申请 / 达成等默认：跳搭子列表
  router.push('/community/partners')
}
</script>

<template>
  <div class="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-700/40 cursor-pointer" @click="openPartners">
    <button class="shrink-0 relative" @click.stop="openProfile">
      <UserAvatar :name="n.actorName || '搭'" :avatar="n.actorAvatar" />
      <span v-if="!n.isRead" class="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-rose-500 border-2 border-white dark:border-slate-800"></span>
    </button>
    <div class="flex-1 min-w-0">
      <p class="text-sm text-slate-700 dark:text-slate-200 leading-relaxed break-words">{{ n.content }}</p>
      <p class="text-[10px] text-slate-400 mt-1">{{ fromNow(n.createdAt) }}</p>
    </div>
  </div>
</template>
