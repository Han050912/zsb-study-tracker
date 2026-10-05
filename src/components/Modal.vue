<script setup lang="ts">
import { ref, useId } from 'vue'
import { X } from '@lucide/vue'
import { OVERLAY_LAYER, useOverlayDismiss } from '../composables/useOverlayDismiss'

const props = withDefaults(defineProps<{ title: string; show: boolean; elevated?: boolean; panelClass?: string }>(), {
  elevated: false,
  panelClass: ''
})
const emit = defineEmits<{ close: [] }>()

/** 对话框面板（Teleport 内的真实 HTMLElement）：焦点陷阱与 aria-labelledby 的锚点 */
const dialogEl = ref<HTMLElement | null>(null)
/** 标题 id：同组件多实例并存时保证 aria-labelledby 不串台 */
const titleId = useId()
function disableLeavingPanel(element: Element) {
  element.setAttribute('inert', '')
}
function enableEnteringPanel(element: Element) {
  element.removeAttribute('inert')
}

// ESC 关闭 + Tab 焦点陷阱 + body 滚动锁定 + 焦点移入/归还全部由该 composable 托管，
// 且只有最顶层弹层响应键盘；elevated 弹层（全局确认框）使用更高层级，不会被业务弹窗盖住
const { onOverlayMousedown, onOverlayClick } = useOverlayDismiss(() => emit('close'), {
  show: () => props.show,
  panel: () => dialogEl.value
})
</script>

<template>
  <Teleport to="body">
    <Transition name="modal" @before-enter="enableEnteringPanel" @before-leave="disableLeavingPanel">
      <div
        v-if="show"
        class="fixed inset-0 flex items-end sm:items-center justify-center modal-backdrop p-0 sm:p-6"
        :class="elevated ? OVERLAY_LAYER.confirm : OVERLAY_LAYER.modal"
        @mousedown="onOverlayMousedown"
        @click="onOverlayClick"
      >
        <div
          ref="dialogEl"
          role="dialog"
          aria-modal="true"
          :aria-labelledby="titleId"
          tabindex="-1"
          :class="panelClass"
          class="modal-panel w-full min-w-0 sm:max-w-lg sm:rounded-card rounded-t-card max-h-[88dvh] flex flex-col outline-none"
        >
          <div class="modal-header flex shrink-0 items-center justify-between gap-3 px-5 py-3 border-b">
            <h3 :id="titleId" class="font-bold">{{ title }}</h3>
            <!-- 关闭按钮保留完整 44px 命中区，避免触摸操作依赖伪元素。 -->
            <button
              class="icon-button shrink-0 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700"
              type="button"
              @click="emit('close')"
              aria-label="关闭"
            >
              <X :size="20" aria-hidden="true" />
            </button>
          </div>
          <div
            class="modal-content overflow-y-auto min-h-0 px-5 py-4 flex-1"
            :class="{ 'modal-content-no-footer': !$slots.footer }"
          >
            <slot />
          </div>
          <div v-if="$slots.footer" class="modal-footer px-5 py-3 border-t flex flex-wrap shrink-0 justify-end gap-2">
            <slot name="footer" />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
