<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import Modal from './Modal.vue'

const props = defineProps<{ show: boolean; message: string; danger: boolean }>()
const emit = defineEmits<{ confirm: []; cancel: [] }>()

const cancelBtn = ref<HTMLButtonElement | null>(null)
const confirmBtn = ref<HTMLButtonElement | null>(null)
/** 打开前的活动元素，关闭时还原焦点 */
let previousFocus: Element | null = null

/** 焦点还原防护：元素可能已销毁/不可聚焦，静默跳过 */
function restoreFocus() {
  const el = previousFocus
  previousFocus = null
  if (el instanceof HTMLElement && el.isConnected) {
    try {
      el.focus()
    } catch {
      /* 元素已不可聚焦时静默 */
    }
  }
}

// 键盘语义对齐原生 confirm：Enter = 确定，Esc = 取消；Tab 在两按钮间循环（focus trap）。
// 仅在弹窗可见时挂载监听
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.preventDefault()
    emit('confirm')
  } else if (e.key === 'Escape') {
    emit('cancel')
  } else if (e.key === 'Tab') {
    const btns = [cancelBtn.value, confirmBtn.value].filter((b): b is HTMLButtonElement => !!b)
    if (!btns.length) return
    e.preventDefault()
    const idx = btns.indexOf(document.activeElement as HTMLButtonElement)
    const step = e.shiftKey ? -1 : 1
    const next = idx === -1 ? (e.shiftKey ? btns[btns.length - 1] : btns[0]) : btns[(idx + step + btns.length) % btns.length]
    next.focus()
  }
}
watch(
  () => props.show,
  async (v) => {
    if (v) {
      previousFocus = document.activeElement
      window.addEventListener('keydown', onKeydown)
      await nextTick() // 等 Modal v-if 渲染完成后 autofocus 确定按钮
      confirmBtn.value?.focus()
    } else {
      window.removeEventListener('keydown', onKeydown)
      restoreFocus()
    }
  }
)
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  if (props.show) restoreFocus() // 打开状态下组件被卸载时同样还原焦点
})
</script>

<template>
  <Modal title="确认操作" :show="show" @close="emit('cancel')">
    <p class="text-sm leading-6 text-slate-600 dark:text-slate-300 whitespace-pre-line">{{ message }}</p>
    <template #footer>
      <button ref="cancelBtn" class="btn-ghost" @click="emit('cancel')">取消</button>
      <button ref="confirmBtn" :class="danger ? 'btn-danger' : 'btn-primary'" @click="emit('confirm')">确定</button>
    </template>
  </Modal>
</template>
