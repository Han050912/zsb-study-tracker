import { nextTick, onBeforeUnmount, ref, watch } from 'vue'

/**
 * 弹层层级刻度（z-index 的单一事实来源）。
 *
 * 层级是「确定性」的：某个弹层落在哪一层由常量决定，与 Teleport 锚点插入 body 的
 * 先后顺序无关，因此全局确认框永远不会被「后挂载」的业务弹窗盖住。
 * 完整刻度（自下而上）：导航 30 < 浮动入口 40 < 业务弹窗 50 < 覆盖式弹层 60 < 引导 70 < 确认框 80 < Toast 100。
 */
export const OVERLAY_LAYER = {
  /** 业务弹窗 / 抽屉（Modal 默认层） */
  modal: 'z-50',
  /** 覆盖式弹层：灯箱 / 图片预览 / 桌面更新弹窗等全屏覆盖层，盖住业务弹窗 */
  lightbox: 'z-[60]',
  /** 引导（Onboarding）：走完或跳过的强制流程，盖住一切业务弹窗与覆盖层 */
  guide: 'z-[70]',
  /** 全局确认框：永远盖住任何业务弹窗，弹窗内的二次确认始终可见可点 */
  confirm: 'z-[80]',
  /** 全局 Toast：永远在最上层（高于所有弹层） */
  toast: 'z-[100]'
} as const

/** 弹层内可聚焦元素选择器（焦点陷阱枚举用） */
const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** 弹层面板内当前可见的可聚焦元素（面板被 Teleport 到 body，须从面板内部枚举） */
function focusablesIn(panel: HTMLElement | null): HTMLElement[] {
  if (!panel) return []
  return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => el.offsetParent !== null || el === document.activeElement
  )
}

/* ---------- 弹层栈：键盘事件只交给最顶层弹层 ----------
   业务弹窗与全局确认框都经此注册，后打开者位于栈顶。
   被盖住的下层弹层不响应任何键盘事件，杜绝「被遮挡的确认框抢占 Enter」这类问题。 */
interface OverlayEntry {
  panel: () => HTMLElement | null
  onEscape: () => void
}
const overlayStack: OverlayEntry[] = []
let keydownBound = false

function onWindowKeydown(e: KeyboardEvent) {
  const top = overlayStack[overlayStack.length - 1]
  if (!top) return
  if (e.key === 'Escape') {
    e.preventDefault()
    top.onEscape()
    return
  }
  if (e.key !== 'Tab') return
  // focus trap：Tab 只在栈顶弹层的可聚焦元素间循环，禁止焦点逃逸到背景页面
  const els = focusablesIn(top.panel())
  if (!els.length) return
  e.preventDefault()
  const idx = els.indexOf(document.activeElement as HTMLElement)
  const step = e.shiftKey ? -1 : 1
  const target = idx === -1 ? (e.shiftKey ? els[els.length - 1] : els[0]) : els[(idx + step + els.length) % els.length]
  target.focus()
}

/* ---------- body 滚动锁定（引用计数）----------
   多层弹窗叠加时按引用计数解锁：关闭其中一层不会提前放行背景滚动。
   锁定期间补偿滚动条宽度，避免页面内容横向抖动。 */
let scrollLockCount = 0
let savedOverflow = ''
let savedPaddingRight = ''

function lockBodyScroll() {
  if (scrollLockCount === 0) {
    savedOverflow = document.body.style.overflow
    savedPaddingRight = document.body.style.paddingRight
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth
    document.body.style.overflow = 'hidden'
    if (scrollbarWidth > 0) document.body.style.paddingRight = `${scrollbarWidth}px`
  }
  scrollLockCount++
}

function unlockBodyScroll() {
  if (scrollLockCount === 0) return
  scrollLockCount--
  if (scrollLockCount > 0) return
  document.body.style.overflow = savedOverflow
  document.body.style.paddingRight = savedPaddingRight
}

/**
 * 弹窗遮罩「点击外部关闭」的严谨判定。
 *
 * 原生 `@click.self` 存在误关缺陷：当用户在某输入框内按下鼠标选择文本、拖到遮罩
 * 外松开时，mousedown 落在 input、mouseup 落在遮罩，浏览器会把 click 事件派发到
 * 两者的最近共同祖先（即遮罩自身），导致 `@click.self` 误判为「点击遮罩」而关闭
 * 弹窗。这里改为同时校验「按下起点也落在遮罩自身」，仅真正的遮罩点击才关闭。
 *
 * 额外传入 `overlay` 时，同一 composable 还托管该弹层的完整弹层行为：
 * ESC 关闭、Tab 焦点陷阱、body 滚动锁定、打开时焦点移入弹层 / 关闭时归还焦点，
 * 且只有栈顶（最上层）弹层响应键盘。仅需「点击外部关闭」的调用点不传该参数。
 */
export function useOverlayDismiss(
  onDismiss: () => void,
  overlay?: { show: () => boolean; panel: () => HTMLElement | null }
) {
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

  if (!overlay) return { onOverlayMousedown, onOverlayClick }
  const { show, panel } = overlay

  const entry: OverlayEntry = { panel, onEscape: onDismiss }
  /** 打开前的活动元素，关闭时还原焦点 */
  let previousFocus: HTMLElement | null = null

  /** 退出弹层：出栈 + 解除滚动锁定 + 归还焦点（重复调用只生效一次） */
  function release() {
    if (overlayStack.includes(entry)) {
      overlayStack.splice(overlayStack.indexOf(entry), 1)
      unlockBodyScroll()
      if (!overlayStack.length && keydownBound) {
        window.removeEventListener('keydown', onWindowKeydown)
        keydownBound = false
      }
    }
    const el = previousFocus
    previousFocus = null
    // 焦点还原防护：元素可能已销毁/不可聚焦，静默跳过
    if (el?.isConnected) {
      try {
        el.focus()
      } catch {
        /* 元素已不可聚焦时静默 */
      }
    }
  }

  watch(
    show,
    async (open) => {
      if (!open) {
        release()
        return
      }
      previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
      overlayStack.push(entry)
      if (!keydownBound) {
        window.addEventListener('keydown', onWindowKeydown)
        keydownBound = true
      }
      lockBodyScroll()
      await nextTick() // 等 Teleport + v-if 渲染出面板后再移入焦点
      // 窄竞态防护：await 期间可能已被关闭，仅当仍为打开状态才聚焦
      if (!show()) return
      const el = panel()
      // 优先聚焦显式声明的初始焦点（[data-autofocus]），否则退化为弹层内首个可聚焦元素
      const target = el?.querySelector<HTMLElement>('[data-autofocus]') ?? focusablesIn(el)[0] ?? el
      target?.focus()
    },
    { immediate: true }
  )

  onBeforeUnmount(release)

  return { onOverlayMousedown, onOverlayClick }
}
