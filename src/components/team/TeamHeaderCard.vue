<script setup lang="ts">
import { ref } from 'vue'
import { useAsyncCommand } from '../../shared/composables/useAsyncCommand'
import { useRoute } from 'vue-router'
import { getErrorMessage } from '../../utils/error'
import { useToast } from '../../composables/useToast'
import { useConfirm } from '../../composables/useConfirm'
import { applyTeam, withdrawRequest, resetInviteCode, joinTeam } from '../../api/teams'
import type { StudyTeam } from '../../types'

/** 小组信息卡：基本信息 + 加入/申请/邀请码区；写操作成功后 emit refresh 由页面重载。
 *  仅撤回申请例外（emit withdrawn）：撤回后失去详情读取权限，由页面转列表而非重载 */
const props = defineProps<{
  teamId: string
  team: StudyTeam
  inviteCode?: string | null
  inviteCodeExpiresAt?: number | null
  myJoinRequest?: boolean
  leaveSubmitting: boolean
}>()

const emit = defineEmits<{
  refresh: []
  edit: []
  leave: []
  'leader-leave': []
  /** 撤回申请成功后申请人已无该小组详情读取权限，不能再走 refresh 重载，交由页面跳转 */
  withdrawn: []
}>()

const route = useRoute()
const toast = useToast()
const confirm = useConfirm()

const inviteInput = ref(typeof route.query.invite === 'string' ? route.query.invite : '')
const command = useAsyncCommand('team-membership')
const {
  pending: applySubmitting,
  pending: withdrawing,
  pending: resettingCode,
  pending: joinSubmitting,
  error: commandError
} = command

async function handleApply() {
  if (!inviteInput.value.trim() || applySubmitting.value) return
  try {
    await command.run(() => applyTeam(props.teamId, inviteInput.value.trim()))
    toast('申请已提交，等待队长审核')
    inviteInput.value = ''
    emit('refresh')
  } catch (e) {
    toast(getErrorMessage(e, '申请失败'))
  }
}

async function handleWithdraw() {
  if (withdrawing.value) return
  try {
    await command.run(() => withdrawRequest(props.teamId))
    toast('已撤回申请')
    // 撤回后 URL 无邀请码时详情接口必然 403，改为交由页面回列表，避免错误提示
    emit('withdrawn')
  } catch (e) {
    toast(getErrorMessage(e, '撤回失败'))
  }
}

async function handleResetCode() {
  if (resettingCode.value) return
  if (!(await confirm('确认重新生成邀请码？旧邀请码将立即失效。'))) return
  try {
    await command.run(async () => {
      await resetInviteCode(props.teamId)
    })
    toast('邀请码已重置')
    emit('refresh')
  } catch (e) {
    toast(getErrorMessage(e, '重置失败'))
  }
}

async function copyInvite() {
  if (!props.inviteCode) return
  try {
    await navigator.clipboard.writeText(props.inviteCode)
    toast('邀请码已复制')
  } catch {
    toast('复制失败，请手动复制')
  }
}

async function handleJoin() {
  if (joinSubmitting.value) return
  try {
    await command.run(() => joinTeam(props.teamId))
    toast('已加入小组')
    emit('refresh')
  } catch (e) {
    toast(getErrorMessage(e, '加入失败'))
  }
}

function formatDate(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' })
}
function menuAction(action: 'edit' | 'leave' | 'leader-leave', event: Event) {
  ;(event.currentTarget as HTMLElement).closest('details')?.removeAttribute('open')
  if (action === 'edit') emit('edit')
  else if (action === 'leave') emit('leave')
  else emit('leader-leave')
}
</script>

