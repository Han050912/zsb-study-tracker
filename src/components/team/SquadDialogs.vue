<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { createTeam, getTeamByInvite } from '../../api/teams'
import { getErrorMessage } from '../../utils/error'
import Modal from '../Modal.vue'
import AppButton from '../../shared/components/AppButton.vue'
const props = defineProps<{ mode: 'create' | 'invite' | null }>()
const emit = defineEmits<{ close: []; created: [] }>()
const router = useRouter(),
  step = ref(0),
  pending = ref(false),
  error = ref(''),
  invite = ref('')
const form = reactive({ name: '', description: '', maxMembers: 10, isPublic: true })
watch(
  () => props.mode,
  () => {
    step.value = 0
    error.value = ''
  }
)
function next() {
  error.value = ''
  if (step.value === 0 && !form.name.trim()) {
    error.value = '请填写小队名称'
    return
  }
  if (step.value === 1 && (!Number.isInteger(form.maxMembers) || form.maxMembers < 2 || form.maxMembers > 50)) {
    error.value = '人数需为 2–50 之间的整数'
    return
  }
  step.value++
}
async function submit() {
  if (pending.value) return
  error.value = ''
  if (props.mode === 'invite' && !/^[A-Z2-9]{8}$/i.test(invite.value.trim())) {
    error.value = '请输入 8 位邀请码'
    return
  }
  pending.value = true
  try {
    if (props.mode === 'invite') {
      const team = await getTeamByInvite(invite.value.trim())
      await router.push({ name: 'team-detail', params: { teamId: team.id }, query: { invite: invite.value.trim() } })
    } else {
      const team = await createTeam({ ...form, name: form.name.trim() })
      emit('created')
      await router.push({ name: 'team-detail', params: { teamId: team.id } })
    }
    emit('close')
  } catch (e) {
    error.value = getErrorMessage(e, '操作失败，请重试')
  } finally {
    pending.value = false
  }
}
</script>
<template>
  <Modal :show="!!mode" :title="mode === 'invite' ? '加入小队' : '创建小队'" @close="!pending && emit('close')"
    ><div class="collaboration-page space-y-4">
      <template v-if="mode === 'invite'"
        ><p class="text-sm text-slate-500">向队长获取邀请码，查看小队并申请加入。</p>
        <label for="squad-invite" class="label">邀请码</label
        ><input
          id="squad-invite"
          v-model="invite"
          class="input training-number uppercase"
          maxlength="8"
          autocomplete="off"
          aria-describedby="squad-form-error"
          @keydown.enter="submit" /></template
      ><template v-else
        ><p class="text-xs text-slate-500">{{ ['基本信息', '公开范围与人数', '确认创建'][step] }} · {{ step + 1 }}/3</p>
        <div v-if="step === 0" class="space-y-4">
          <div>
            <label for="squad-name" class="label">小队名称</label
            ><input
              id="squad-name"
              v-model="form.name"
              class="input"
              maxlength="30"
              placeholder="例如：高数 21 天冲刺"
              aria-describedby="squad-form-error"
            />
          </div>
          <div>
            <label for="squad-description" class="label">一起完成什么</label
            ><textarea
              id="squad-description"
              v-model="form.description"
              class="input"
              rows="3"
              maxlength="200"
              placeholder="写下你们的共同目标"
            ></textarea>
          </div>
        </div>
        <div v-else-if="step === 1" class="space-y-4">
          <div>
            <label for="squad-size" class="label">人数上限</label
            ><input
              id="squad-size"
              v-model.number="form.maxMembers"
              type="number"
              min="2"
              max="50"
              class="input"
              aria-describedby="squad-form-error"
            />
          </div>
          <label class="flex gap-3 items-center min-h-11"
            ><input v-model="form.isPublic" type="checkbox" class="!min-h-0" />公开小队，允许同学直接加入</label
          >
          <p v-if="!form.isPublic" class="text-xs text-slate-500">私密小队通过邀请码申请，由队长审核。</p>
        </div>
        <dl v-else class="space-y-3 text-sm">
          <dt class="font-semibold text-lg">{{ form.name }}</dt>
          <dd>{{ form.description || '创建后可以补充共同目标' }}</dd>
          <dd>{{ form.isPublic ? '公开' : '私密' }} · 最多 {{ form.maxMembers }} 人</dd>
        </dl></template
      >
      <p v-if="error" id="squad-form-error" class="text-sm text-red-500" role="alert">{{ error }}</p>
    </div>
    <template #footer
      ><button v-if="mode === 'create' && step > 0" class="btn-ghost" :disabled="pending" @click="step--">上一步</button
      ><AppButton v-if="mode === 'create' && step < 2" @click="next">下一步</AppButton
      ><AppButton v-else :pending="pending" @click="submit">{{
        mode === 'invite' ? '查看小队' : '创建小队'
      }}</AppButton></template
    ></Modal
  >
</template>
