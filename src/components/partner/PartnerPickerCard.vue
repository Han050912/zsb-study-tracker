<script setup lang="ts">
/** 选搭子卡片：搭子单选列表 + 计时模式/专注时长设置 + 邀请开黑（创建会话的 API/入会话流程留页面层，此处仅上抛 invite） */
import UserAvatar from '../community/UserAvatar.vue'
import type { PartnerItem } from '../../types'

defineProps<{
  partners: PartnerItem[]
  creating: boolean
}>()

const selectedId = defineModel<string>('selectedId', { required: true })
const mode = defineModel<'countdown' | 'countup'>('mode', { required: true })
const focusMinutes = defineModel<number>('focusMinutes', { required: true })

const emit = defineEmits<{ invite: [] }>()
</script>

<template>
  <div class="card space-y-3">
    <div class="text-sm font-semibold text-slate-700 dark:text-slate-200">选择搭子，邀请一起开黑自习</div>
    <div v-if="!partners.length" class="text-xs text-slate-400 dark:text-slate-500 text-center py-4">
      还没有搭子，先去<router-link to="/community/partners" class="text-primary-500">搭子页</router-link>添加一位吧
    </div>
    <template v-else>
      <button
        v-for="p in partners"
        :key="p.userId"
        class="w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs transition-colors"
        :class="
          selectedId === p.userId
            ? 'bg-primary-50 dark:bg-primary-900/30 ring-1 ring-primary-200 dark:ring-primary-800'
            : 'hover:bg-slate-50 dark:hover:bg-slate-700'
        "
        @click="selectedId = p.userId"
      >
        <UserAvatar :name="p.userName" :avatar="p.userAvatar" size="sm" />
        <span class="font-medium">{{ p.userName }}</span>
        <span v-if="selectedId === p.userId" class="ml-auto text-primary-500">✓</span>
      </button>
      <div class="pt-1">
        <div class="flex gap-1 mb-2">
          <button
            class="flex-1 rounded-lg px-2 py-1.5 text-xs transition-colors"
            :class="mode === 'countdown' ? 'bg-primary-500 text-white' : 'bg-slate-100 dark:bg-slate-700'"
            @click="mode = 'countdown'"
          >
            倒计时
          </button>
          <button
            class="flex-1 rounded-lg px-2 py-1.5 text-xs transition-colors"
            :class="mode === 'countup' ? 'bg-primary-500 text-white' : 'bg-slate-100 dark:bg-slate-700'"
            @click="mode = 'countup'"
          >
            正计时
          </button>
        </div>
        <div v-if="mode === 'countdown'">
          <label class="label" for="pp-focus-minutes">专注（分钟）</label
          ><input
            id="pp-focus-minutes"
            v-model.number="focusMinutes"
            type="number"
            min="1"
            max="120"
            class="input !text-xs"
          />
        </div>
      </div>
      <button class="btn-primary w-full !text-xs" :disabled="!selectedId || creating" @click="emit('invite')">
        {{ creating ? '创建中…' : '邀请开黑' }}
      </button>
    </template>
  </div>
</template>
