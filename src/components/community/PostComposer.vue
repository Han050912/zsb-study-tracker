<script setup lang="ts">
import { inject, ref, watch } from 'vue'
import Modal from '../Modal.vue'
import TagBadge from './TagBadge.vue'
import { useCommunityStore } from '../../stores/community'
import { COMMUNITY_TAGS } from '../../data/defaults'
import type { PostType } from '../../types'

/**
 * 发帖/分享编辑器：普通发帖与各页面「分享到广场」共用。
 * 打开时（show 变为 true）以 preset 内容重置表单。
 */
const props = withDefaults(defineProps<{
  show: boolean
  type: PostType
  presetContent?: string
  presetTags?: string[]
  refType?: string
  refId?: string
}>(), { presetContent: '', presetTags: () => [], refType: undefined, refId: undefined })

const emit = defineEmits<{ 'update:show': [boolean]; posted: [] }>()

const store = useCommunityStore()
const toast = inject<(m: string) => void>('toast', () => {})

const content = ref('')
const tags = ref<string[]>([])
const submitting = ref(false)

watch(() => props.show, v => {
  if (v) {
    content.value = props.presetContent
    tags.value = [...props.presetTags]
  }
})

function toggleTag(t: string) {
  const i = tags.value.indexOf(t)
  if (i >= 0) tags.value.splice(i, 1)
  else if (tags.value.length < 5) tags.value.push(t)
  else toast('最多选择 5 个标签')
}

async function submit() {
  const text = content.value.trim()
  if (!text) { toast('请填写内容'); return }
  submitting.value = true
  try {
    await store.publishPost({
      type: props.type, content: text, tags: tags.value,
      refType: props.refType, refId: props.refId
    })
    toast('已发布到社区广场')
    emit('update:show', false)
    emit('posted')
  } catch (e: any) {
    toast(e?.message || '发布失败，请稍后再试')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <Modal :show="show" title="分享到广场" @close="emit('update:show', false)">
    <textarea v-model="content" rows="6" maxlength="5000" class="input"
      placeholder="分享你的学习动态…（支持 emoji）"></textarea>
    <div class="text-right text-[10px] text-slate-400 mt-0.5">{{ content.length }}/5000</div>
    <div class="label mt-2">话题标签（最多 5 个）</div>
    <div class="flex flex-wrap gap-1.5">
      <TagBadge v-for="t in COMMUNITY_TAGS" :key="t" :tag="t" :active="tags.includes(t)" @click="toggleTag(t)" />
    </div>
    <template #footer>
      <button class="btn-ghost" @click="emit('update:show', false)">取消</button>
      <button class="btn-primary" :disabled="submitting" @click="submit">
        {{ submitting ? '发布中…' : '发布' }}
      </button>
    </template>
  </Modal>
</template>
