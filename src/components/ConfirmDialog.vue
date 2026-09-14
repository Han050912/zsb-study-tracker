<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import Modal from './Modal.vue'

const props = defineProps<{ show: boolean; message: string; danger: boolean }>()
const emit = defineEmits<{ confirm: []; cancel: [] }>()

const confirmBtn = ref<HTMLButtonElement | null>(null)
/** Modal 组件实例：经其 $el 拿到对话框根节点（Teleport 到 body），供焦点陷阱枚举可聚焦元素 */
const modalRef = ref<InstanceType<typeof Modal> | null>(null)
/** 打开前的活动元素，关闭时还原焦点 */
let previousFocus: Element | null = null

/** 对话框内全部可聚焦元素（含 Modal 外壳的 × 关闭按钮），Tab 循环以此为界 */
function getFocusables(): HTMLElement[] {
  const root = (modalRef.value as unknown as { $el?: unknown } | null)?.$el
  if (!(root instanceof HTMLElement)) return []
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  ).filter((el) => el.offsetParent !== null || el === document.activeElement)
}

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

// 键盘语义对齐原生 confirm：Enter = 确定，Esc = 取消；
// Tab 在对话框全部可聚焦元素（× 关闭 + 取消 + 确定）间循环（focus trap）。
// 仅在弹窗可见时挂载监听
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.preventDefault()
    emit('confirm')
  } else if (e.key === 'Escape') {
    emit('cancel')
  } else if (e.key === 'Tab') {
    const els = getFocusables()
    if (!els.length) return
    e.preventDefault()
    const idx = els.indexOf(document.activeElement as HTMLElement)
    const step = e.shiftKey ? -1 : 1
    const next = idx === -1 ? (e.shiftKey ? els[els.length - 1] : els[0]) : els[(idx + step + els.length) % els.length]
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
      // 窄竞态防护：await 期间可能已被关闭，仅当仍为打开状态才聚焦
      if (props.show) confirmBtn.value?.focus()
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
  <Modal ref="modalRef" title="确认操作" :show="show" @close="emit('cancel')">
    <p class="text-sm leading-6 text-slate-600 dark:text-slate-300 whitespace-pre-line">{{ message }}</p>
    <template #footer>
      <button class="btn-ghost" @click="emit('cancel')">取消</button>
      <button ref="confirmBtn" :class="danger ? 'btn-danger' : 'btn-primary'" @click="emit('confirm')">确定</button>
    </template>
  </Modal>
</template>
