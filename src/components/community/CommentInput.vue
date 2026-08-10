<script setup lang="ts">
import { ref, watch } from 'vue'

/** 评论输入框：presetText 变化时填充（用于「回复 @某人」前缀） */
const props = withDefaults(defineProps<{ placeholder?: string; presetText?: string }>(), {
  placeholder: '写下你的评论…（支持 emoji）',
  presetText: ''
})
const emit = defineEmits<{ send: [text: string] }>()

const text = ref('')
const inputRef = ref<HTMLTextAreaElement | null>(null)

watch(() => props.presetText, v => {
  if (v) {
    text.value = v
    inputRef.value?.focus()
  }
})

function send() {
  const t = text.value.trim()
  if (!t) return
  emit('send', t)
  text.value = ''
}
</script>

<template>
  <div class="flex gap-2 items-end">
    <textarea ref="inputRef" v-model="text" rows="1" maxlength="1000" class="input flex-1"
      :placeholder="placeholder" @keydown.enter.exact.prevent="send"></textarea>
    <button class="btn-primary shrink-0" :disabled="!text.trim()" @click="send">发送</button>
  </div>
</template>
