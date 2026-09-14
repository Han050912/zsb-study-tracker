<script setup lang="ts">
import { ref } from 'vue'
import { getErrorMessage } from '../../utils/error'
import { useToast } from '../../composables/useToast'
import { removeTeamMember } from '../../api/teams'
import Modal from '../Modal.vue'
import type { TeamMember } from '../../types'

/** 踢出成员确认弹窗（仅队长）；成功后 emit close + refresh */
const props = defineProps<{
  teamId: string
  member: TeamMember | null
}>()

const emit = defineEmits<{
  close: []
  refresh: []
}>()

const toast = useToast()

const kickSubmitting = ref(false)

async function handleKick() {
  if (!props.member || kickSubmitting.value) return
  kickSubmitting.value = true
  try {
    await removeTeamMember(props.teamId, props.member.userId)
    toast('已踢出')
    emit('close')
    emit('refresh')
  } catch (e) {
    toast(getErrorMessage(e, '踢出失败'))
  } finally {
    kickSubmitting.value = false
  }
}
</script>

<template>
  <Modal :show="!!member" title="踢出成员" @close="emit('close')">
    <p class="text-sm text-slate-500 dark:text-slate-400">
      确认将「{{ member?.userName }}」踢出小组？其将被移出并收到通知。
    </p>
    <template #footer>
      <button class="btn-ghost" @click="emit('close')">取消</button>
      <button class="btn-danger" :disabled="kickSubmitting" @click="handleKick">
        {{ kickSubmitting ? '踢出中…' : '踢出' }}
      </button>
    </template>
  </Modal>
</template>
