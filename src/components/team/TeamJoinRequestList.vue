<script setup lang="ts">
import { ref } from 'vue'
import { getErrorMessage } from '../../utils/error'
import { useToast } from '../../composables/useToast'
import { approveRequest, rejectRequest } from '../../api/teams'
import Modal from '../Modal.vue'
import UserAvatar from '../community/UserAvatar.vue'
import type { TeamJoinRequest } from '../../types'

/** 待审核申请卡（仅队长可见）+ 拒绝原因弹窗；审核完成后 emit refresh 由页面重载 */
const props = defineProps<{
  teamId: string
  requests: TeamJoinRequest[]
  myRole?: 'leader' | 'member'
}>()

const emit = defineEmits<{
  reviewed: [userId: string, accepted: boolean]
  'open-profile': [userId: string]
}>()

const toast = useToast()

const reviewing = ref<Record<string, boolean>>({})
const rejectTarget = ref<TeamJoinRequest | null>(null)
const rejectReason = ref('')
const rejectSubmitting = ref(false)

async function handleApprove(r: TeamJoinRequest) {
  if (reviewing.value[r.userId]) return
  reviewing.value[r.userId] = true
  try {
    await approveRequest(props.teamId, r.userId)
    toast('已同意')
    emit('reviewed', r.userId, true)
  } catch (e) {
    toast(getErrorMessage(e, '操作失败'))
  } finally {
    reviewing.value[r.userId] = false
  }
}

function openReject(r: TeamJoinRequest) {
  rejectTarget.value = r
  rejectReason.value = ''
}

async function handleReject() {
  if (!rejectTarget.value || rejectSubmitting.value) return
  rejectSubmitting.value = true
  try {
    await rejectRequest(props.teamId, rejectTarget.value.userId, rejectReason.value.trim() || undefined)
    toast('已拒绝')
    emit('reviewed', rejectTarget.value.userId, false)
    rejectTarget.value = null
  } catch (e) {
    toast(getErrorMessage(e, '操作失败'))
  } finally {
    rejectSubmitting.value = false
  }
}
</script>

<template>
  <div v-if="myRole === 'leader' && requests.length" class="card">
    <div class="label !mb-2">待审核申请（{{ requests.length }}）</div>
    <div class="divide-y divide-slate-100 dark:divide-slate-700">
      <div v-for="r in requests" :key="r.userId" class="flex items-center gap-3 py-2">
        <UserAvatar :name="r.userName" :avatar="r.userAvatar" size="sm" />
        <button
          class="text-sm flex-1 min-w-0 truncate text-left hover:text-primary-500"
          @click="emit('open-profile', r.userId)"
        >
          {{ r.userName }}
        </button>
        <button class="btn-primary !text-xs" :disabled="reviewing[r.userId]" @click="handleApprove(r)">同意</button>
        <button class="btn-ghost !text-xs !text-red-500" :disabled="reviewing[r.userId]" @click="openReject(r)">
          拒绝
        </button>
      </div>
    </div>
  </div>

  <Modal :show="!!rejectTarget" title="拒绝申请" @close="rejectTarget = null">
    <div class="space-y-3">
      <p class="text-sm text-slate-500 dark:text-slate-400">拒绝「{{ rejectTarget?.userName }}」的加入申请？</p>
      <input v-model="rejectReason" type="text" maxlength="200" placeholder="拒绝原因（可选）" class="input" />
    </div>
    <template #footer>
      <button class="btn-ghost" @click="rejectTarget = null">取消</button>
      <button class="btn-danger" :disabled="rejectSubmitting" @click="handleReject">
        {{ rejectSubmitting ? '拒绝中…' : '拒绝' }}
      </button>
    </template>
  </Modal>
</template>
