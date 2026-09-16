<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
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
/** 彩纸色板（纯 CSS 色块替代 emoji，避免跨端渲染不一致） */
const CONFETTI_COLORS = ['#f59e0b', '#3b82f6', '#10b981', '#ef4444', '#8b5cf6', '#ec4899']
/** 单条成就展示时长 */
const SHOW_MS = 3500
const panelRef = ref<HTMLElement | null>(null)

let hideTimer: ReturnType<typeof setTimeout> | null = null

function clearTimer() {
  if (hideTimer) clearTimeout(hideTimer)
  hideTimer = null
}

/** 展示下一条；队列清空即关闭弹层 */
function next() {
  clearTimer()
  queue.value.shift()
  if (queue.value.length) hideTimer = setTimeout(next, SHOW_MS)
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

/** 「炫耀一下」：生成成就展示帖，可编辑后发布；分享即结束本轮庆祝 */
function share() {
  if (!current.value) return
  shareContent.value = `我解锁了成就「${current.value.name}」！\n${current.value.icon} ${current.value.desc}\n继续加油，下一个成就见！`
  shareRefId.value = current.value.id
  close()
  showComposer.value = true
}

function onUnlock(e: Event) {
  const ach = (e as CustomEvent<Ach | undefined>).detail
  if (!ach) return
  queue.value.push(ach)
  // 只有从空闲转入展示时才启动计时：追加进队不打断当前成就的展示节奏
  if (queue.value.length === 1) hideTimer = setTimeout(next, SHOW_MS)
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
    <!-- :key 让每条成就重新挂载：彩纸与卡片入场动画逐个重放 -->
    <div
      v-if="current"
      :key="current.id"
      class="fixed inset-0 flex items-center justify-center bg-black/40"
      :class="OVERLAY_LAYER.lightbox"
      @mousedown="onOverlayMousedown"
      @click="onOverlayClick"
    >
      <span
        v-for="i in 30"
        :key="i"
        class="fixed top-0 w-2 h-3 rounded-sm pointer-events-none"
        :style="{
          left: ((i * 37) % 100) + 'vw',
          background: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
          animation: `confetti-fall ${2 + (i % 5) * 0.3}s linear ${(i % 10) * 0.15}s forwards`
        }"
      ></span>
      <div ref="panelRef" class="card !p-8 text-center animate-pop max-w-xs mx-4">
        <div class="text-6xl mb-3">{{ current.icon }}</div>
        <div class="text-xs text-primary-500 font-semibold mb-1">成就解锁！</div>
        <div class="text-xl font-bold">{{ current.name }}</div>
        <div class="text-sm text-slate-500 mt-1">{{ current.desc }}</div>
        <button class="btn-primary w-full mt-4" @click="share">炫耀一下</button>
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
