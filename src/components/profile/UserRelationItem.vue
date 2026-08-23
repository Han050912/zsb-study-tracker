<script setup lang="ts">
/** 粉丝/关注/互关列表项：头像 + 昵称/简介 + 关系徽章 + 关注按钮；点击跳转对方主页 */
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { UserCheck, UserPlus, Users } from '@lucide/vue'
import UserAvatar from '../community/UserAvatar.vue'
import FollowButton from './FollowButton.vue'
import { sessionUser } from '../../services/auth'
import type { FollowListItem, RelationStatus } from '../../types'

const props = defineProps<{ item: FollowListItem }>()
const emit = defineEmits<{ 'follow-change': [userId: string, following: boolean] }>()
const router = useRouter()

const isSelf = computed(() => props.item.userId === sessionUser.value?.id)

const BADGES: Record<RelationStatus, { label: string; cls: string; icon: any } | null> = {
  mutual: { label: '互关', cls: 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400', icon: Users },
  following: { label: '已关注', cls: 'bg-sky-50 dark:bg-sky-900/30 text-sky-600 dark:text-sky-400', icon: UserCheck },
  follower: { label: '粉丝', cls: 'bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400', icon: UserPlus },
  none: null // 陌生人/自己不显示徽章
}
const badge = computed(() => (isSelf.value ? null : BADGES[props.item.relation]))

function onFollowChange(following: boolean) {
  emit('follow-change', props.item.userId, following)
}
</script>

<template>
  <div class="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700/40 cursor-pointer transition-colors"
    @click="router.push(`/profile/${item.userId}`)">
    <UserAvatar :name="item.userName" :avatar="item.avatar" />
    <div class="flex-1 min-w-0">
      <div class="flex items-center gap-1.5">
        <span class="text-sm font-semibold truncate">{{ item.userName }}</span>
        <span v-if="item.verified" class="w-3.5 h-3.5 rounded-full bg-sky-500 text-white text-[9px] flex items-center justify-center shrink-0">✓</span>
        <span v-if="badge" class="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full shrink-0" :class="badge.cls">
          <component :is="badge.icon" :size="10" />{{ badge.label }}
        </span>
      </div>
      <div class="text-xs text-slate-400 truncate mt-0.5">{{ item.bio || '这个人很懒，什么都没写' }}</div>
    </div>
    <FollowButton v-if="!isSelf" :user-id="item.userId" :followed-by-me="item.followedByMe"
      :follows-me="item.followsMe" @change="onFollowChange" />
  </div>
</template>
