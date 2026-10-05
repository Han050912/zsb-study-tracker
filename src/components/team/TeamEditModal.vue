<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { getErrorMessage } from '../../utils/error'
import { useToast } from '../../composables/useToast'
import { updateTeam } from '../../api/teams'
import Modal from '../Modal.vue'
import type { StudyTeam } from '../../types'

/** 编辑小队信息弹窗（仅队长）；保存成功后 emit refresh 由页面重载 */
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

const teamEditForm = ref({ name: '', description: '', maxMembers: 10, isPublic: true })
const teamEditSubmitting = ref(false)

const editMinMembers = computed(() => Math.max(2, props.memberCount))
const editInvalid = computed(() => teamEditForm.value.maxMembers < props.memberCount)

/** 打开时用当前小队信息回填表单（对应原 openTeamEdit） */
watch(
  () => props.show,
  (v) => {
    if (v && props.team) {
      teamEditForm.value = {
        name: props.team.name,
        description: props.team.description,
        maxMembers: props.team.maxMembers,
        isPublic: props.team.isPublic
      }
    }
  }
)

async function handleTeamEdit() {
  if (teamEditSubmitting.value || editInvalid.value) return
  if (!teamEditForm.value.name.trim()) {
    toast('请输入小队名称')
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
  <Modal :show="show" title="编辑小队信息" @close="emit('update:show', false)">
    <div class="space-y-3">
      <div>
        <label for="team-edit-name" class="label">小队名称（1-30 字）</label>
        <input id="team-edit-name" v-model="teamEditForm.name" type="text" maxlength="30" class="input" />
      </div>
      <div>
        <label for="team-edit-description" class="label">小队描述（0-200 字）</label>
        <textarea
          id="team-edit-description"
          v-model="teamEditForm.description"
          maxlength="200"
          rows="3"
          class="input"
        ></textarea>
      </div>
      <div>
        <label for="team-edit-limit" class="label">人数上限</label>
        <input
          id="team-edit-limit"
          v-model.number="teamEditForm.maxMembers"
          type="number"
          :min="editMinMembers"
          max="50"
          class="input"
        />
        <p v-if="editInvalid" class="text-xs text-correction mt-1">不能低于当前成员数（{{ memberCount }} 人）</p>
      </div>
      <div>
        <label class="inline-flex items-center gap-2 text-sm">
          <input v-model="teamEditForm.isPublic" type="checkbox" class="!min-h-0" />
          公开小队，允许同学直接加入
        </label>
        <p class="text-xs text-slate-500 dark:text-slate-400 mt-1">
          {{
            teamEditForm.isPublic
              ? '任何同学都可查看并加入；已有申请仍可审批。'
              : '通过邀请码申请，由队长审核；现有成员不受影响。'
          }}
        </p>
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