<template>
  <div class="card space-y-3">
    <div class="flex items-center gap-2 flex-wrap">
      <h2 class="text-lg font-bold flex-1 min-w-0 truncate">{{ team.name }}</h2>
      <span
        class="text-[10px] px-1.5 py-0.5 rounded-full shrink-0"
        :class="
          team.isPublic
            ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400'
            : 'bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400'
        "
      >
        {{ team.isPublic ? '公开' : '私密' }}
      </span>
      <span
        v-if="team.myRole === 'leader'"
        class="text-[10px] px-1.5 py-0.5 rounded-full shrink-0 bg-yellow-50 dark:bg-yellow-900/30 text-yellow-600 dark:text-yellow-400"
        >队长</span
      >
      <span
        v-else-if="team.myRole === 'member'"
        class="text-[10px] px-1.5 py-0.5 rounded-full shrink-0 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
        >成员</span
      >
    </div>
    <p v-if="team.description" class="text-sm text-slate-500 dark:text-slate-400 whitespace-pre-wrap">
      {{ team.description }}
    </p>
    <div class="flex flex-wrap items-center gap-3 text-xs text-slate-400">
      <span>{{ team.memberCount }} / {{ team.maxMembers }} 人</span>
      <span>创建于 {{ formatDate(team.createdAt) }}</span>
      <div class="flex-1"></div>
      <template v-if="!team.myRole">
        <template v-if="!team.isPublic">
          <template v-if="myJoinRequest">
            <span class="text-xs text-amber-500">申请待审核</span>
            <button class="btn-ghost !text-xs" :disabled="withdrawing" @click="handleWithdraw">
              {{ withdrawing ? '撤回中…' : '撤回申请' }}
            </button>
          </template>
          <template v-else>
            <input
              v-model="inviteInput"
              type="text"
              placeholder="邀请码"
              maxlength="8"
              class="input !w-28 !text-xs !py-1"
            />
            <button class="btn-primary !text-xs" :disabled="applySubmitting" @click="handleApply">
              {{ applySubmitting ? '申请中…' : '申请加入' }}
            </button>
          </template>
        </template>
        <button v-else class="btn-primary !text-xs" :disabled="joinSubmitting" @click="handleJoin">
          {{ joinSubmitting ? '加入中…' : '加入小组' }}
        </button>
      </template>
      <details v-else class="relative ml-auto" @keydown.esc="($event.currentTarget as HTMLDetailsElement).open = false">
        <summary class="btn-ghost !text-xs cursor-pointer list-none" aria-label="小队设置">设置 ···</summary>
        <div class="absolute right-0 z-20 card !p-2 min-w-36 shadow-lg">
          <button
            v-if="team.myRole === 'member'"
            class="btn-ghost !text-xs !text-red-500"
            :disabled="leaveSubmitting"
            @click="menuAction('leave', $event)"
          >
            {{ leaveSubmitting ? '退出中…' : '退出小组' }}
          </button>
          <template v-else-if="team.myRole === 'leader'">
            <button class="btn-ghost !text-xs w-full" @click="menuAction('edit', $event)">编辑小队</button>
            <button class="btn-ghost !text-xs !text-red-500" @click="menuAction('leader-leave', $event)">
              退出小组
            </button>
          </template>
        </div>
      </details>
    </div>
    <p v-if="commandError" role="status" class="text-sm text-red-500">{{ commandError }}</p>
    <div
      v-if="team.myRole === 'leader' && !team.isPublic && inviteCode"
      class="mt-3 pt-3 border-t border-slate-100 dark:border-slate-700"
    >
      <div class="label !mb-1">邀请码</div>
      <div class="flex items-center gap-2 flex-wrap">
        <code class="text-sm font-mono tracking-widest">{{ inviteCode }}</code>
        <button class="btn-ghost !text-xs" @click="copyInvite">复制</button>
        <button class="btn-ghost !text-xs" :disabled="resettingCode" @click="handleResetCode">
          {{ resettingCode ? '重置中…' : '重置' }}
        </button>
        <span v-if="inviteCodeExpiresAt" class="text-[10px] text-slate-400"
          >有效期至 {{ formatDate(inviteCodeExpiresAt) }}</span
        >
      </div>
    </div>
  </div>
</template>
