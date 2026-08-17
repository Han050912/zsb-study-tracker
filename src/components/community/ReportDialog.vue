<script setup lang="ts">
import { inject, ref, watch } from 'vue'
import Modal from '../Modal.vue'
import { communityApi } from '../../api/community'

/** 举报弹窗：预设原因单选 + 补充说明（选「其他」时必填） */
const props = withDefaults(defineProps<{
  show: boolean
  targetType: 'post' | 'comment' | 'message'
  targetId: string
}>(), { targetId: '' })

const emit = defineEmits<{ 'update:show': [boolean]; reported: [] }>()
const toast = inject<(m: string) => void>('toast', () => {})

const REASONS = ['广告', '人身攻击', '不相关内容', '其他'] as const

const reason = ref<string>('')
const detail = ref('')
const submitting = ref(false)

watch(() => props.show, v => {
  if (v) { reason.value = ''; detail.value = '' }
})

async function submit() {
  if (!reason.value) { toast('请选择举报原因'); return }
  if (reason.value === '其他' && !detail.value.trim()) { toast('选择「其他」时请填写补充说明'); return }
  submitting.value = true
  try {
    await communityApi.report(props.targetType, props.targetId, reason.value, detail.value.trim() || undefined)
    toast('举报已提交，感谢你的监督')
    emit('update:show', false)
    emit('reported')
  } catch (e: any) {
    toast(e?.message || '举报失败，请稍后再试')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <Modal :show="show" title="举报内容" @close="emit('update:show', false)">
    <div class="space-y-1.5">
      <label v-for="r in REASONS" :key="r"
        class="flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors"
        :class="reason === r ? 'bg-primary-50 dark:bg-primary-900/30' : 'hover:bg-slate-50 dark:hover:bg-slate-700'">
        <input type="radio" name="report-reason" :value="r" v-model="reason" class="accent-primary-500" />
        <span class="text-sm">{{ r }}</span>
      </label>
    </div>
    <textarea v-model="detail" rows="3" maxlength="200" class="input mt-3"
      :placeholder="reason === '其他' ? '请描述问题（必填，200 字以内）' : '补充说明（可选，200 字以内）'"></textarea>
    <template #footer>
      <button class="btn-ghost" @click="emit('update:show', false)">取消</button>
      <button class="btn-primary" :disabled="submitting" @click="submit">
        {{ submitting ? '提交中…' : '提交举报' }}
      </button>
    </template>
  </Modal>
</template>
