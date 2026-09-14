<script setup lang="ts">
import { ref, watch } from 'vue'
import { getErrorMessage } from '../../utils/error'
import { formatMinutes } from '../../utils/date'
import { useToast } from '../../composables/useToast'
import { createChallenge, updateChallenge } from '../../api/teams'
import { TYPE_LABEL, TYPE_UNIT, TYPE_META, todayUtc8 } from '../../utils/teamChallengeMeta'
import Modal from '../Modal.vue'
import type { ChallengeType, TeamChallenge } from '../../types'

/** 挑战表单弹窗：创建 + 编辑合一（mode 区分）；成功后 emit refresh 由页面重载 */
const props = defineProps<{
  show: boolean
  mode: 'create' | 'edit'
  teamId: string
  /** edit 模式：被编辑的挑战（提供类型与初始表单值） */
  challenge?: TeamChallenge | null
}>()

const emit = defineEmits<{
  'update:show': [boolean]
  refresh: []
}>()

const toast = useToast()

const form = ref({ type: 'streak' as ChallengeType, target: 7, durationDays: 7, startDate: todayUtc8() })
const submitting = ref(false)

/** edit 模式打开时用被编辑挑战回填表单（create 模式保持原状，与原页面行为一致：取消不重置、创建成功后才重置） */
watch(
  () => [props.show, props.challenge],
  () => {
    if (props.mode === 'edit' && props.show && props.challenge) {
      form.value = {
        type: props.challenge.type,
        target: props.challenge.target,
        durationDays: props.challenge.durationDays,
        startDate: props.challenge.startDate
      }
    }
  },
  { immediate: true }
)

async function handleSubmit() {
  if (submitting.value) return
  if (props.mode === 'edit' && !props.challenge) return
  submitting.value = true
  try {
    if (props.mode === 'create') {
      await createChallenge(props.teamId, form.value)
      toast('挑战已创建')
      emit('update:show', false)
      form.value = { type: 'streak', target: 7, durationDays: 7, startDate: todayUtc8() }
    } else {
      await updateChallenge(props.challenge!.id, {
        target: form.value.target,
        durationDays: form.value.durationDays,
        startDate: form.value.startDate
      })
      toast('挑战已更新')
      emit('update:show', false)
    }
    emit('refresh')
  } catch (e) {
    toast(getErrorMessage(e, props.mode === 'create' ? '创建失败' : '更新失败'))
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <Modal :show="show" :title="mode === 'create' ? '创建挑战' : '编辑挑战'" @close="emit('update:show', false)">
    <div class="space-y-3">
      <div v-if="mode === 'create'">
        <div class="label">挑战类型</div>
        <div class="grid grid-cols-3 gap-2">
          <button
            v-for="t in ['streak', 'minutes', 'problems'] as ChallengeType[]"
            :key="t"
            class="flex flex-col items-center gap-1 rounded-xl border px-2 py-3 transition-colors"
            :class="
              form.type === t
                ? 'border-primary-400 dark:border-primary-600 bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400'
                : 'border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-600'
            "
            @click="form.type = t"
          >
            <component :is="TYPE_META[t].icon" class="w-5 h-5" />
            <span class="text-xs font-semibold">{{ TYPE_LABEL[t] }}</span>
            <span class="text-[10px] opacity-70">{{ TYPE_META[t].desc }}</span>
          </button>
        </div>
      </div>
      <div>
        <div class="label">{{ TYPE_LABEL[form.type] }}目标（{{ TYPE_UNIT[form.type] }}）</div>
        <div class="flex items-center gap-2">
          <input
            v-model.number="form.target"
            type="number"
            min="1"
            max="10000"
            class="input flex-1"
            :placeholder="mode === 'create' ? TYPE_META[form.type].placeholder : undefined"
          />
          <span class="text-sm text-slate-500 dark:text-slate-400 shrink-0">{{ TYPE_UNIT[form.type] }}</span>
        </div>
        <p v-if="form.type === 'minutes' && form.target >= 60" class="text-xs text-slate-400 mt-1">
          约 {{ formatMinutes(form.target) }}
        </p>
        <div v-if="mode === 'create'" class="flex flex-wrap gap-1.5 mt-2">
          <button
            v-for="p in TYPE_META[form.type].presets"
            :key="p"
            class="px-2.5 py-1 rounded-full text-xs border transition-colors"
            :class="
              form.target === p
                ? 'border-primary-400 dark:border-primary-600 bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400'
                : 'border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-600'
            "
            @click="form.target = p"
          >
            {{ p }}{{ TYPE_UNIT[form.type] }}
          </button>
        </div>
      </div>
      <div>
        <div class="label">挑战天数（1-90）</div>
        <input v-model.number="form.durationDays" type="number" min="1" max="90" class="input" />
      </div>
      <div>
        <div class="label">开始日期</div>
        <input v-model="form.startDate" type="date" class="input" />
      </div>
    </div>
    <template #footer>
      <button class="btn-ghost" @click="emit('update:show', false)">取消</button>
      <button class="btn-primary" :disabled="submitting" @click="handleSubmit">
        {{ submitting ? (mode === 'create' ? '创建中…' : '保存中…') : mode === 'create' ? '创建' : '保存' }}
      </button>
    </template>
  </Modal>
</template>
