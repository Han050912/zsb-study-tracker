<script setup lang="ts">
import { ref, useId } from 'vue'
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

// ESC 关闭 + Tab 焦点陷阱 + body 滚动锁定 + 焦点移入/归还全部由该 composable 托管，
// 且只有最顶层弹层响应键盘；elevated 弹层（全局确认框）使用更高层级，不会被业务弹窗盖住
const { onOverlayMousedown, onOverlayClick } = useOverlayDismiss(() => emit('close'), {
  show: () => props.show,
  panel: () => dialogEl.value
})
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div
        v-if="show"
        class="fixed inset-0 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-6"
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
          class="bg-white dark:bg-slate-800 w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl max-h-[88vh] flex flex-col animate-pop outline-none"
        >
          <div class="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-700">
            <h3 :id="titleId" class="font-bold">{{ title }}</h3>
            <!-- 视觉尺寸不变，用伪元素把命中区扩到 ≥44×44（左右各 +20px、上下各 +12px，均落在表头内边距里） -->
            <button
              class="relative text-slate-400 hover:text-slate-600 text-xl leading-none after:absolute after:-inset-x-5 after:-inset-y-3 after:content-[''] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
              @click="emit('close')"
              aria-label="关闭"
            >
              ×
            </button>
          </div>
          <div class="overflow-y-auto px-5 py-4 flex-1">
            <slot />
          </div>
          <div
            v-if="$slots.footer"
            class="px-5 py-3 border-t border-slate-100 dark:border-slate-700 flex justify-end gap-2"
          >
            <slot name="footer" />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
