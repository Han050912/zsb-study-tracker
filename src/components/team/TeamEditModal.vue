<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { getErrorMessage } from '../../utils/error'
import { useToast } from '../../composables/useToast'
import { updateTeam } from '../../api/teams'
import Modal from '../Modal.vue'
import type { StudyTeam } from '../../types'

/** 编辑小组信息弹窗（仅队长）；保存成功后 emit refresh 由页面重载 */
const props = defineProps<{
  show: boolean
  teamId: string
  team: StudyTeam | null
  memberCount: number
}>()

const emit = defineEmits<{
  'update:show': [boolean]
  refresh: []
}>()

const toast = useToast()

const teamEditForm = ref({ name: '', description: '', maxMembers: 10 })
const teamEditSubmitting = ref(false)

const editMinMembers = computed(() => Math.max(2, props.memberCount))
const editInvalid = computed(() => teamEditForm.value.maxMembers < props.memberCount)

/** 打开时用当前小组信息回填表单（对应原 openTeamEdit） */
watch(
  () => props.show,
  (v) => {
    if (v && props.team) {
      teamEditForm.value = {
        name: props.team.name,
        description: props.team.description,
        maxMembers: props.team.maxMembers
      }
    }
  }
)

async function handleTeamEdit() {
  if (teamEditSubmitting.value || editInvalid.value) return
  if (!teamEditForm.value.name.trim()) {
    toast('请输入小组名称')
    return
  }
  teamEditSubmitting.value = true
  try {
    await updateTeam(props.teamId, teamEditForm.value)
    toast('已保存')
    emit('update:show', false)
    emit('refresh')
  } catch (e) {
    toast(getErrorMessage(e, '保存失败'))
  } finally {
    teamEditSubmitting.value = false
  }
}
</script>

<template>
  <Modal :show="show" title="编辑小组信息" @close="emit('update:show', false)">
    <div class="space-y-3">
      <div>
        <div class="label">小组名称（1-30 字）</div>
        <input v-model="teamEditForm.name" type="text" maxlength="30" class="input" />
      </div>
      <div>
        <div class="label">小组描述（0-200 字）</div>
        <textarea v-model="teamEditForm.description" maxlength="200" rows="3" class="input"></textarea>
      </div>
      <div>
        <div class="label">人数上限</div>
        <input v-model.number="teamEditForm.maxMembers" type="number" :min="editMinMembers" max="50" class="input" />
        <p v-if="editInvalid" class="text-xs text-red-500 mt-1">不能低于当前成员数（{{ memberCount }} 人）</p>
      </div>
    </div>
    <template #footer>
      <button class="btn-ghost" @click="emit('update:show', false)">取消</button>
      <button class="btn-primary" :disabled="teamEditSubmitting || editInvalid" @click="handleTeamEdit">
        {{ teamEditSubmitting ? '保存中…' : '保存' }}
      </button>
    </template>
  </Modal>
</template>
