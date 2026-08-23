import { ref } from 'vue'

/**
 * 弹窗遮罩「点击外部关闭」的严谨判定。
 *
 * 原生 `@click.self` 存在误关缺陷：当用户在某输入框内按下鼠标选择文本、拖到遮罩
 * 外松开时，mousedown 落在 input、mouseup 落在遮罩，浏览器会把 click 事件派发到
 * 两者的最近共同祖先（即遮罩自身），导致 `@click.self` 误判为「点击遮罩」而关闭
 * 弹窗。这里改为同时校验「按下起点也落在遮罩自身」，仅真正的遮罩点击才关闭。
 */
export function useOverlayDismiss(onDismiss: () => void) {
  /** 本次按下（mousedown）是否落在遮罩自身，用于区分「真点击遮罩」与「从弹窗内拖出」 */
  const pressedOnOverlay = ref(false)

  function onOverlayMousedown(e: MouseEvent) {
    pressedOnOverlay.value = e.target === e.currentTarget
  }

  function onOverlayClick(e: MouseEvent) {
    // 目标必须是遮罩自身，且按下起点也在遮罩自身，才视为「点击外部」
    if (e.target === e.currentTarget && pressedOnOverlay.value) {
      onDismiss()
    }
  }

  return { onOverlayMousedown, onOverlayClick }
}
