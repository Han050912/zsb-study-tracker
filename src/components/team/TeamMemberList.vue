<script setup lang="ts">
import { Crown, UserMinus } from '@lucide/vue'
import UserAvatar from '../community/UserAvatar.vue'
import type { TeamMember } from '../../types'

/** 成员卡：纯展示 + 意图上抛（打开资料 / 转让队长 / 踢出） */
defineProps<{
  members: TeamMember[]
  myRole?: 'leader' | 'member'
  transferSubmitting: boolean
}>()

const emit = defineEmits<{
  'open-profile': [userId: string]
  transfer: [userId: string, name: string]
  kick: [member: TeamMember]
}>()
</script>

<template>
  <div v-if="members.length" class="card">
    <div class="label !mb-2">成员（{{ members.length }}）</div>
    <div class="divide-y divide-slate-100 dark:divide-slate-700">
      <div v-for="m in members" :key="m.userId" class="flex items-center gap-3 py-2">
        <button class="shrink-0" @click="emit('open-profile', m.userId)">
          <UserAvatar :name="m.userName" :avatar="m.userAvatar" size="sm" />
        </button>
        <button
          class="text-sm flex-1 min-w-0 truncate text-left hover:text-primary-500"
          @click="emit('open-profile', m.userId)"
        >
          {{ m.userName }}
        </button>
        <span
          class="text-[10px] px-1.5 py-0.5 rounded-full shrink-0"
          :class="
            m.role === 'leader'
              ? 'bg-yellow-50 dark:bg-yellow-900/30 text-yellow-600 dark:text-yellow-400'
              : 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
          "
        >
          {{ m.role === 'leader' ? '队长' : '成员' }}
        </span>
        <div v-if="myRole === 'leader' && m.role === 'member'" class="flex items-center gap-1.5 shrink-0">
          <button
            class="inline-flex items-center gap-1 rounded-full border border-slate-200 dark:border-slate-600 px-2.5 py-1 text-xs text-slate-500 dark:text-slate-400 transition-colors hover:text-primary-500 hover:border-primary-300"
            :disabled="transferSubmitting"
            @click="emit('transfer', m.userId, m.userName)"
          >
            <Crown class="w-3.5 h-3.5" />设为队长
          </button>
          <button
            class="inline-flex items-center gap-1 rounded-full border border-red-200 dark:border-red-900/50 px-2.5 py-1 text-xs text-red-500 dark:text-red-400 transition-colors hover:bg-red-50 dark:hover:bg-red-900/20"
            @click="emit('kick', m)"
          >
            <UserMinus class="w-3.5 h-3.5" />踢出
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
