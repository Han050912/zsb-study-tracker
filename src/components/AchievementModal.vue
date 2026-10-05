<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { Check, X } from '@lucide/vue'
import PostComposer from './community/PostComposer.vue'
import { OVERLAY_LAYER, useOverlayDismiss } from '../composables/useOverlayDismiss'

interface Ach {
  id: string
  name: string
  desc: string
  icon: string
}

/**
 * 待展示队列：同一 tick 内可能连续解锁多个成就（如连续 7 天打卡同时突破 5000 积分），
 * 事件监听只入队，弹窗按 SHOW_MS 依次展示，避免后者覆盖前者导致前面的成就一闪而过。
 */
const queue = ref<Ach[]>([])
const current = computed<Ach | null>(() => queue.value[0] ?? null)
/** 单条成就展示时长 */
const SHOW_MS = 3500
const panelRef = ref<HTMLElement | null>(null)

let hideTimer: ReturnType<typeof setTimeout> | null = null
/** 当前成就的剩余展示时长：悬停/聚焦暂停时冻结，离开后从剩余时长恢复 */
let remainingMs = SHOW_MS
/** 本轮倒计时的启动时刻，用于把已流逝时间从剩余时长中扣除 */
let timerStartedAt = 0

function clearTimer() {
  if (hideTimer) clearTimeout(hideTimer)
  hideTimer = null
}

/** 启动/恢复当前成就的自动关闭倒计时 */
function scheduleHide(ms: number) {
  clearTimer()
  timerStartedAt = Date.now()
  remainingMs = ms
  hideTimer = setTimeout(next, ms)
}

/** 鼠标悬停或键盘聚焦弹窗时暂停自动关闭（仅当前计时在走时生效） */
function pauseAutoHide() {
  if (!current.value || hideTimer === null) return
  clearTimer()
  remainingMs = Math.max(0, remainingMs - (Date.now() - timerStartedAt))
}

/** 离开弹窗后恢复倒计时 */
function resumeAutoHide() {
  if (!current.value || hideTimer !== null) return
  scheduleHide(remainingMs)
}

/** 展示下一条；队列清空即关闭弹层 */
function next() {
  clearTimer()
  queue.value.shift()
  if (queue.value.length) scheduleHide(SHOW_MS)
}

/** 关闭弹层并丢弃待展示队列（用户主动关闭 / ESC / 点击遮罩） */
function close() {
  clearTimer()
  queue.value = []
}

// ---- 分享到社区广场 ----
const showComposer = ref(false)
const shareContent = ref('')
const shareRefId = ref('')

/** 先打开可编辑的分享草稿，由用户确认发布。 */
function share() {
  if (!current.value) return
  shareContent.value = `我完成了「${current.value.name}」。\n${current.value.desc}`
  shareRefId.value = current.value.id
  close()
  showComposer.value = true
}

function onUnlock(e: Event) {
  const ach = (e as CustomEvent<Ach | undefined>).detail
  if (!ach) return
  queue.value.push(ach)
  // 只有从空闲转入展示时才启动计时：追加进队不打断当前成就的展示节奏
  if (queue.value.length === 1) scheduleHide(SHOW_MS)
}

// 弹层行为接入全局弹层栈（ESC 关闭 + 焦点陷阱 + 滚动锁定），与其它弹窗共用同一套键盘仲裁，
// 避免被遮挡的下层弹窗抢占 Enter / ESC；本组件只消费 useOverlayDismiss 的既有导出。
const { onOverlayMousedown, onOverlayClick } = useOverlayDismiss(close, {
  show: () => !!current.value,
  panel: () => panelRef.value
})

onMounted(() => window.addEventListener('achievement', onUnlock))
onUnmounted(() => {
  window.removeEventListener('achievement', onUnlock)
  clearTimer()
})
</script>

<template>
  <Teleport to="body">
    <!-- 每项完成只做一次短暂入场，后续阅读与操作保持静止。 -->
    <div
      v-if="current"
      :key="current.id"
      class="fixed inset-0 flex items-center justify-center bg-black/40"
      :class="OVERLAY_LAYER.lightbox"
      @mousedown="onOverlayMousedown"
      @click="onOverlayClick"
    >
      <!-- role="dialog" + aria-modal + aria-labelledby：弹窗语义；悬停/聚焦时暂停自动关闭 -->
      <div
        ref="panelRef"
        role="dialog"
        aria-modal="true"
        aria-labelledby="achievement-title"
        aria-describedby="achievement-description"
        class="achievement-feedback"
        @mouseenter="pauseAutoHide"
        @mouseleave="resumeAutoHide"
        @focusin="pauseAutoHide"
        @focusout="resumeAutoHide"
      >
        <button type="button" class="btn-ghost absolute top-2 right-2 !p-3" aria-label="关闭成就提示" @click="close">
          <X class="w-4 h-4" aria-hidden="true" />
        </button>
        <div class="achievement-feedback-mark mb-4" aria-hidden="true"><Check :size="22" /></div>
        <p class="study-eyebrow mb-1">这一步，完成了</p>
        <h2 id="achievement-title" class="text-xl font-bold">{{ current.name }}</h2>
        <p id="achievement-description" class="text-sm text-muted mt-2">{{ current.desc }}</p>
        <p v-if="queue.length > 1" class="text-xs text-muted mt-2">还有 {{ queue.length - 1 }} 项成就</p>
        <div class="flex flex-wrap gap-2 mt-6">
          <button class="btn-primary" @click="next">{{ queue.length > 1 ? '查看下一项' : '继续学习' }}</button>
          <button class="btn-ghost" @click="share">分享到社区</button>
        </div>
      </div>
    </div>
  </Teleport>
  <PostComposer
    v-model:show="showComposer"
    type="achievement"
    :preset-content="shareContent"
    ref-type="achievement"
    :ref-id="shareRefId"
  />
</template>
