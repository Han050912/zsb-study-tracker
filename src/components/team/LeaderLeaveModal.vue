<script setup lang="ts">
import { ref, watch } from 'vue'
import Modal from '../Modal.vue'
import UserAvatar from '../community/UserAvatar.vue'
import type { TeamMember } from '../../types'

/**
 * 队长退出弹窗：解散 / 转让并退出。
 * 只发 confirm 意图（携带模式与接任者），解散/转让/router 跳转等离开页面类动作留页面层执行
 */
const props = defineProps<{
  show: boolean
  teamName: string
  members: TeamMember[]
  submitting: boolean
}>()

const emit = defineEmits<{
  'update:show': [boolean]
  confirm: [payload: { mode: 'disband' | 'transfer'; targetId: string }]
}>()

const leaveMode = ref<'disband' | 'transfer'>('disband')
const transferTargetId = ref('')
const confirmName = ref('')
watch(
  () => props.show,
  () => {
    confirmName.value = ''
    transferTargetId.value = ''
  }
)
</script>

<template>
  <Modal :show="show" title="退出小组" @close="emit('update:show', false)">
    <div class="space-y-3">
      <button
        class="w-full text-left rounded-xl border border-slate-200 dark:border-slate-700 p-3 transition-colors"
        :class="
          leaveMode === 'disband'
            ? 'border-red-300 dark:border-red-800 bg-red-50/50 dark:bg-red-900/10'
            : 'hover:border-slate-300'
        "
        @click="leaveMode = 'disband'"
      >
        <div class="text-sm font-semibold text-red-500">解散小队</div>
        <div class="text-xs text-slate-400 mt-0.5">解散后小组与全部挑战将被删除，不可撤销</div>
      </button>

      <button
        class="w-full text-left rounded-xl border border-slate-200 dark:border-slate-700 p-3 transition-colors"
        :class="
          leaveMode === 'transfer'
            ? 'border-primary-300 dark:border-primary-700 bg-primary-50/50 dark:bg-primary-900/10'
            : 'hover:border-slate-300'
        "
        @click="leaveMode = 'transfer'"
      >
        <div class="text-sm font-semibold">转让队长并退出</div>
        <div class="text-xs text-slate-400 mt-0.5">选一名成员接任队长，你将退出小组</div>
      </button>

      <div v-if="leaveMode === 'transfer'" class="space-y-1 pt-1">
        <div class="label !mb-1">选择接任队长</div>
        <div
          v-for="m in members.filter((x) => x.role === 'member')"
          :key="m.userId"
          role="radio"
          :aria-checked="transferTargetId === m.userId"
          tabindex="0"
          @keydown.enter="transferTargetId = m.userId"
          @keydown.space.prevent="transferTargetId = m.userId"
          class="flex items-center gap-2 py-1.5 cursor-pointer"
          @click="transferTargetId = m.userId"
        >
          <span
            class="w-4 h-4 rounded-full border flex items-center justify-center shrink-0"
            :class="transferTargetId === m.userId ? 'border-primary-500' : 'border-slate-300 dark:border-slate-600'"
          >
            <span v-if="transferTargetId === m.userId" class="w-2 h-2 rounded-full bg-primary-500"></span>
          </span>
          <UserAvatar :name="m.userName" :avatar="m.userAvatar" size="sm" />
          <span class="text-sm truncate">{{ m.userName }}</span>
        </div>
      </div>
    </div>
    <div v-if="leaveMode === 'disband'" class="mt-4">
      <label for="disband-name" class="label">输入「{{ teamName }}」确认解散</label
      ><input id="disband-name" v-model="confirmName" class="input" autocomplete="off" />
    </div>
    <template #footer>
      <button class="btn-ghost" @click="emit('update:show', false)">取消</button>
      <button
        class="btn-primary"
        :disabled="
          submitting ||
          (leaveMode === 'disband' && confirmName !== teamName) ||
          (leaveMode === 'transfer' && !transferTargetId)
        "
        @click="emit('confirm', { mode: leaveMode, targetId: transferTargetId })"
      >
        {{ submitting ? '处理中…' : '确认' }}
      </button>
    </template>
  </Modal>
</template>
