<script setup lang="ts">
import { onBeforeUnmount, watch } from 'vue'
import Modal from './Modal.vue'

const props = defineProps<{ show: boolean; message: string; danger: boolean }>()
const emit = defineEmits<{ confirm: []; cancel: [] }>()

// 键盘语义对齐原生 confirm：Enter = 确定，Esc = 取消；仅在弹窗可见时挂载监听
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.preventDefault()
    emit('confirm')
  } else if (e.key === 'Escape') {
    emit('cancel')
  }
}
watch(
  () => props.show,
  (v) => {
    if (v) window.addEventListener('keydown', onKeydown)
    else window.removeEventListener('keydown', onKeydown)
  }
)
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Modal title="确认操作" :show="show" @close="emit('cancel')">
    <p class="text-sm leading-6 text-slate-600 dark:text-slate-300 whitespace-pre-line">{{ message }}</p>
    <template #footer>
      <button class="btn-ghost" @click="emit('cancel')">取消</button>
      <button :class="danger ? 'btn-danger' : 'btn-primary'" @click="emit('confirm')">确定</button>
    </template>
  </Modal>
</template>
