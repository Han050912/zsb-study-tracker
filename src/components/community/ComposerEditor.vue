<script setup lang="ts">
import { defineAsyncComponent, ref } from 'vue'
const props = defineProps<{ modelValue: string; placeholder: string; allowTemplate?: boolean }>()
const emit = defineEmits<{
  'update:modelValue': [value: string]
  paste: [event: ClipboardEvent]
  drop: [event: DragEvent]
  template: []
}>()
const MarkdownContent = defineAsyncComponent(() => import('./MarkdownContent.vue'))
const textarea = ref<HTMLTextAreaElement | null>(null),
  preview = ref(false)
function insert(before: string, after: string, placeholder: string) {
  const el = textarea.value
  if (!el) return
  const start = el.selectionStart,
    end = el.selectionEnd,
    selected = props.modelValue.slice(start, end) || placeholder
  emit('update:modelValue', props.modelValue.slice(0, start) + before + selected + after + props.modelValue.slice(end))
  requestAnimationFrame(() => {
    el.focus()
    el.setSelectionRange(start + before.length, start + before.length + selected.length)
  })
}
const actions = [
  { icon: 'B', label: '粗体', before: '**', after: '**', text: '粗体' },
  { icon: '< >', label: '行内代码', before: '`', after: '`', text: 'code' },
  { icon: '{ }', label: '代码块', before: '\n```\n', after: '\n```\n', text: '代码' },
  { icon: '❯', label: '引用', before: '\n> ', after: '\n', text: '引用内容' },
  { icon: '•', label: '无序列表', before: '\n- ', after: '', text: '列表项' },
  { icon: 'Σ', label: '行内公式', before: '$', after: '$', text: 'E=mc^2' },
  { icon: 'ΣΣ', label: '块级公式', before: '\n$$\n', after: '\n$$\n', text: 'x^2' }
]
</script>
<template>
  <div class="collaboration-page">
    <div class="flex gap-1 items-center flex-wrap mb-2">
      <button
        v-for="action in actions"
        :key="action.label"
        type="button"
        class="px-3 rounded-lg text-sm hover:bg-slate-100 dark:hover:bg-slate-700"
        :aria-label="action.label"
        :title="action.label"
        :disabled="preview"
        @click="insert(action.before, action.after, action.text)"
      >
        {{ action.icon }}</button
      ><button v-if="allowTemplate" class="btn-ghost" @click="emit('template')">经验帖模板</button
      ><button class="btn-ghost ml-auto" :aria-pressed="preview" @click="preview = !preview">
        {{ preview ? '继续编辑' : '预览' }}
      </button>
    </div>
    <div @dragover.prevent @drop.prevent="emit('drop', $event)">
      <textarea
        v-show="!preview"
        ref="textarea"
        :value="modelValue"
        class="input"
        rows="6"
        maxlength="5000"
        :placeholder="placeholder"
        aria-label="帖子内容"
        @input="emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
        @paste="emit('paste', $event)"
      ></textarea>
      <div v-if="preview" class="input min-h-36">
        <MarkdownContent v-if="modelValue" :content="modelValue" />
        <p v-else class="text-slate-500">暂无内容</p>
      </div>
    </div>
    <p class="text-xs text-slate-500 mt-2 text-right training-number">{{ modelValue.length }} / 5000</p>
  </div>
</template>
