<script setup lang="ts">
import Modal from './Modal.vue'

defineProps<{ show: boolean; message: string; danger: boolean }>()
const emit = defineEmits<{ confirm: []; cancel: [] }>()
</script>

<template>
  <!-- 键盘语义（ESC = 取消 / Tab 焦点陷阱 / dialog 语义 / 焦点移入与归还）与 body 滚动锁定
       统一由 Modal 提供；elevated 让确认框永远盖住业务弹窗（含弹窗内的二次确认）。
       确定按钮声明为初始焦点，Enter 即由原生按钮激活，无需再抢全局键盘事件 -->
  <Modal title="确认操作" :show="show" elevated @close="emit('cancel')">
    <p class="text-sm leading-6 text-slate-600 dark:text-slate-300 whitespace-pre-line">{{ message }}</p>
    <template #footer>
      <button class="btn-ghost" @click="emit('cancel')">取消</button>
      <button data-autofocus :class="danger ? 'btn-danger' : 'btn-primary'" @click="emit('confirm')">确定</button>
    </template>
  </Modal>
</template>
