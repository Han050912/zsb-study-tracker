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
        <button
          class="shrink-0 min-w-11"
          :aria-label="`查看${m.userName}的资料`"
          @click="emit('open-profile', m.userId)"
        >
          <UserAvatar :name="m.userName" :avatar="m.userAvatar" size="sm" />
        </button>
        <button
          class="text-sm flex-1 min-w-0 truncate text-left hover:text-action"
          @click="emit('open-profile', m.userId)"
        >
          {{ m.userName }}
        </button>
        <span
          class="text-xs px-1.5 py-0.5 rounded-full shrink-0"
          :class="
            m.role === 'leader'
              ? 'bg-action-soft dark:bg-action-soft text-action dark:text-action'
              : 'bg-action-soft dark:bg-action-soft text-action dark:text-action'
          "
        >
          {{ m.role === 'leader' ? '队长' : '成员' }}
        </span>
        <details
          v-if="myRole === 'leader' && m.role === 'member'"
          class="relative"
          @keydown.esc="($event.currentTarget as HTMLDetailsElement).open = false"
        >
          <summary class="btn-ghost !px-2 text-xs list-none cursor-pointer" :aria-label="`管理${m.userName}`">
            ···
          </summary>
          <div class="absolute z-20 right-0 card !p-2 min-w-36 space-y-1 shadow-lg">
            <button
              class="inline-flex items-center gap-1 rounded-full border border-slate-200 dark:border-slate-600 px-2.5 py-1 text-xs text-slate-500 dark:text-slate-400 transition-colors hover:text-action hover:border-primary-300"
              :disabled="transferSubmitting"
              @click="emit('transfer', m.userId, m.userName)"
            >
              <Crown class="w-3.5 h-3.5" />设为队长
            </button>
            <button
              class="inline-flex items-center gap-1 rounded-full border border-correction dark:border-correction px-2.5 py-1 text-xs text-correction dark:text-correction transition-colors hover:bg-correction-soft dark:hover:bg-correction"
              @click="emit('kick', m)"
            >
              <UserMinus class="w-3.5 h-3.5" />踢出
            </button>
          </div>
        </details>
      </div>
    </div>
  </div>
</template>
