<script setup lang="ts">
import IconAction from '../shared/components/IconAction.vue'
import LoadingState from '../shared/components/LoadingState.vue'
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { getErrorMessage } from '../utils/error'
import { useToast } from '../composables/useToast'
import { useImageUpload } from '../composables/useImageUpload'
import { useRoute, useRouter } from 'vue-router'
import { messagesApi } from '../api/community/messages'
import { usersApi } from '../api/community/users'
import { imageUrl, IMAGE_MAX_PER_MESSAGE } from '../api/community'
import { ImageOff, RefreshCw, ArrowLeft } from '@lucide/vue'
import UserAvatar from '../components/community/UserAvatar.vue'
import ImageUploadPreview from '../components/community/ImageUploadPreview.vue'
import ReportDialog from '../components/community/ReportDialog.vue'
import Lightbox from '../components/community/Lightbox.vue'
import { useBack } from '../composables/useBack'
import { fromNow } from '../utils/date'
import { useAppStore } from '../stores/app'
import type { CommunityMessage } from '../types'

/**
 * 私信聊天页：倒序游标分页拉取，正序渲染；5s 轮询新消息；打开即已读对方消息。
 * 单条消息可举报（仅对方发来的）。
 */
const route = useRoute()
const router = useRouter()
const { goBack } = useBack()
const store = useAppStore()
const toast = useToast()
const peerId = route.params.peerId as string

/** 「打招呼」自动发送的问候语 */
const GREETING = '你好，很高兴认识你'

const messages = ref<CommunityMessage[]>([]) // 服务端返回倒序，渲染时正序
/** 更早历史的翻页游标；null 表示已无更早消息（到底） */
const nextCursor = ref<string | null>(null)
/** 首屏是否已建立游标：建立后翻页游标只由翻页推进，轮询刷新不得再改写它 */
const cursorEstablished = ref(false)
/** 翻页请求在飞：给出 loading 反馈并防重复点击 */
const loadingOlder = ref(false)
/** 翻页（加载更早）失败标记：toast 即时提示之外，按钮位置常驻变为「加载失败，点击重试」 */
const olderError = ref(false)
const peerName = ref('')
const peerAvatar = ref('')
const loading = ref(true)
const loadError = ref('')
let disposed = false
const sending = ref(false)
const text = ref('')
const { images, uploading, hasError, fileInput, pickImages, onFileChange, removeImage, retryImage, reset } =
  useImageUpload(IMAGE_MAX_PER_MESSAGE)
const listRef = ref<HTMLDivElement | null>(null)

/** 正序渲染（旧 → 新） */
const ordered = computed(() => [...messages.value].reverse())

let pollTimer: ReturnType<typeof setInterval> | null = null
/** 轮询在飞标记：上一次请求未返回时跳过本次 tick，避免请求叠加与重复补拉资料 */
let pollInFlight = false

async function load(reset = false, afterCursor?: string) {
  try {
    const latest = reset ? messages.value[0] : undefined
    // 同秒 id 是随机值：每轮重读最新一秒，再用服务端游标补齐后续页。
    const after = afterCursor ?? (latest ? `${latest.createdAt - 1}_~` : null)
    const res = await messagesApi.messagesWith(peerId, reset ? null : nextCursor.value, after)
    if (disposed) return
    loadError.value = ''
    // 打开/刷新即已读对方消息：本次标记数即时同步全局未读计数，无需等轮询
    if (res.markedRead > 0) window.dispatchEvent(new CustomEvent('message:read', { detail: res.markedRead }))
    if (reset) {
      // 轮询从已知最新消息向前逐页补齐，断网期间超过一页的新消息也不会跨过。
      const latestIds = new Set(res.messages.map((m) => m.id))
      const older = messages.value.filter((m) => !latestIds.has(m.id))
      messages.value = [...res.messages, ...older].sort(
        (a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)
      )
      // 翻页游标只在首屏建立一次：轮询刷新不得再改写它——否则翻到底（nextCursor 已为 null）后
      // 会被「最新一页」的游标写回，凭空复活一个点了也加载不出任何消息的假按钮
      if (!cursorEstablished.value) {
        nextCursor.value = res.nextCursor
        cursorEstablished.value = true
      }
    } else {
      // 向上翻页：追加更早的消息（按 id 去重），游标随服务端推进；null 即到底
      const known = new Set(messages.value.map((m) => m.id))
      messages.value = [...messages.value, ...res.messages.filter((m) => !known.has(m.id))]
      nextCursor.value = res.nextCursor
    }
    olderError.value = false
    // 会话列表接口拿不到对方名/头像，从资料卡补
    if (!peerName.value) {
      const p = await usersApi.profile(peerId)
      if (disposed) return
      peerName.value = p.userName
      peerAvatar.value = p.avatar || ''
    }
    return after ? res.nextCursor : null
  } catch (e) {
    if (disposed) return
    if (!cursorEstablished.value) loadError.value = getErrorMessage(e, '消息加载失败，请重试')
    // 轮询失败静默（否则每 5s 弹一次）；首屏与翻页失败给出提示
    if (loading.value || loadingOlder.value) {
      toast(getErrorMessage(e, '加载失败'))
      // 翻页失败：除 toast 外置失败标记，按钮常驻变为「加载失败，点击重试」供再次发起
      if (loadingOlder.value) olderError.value = true
    }
  } finally {
    loading.value = false
  }
}

function retryLoad() {
  if (loading.value || disposed) return
  loading.value = true
  void load(true)
}

/** 加载更早的消息：按钮可见即点击可用（nextCursor 为 null 时按钮根本不渲染） */
async function loadOlder() {
  if (loadingOlder.value || !nextCursor.value) return
  loadingOlder.value = true
  try {
    await load()
  } finally {
    loadingOlder.value = false
  }
}

async function scrollToBottom() {
  await nextTick()
  listRef.value?.scrollTo({ top: listRef.value.scrollHeight })
}

/** P3-06：距底部多少像素内视为「接近底部」，轮询到新消息才自动滚底，避免打断向上翻阅历史 */
const NEAR_BOTTOM_PX = 120
function isNearBottom() {
  const el = listRef.value
  if (!el) return true
  return el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_PX
}

/** 拉取一次最新消息，仅当轮询前用户已接近底部时才自动滚底；上次未返回则跳过本次（失败也不阻塞后续轮询） */
async function pollOnce() {
  if (pollInFlight || disposed) return
  pollInFlight = true
  try {
    const before = messages.value.length
    const nearBottom = isNearBottom()
    let cursor: string | null | undefined
    do {
      cursor = await load(true, cursor ?? undefined)
    } while (cursor && !disposed)
    if (messages.value.length !== before && nearBottom) await scrollToBottom()
  } finally {
    pollInFlight = false
  }
}
/** 页面可见时每 5s 轮询新消息；切后台（标签页隐藏/桌面端最小化）暂停，回前台立即补拉一次 */
function startPolling() {
  if (disposed) return
  stopPolling()
  pollTimer = setInterval(pollOnce, 5000)
}
function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}
function onVisibilityChange() {
  if (document.visibilityState === 'visible') {
    pollOnce()
    startPolling()
  } else {
    stopPolling()
  }
}

onMounted(async () => {
  await load(true)
  if (disposed) return
  await scrollToBottom()
  // 「打招呼」跳转：自动发送一条问候语（清除 query 防重复触发）
  if (
    !loadError.value &&
    route.query.greet === '1' &&
    !messages.value.some((m) => m.fromMe && m.content === GREETING)
  ) {
    try {
      const m = await messagesApi.sendMessage(peerId, GREETING)
      if (disposed) return
      messages.value.unshift(m)
      await scrollToBottom()
    } catch {
      if (!disposed) {
        text.value = GREETING
        toast('问候发送失败，已保留在输入框中，可重新发送')
      }
    }
  }
  if (disposed) return
  if (route.query.greet) router.replace({ query: { ...route.query, greet: undefined } })
  startPolling()
  document.addEventListener('visibilitychange', onVisibilityChange)
  updateThumb()
})

onUnmounted(() => {
  disposed = true
  stopPolling()
  document.removeEventListener('visibilitychange', onVisibilityChange)
  if (thumbHideTimer) clearTimeout(thumbHideTimer)
})

// ---- 自定义滚动条（悬浮唤起 + 闲置延迟隐藏 + 1/5 长度）----
const thumbTop = ref(0)
const thumbHeight = ref(0)
const isHovering = ref(false)
const isScrollingRecently = ref(false)
let thumbHideTimer: ReturnType<typeof setTimeout> | null = null

/** 更新 thumb 位置；高度固定为可视区 1/5（最小 24px） */
function updateThumb() {
  const el = listRef.value
  if (!el) return
  const H = el.clientHeight
  const C = el.scrollHeight
  if (C <= H) {
    thumbHeight.value = 0
    return
  }
  const thumbH = Math.max(H / 5, 24)
  thumbHeight.value = thumbH
  const movable = H - thumbH
  thumbTop.value = movable > 0 ? (el.scrollTop / (C - H)) * movable : 0
}

/** 滚动停止 1.2s 后收起（若未悬浮） */
function scheduleThumbHide() {
  if (thumbHideTimer) clearTimeout(thumbHideTimer)
  thumbHideTimer = setTimeout(() => {
    isScrollingRecently.value = false
  }, 1200)
}

function onChatScroll() {
  updateThumb()
  isScrollingRecently.value = true
  scheduleThumbHide()
}

function onChatMouseEnter() {
  isHovering.value = true
  updateThumb()
}

function onChatMouseLeave() {
  isHovering.value = false
}

/** 可见 = 悬浮中 或 近期滚动过（且确有可滚动内容） */
const thumbShown = computed(() => (isHovering.value || isScrollingRecently.value) && thumbHeight.value > 0)

// ---- 图片 ----
const ACCEPT = 'image/jpeg,image/png,image/webp'

// ---- 消息图片占位（P1-04）：按「消息id:序号」记录每张图的加载态；加载中由容器固定尺寸+底色占位，失败回退提示 ----
type MessageImgState = 'loading' | 'loaded' | 'failed'
const imgStates = ref<Record<string, MessageImgState>>({})
function imgKey(msgId: string, i: number) {
  return `${msgId}:${i}`
}
function imgState(m: CommunityMessage, i: number): MessageImgState {
  return imgStates.value[imgKey(m.id, i)] ?? 'loading'
}
function setImgState(msgId: string, i: number, s: MessageImgState) {
  imgStates.value[imgKey(msgId, i)] = s
}

// ---- 图片预览（浮层内嵌，不跳转 / 不打开外部链接）----
const showLightbox = ref(false)
const lightboxIndex = ref(0)
const lightboxUrls = ref<string[]>([])
function openImage(urls: string[], i: number) {
  lightboxUrls.value = urls
  lightboxIndex.value = i
  showLightbox.value = true
}

async function send() {
  const t = text.value.trim()
  // 图文至少一项（支持纯图片私信）；上传中禁止发送
  if ((!t && !images.value.length) || sending.value) return
  if (hasError.value) {
    toast('存在上传失败的图片，请重试或移除后发送')
    return
  }
  if (uploading.value) {
    toast('图片上传中，请稍候')
    return
  }
  const urls = images.value.map((i) => i.url!).filter(Boolean)
  sending.value = true
  try {
    const m = await messagesApi.sendMessage(peerId, t, urls)
    if (disposed) return
    messages.value = [...messages.value.filter((existing) => existing.id !== m.id), m].sort(
      (a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)
    )
    if (text.value.trim() === t) text.value = ''
    reset()
    await scrollToBottom()
  } catch (e) {
    toast(getErrorMessage(e, '发送失败'))
  } finally {
    sending.value = false
  }
}

// ---- 举报 ----
const showReport = ref(false)
const reportMsgId = ref('')
function openReport(msgId: string) {
  reportMsgId.value = msgId
  showReport.value = true
}
</script>

<template>
  <div class="study-page reading-page flex flex-col" style="height: calc(100dvh - 7rem); min-height: 400px">
    <!-- 头部 -->
    <div class="flex items-center gap-2 pb-2 border-b border-slate-100 dark:border-slate-700">
      <span class="arrow-action" @click="goBack"
        ><IconAction :icon="ArrowLeft" label="返回" @click="goBack" /> 返回</span
      >
      <UserAvatar :name="peerName || '?'" :avatar="peerAvatar" size="sm" />
      <span class="font-semibold text-sm truncate flex-1">{{ peerName || '加载中…' }}</span>
    </div>

    <!-- 消息区 -->
    <div class="relative flex-1 min-h-0">
      <div
        ref="listRef"
        class="chat-scroll h-full overflow-y-auto py-3 space-y-3 pr-3"
        @scroll.passive="onChatScroll"
        @mouseenter="onChatMouseEnter"
        @mouseleave="onChatMouseLeave"
      >
        <LoadingState v-if="loading" />
        <div v-else-if="loadError && !messages.length" role="alert" class="text-center p-6 space-y-3">
          <p class="text-sm text-slate-500">{{ loadError }}</p>
          <button class="btn-ghost" @click="retryLoad">重新加载消息</button>
        </div>
        <template v-else>
          <div v-if="nextCursor" class="text-center">
            <button
              class="text-xs inline-flex items-center gap-1 hover:underline disabled:text-slate-400 disabled:no-underline"
              :class="olderError ? 'text-correction dark:text-correction' : 'text-action'"
              :disabled="loadingOlder"
              @click="loadOlder"
            >
              <RefreshCw v-if="olderError" :size="12" aria-hidden="true" />
              {{ loadingOlder ? '加载中…' : olderError ? '加载失败，点击重试' : '加载更早的消息' }}
            </button>
          </div>
          <div v-if="!ordered.length" class="text-center text-xs text-slate-400 py-8">打个招呼吧～</div>
          <div v-for="m in ordered" :key="m.id" class="flex gap-2" :class="m.fromMe ? 'flex-row-reverse' : ''">
            <UserAvatar
              :name="m.fromMe ? '我' : peerName"
              :avatar="m.fromMe ? store.settings.avatar : peerAvatar"
              size="sm"
              class="shrink-0 mt-0.5"
            />
            <div class="max-w-[75%] group">
              <!-- 纯图片消息不套气泡背景，直接展示图片；图文混排才用气泡 -->
              <div
                class="text-sm whitespace-pre-wrap break-words"
                :class="
                  m.content
                    ? m.fromMe
                      ? 'rounded-2xl px-3.5 py-2 bg-action-soft text-ink border border-line rounded-tr-sm'
                      : 'rounded-2xl px-3.5 py-2 bg-slate-100 dark:bg-slate-700 dark:text-white rounded-tl-sm'
                    : ''
                "
              >
                <template v-if="m.content">{{ m.content }}</template>
                <div
                  v-if="m.imageUrls?.length"
                  class="grid gap-1.5"
                  :class="[m.imageUrls.length > 1 ? 'grid-cols-2' : 'grid-cols-1', m.content ? 'mt-1' : '']"
                >
                  <!-- 固定尺寸 + 底色容器占位（参考 PostCard），加载完成前高度稳定，失败回退提示 -->
                  <div
                    v-for="(u, i) in m.imageUrls"
                    :key="i"
                    class="rounded-lg overflow-hidden bg-slate-100 dark:bg-slate-700 aspect-square"
                    :class="m.imageUrls.length > 1 ? '' : 'w-[220px] max-w-full'"
                  >
                    <img
                      v-if="imgState(m, i) !== 'failed'"
                      v-show="imgState(m, i) === 'loaded'"
                      :src="imageUrl(u)"
                      alt="图片"
                      class="w-full h-full object-cover cursor-zoom-in"
                      @load="setImgState(m.id, i, 'loaded')"
                      @error="setImgState(m.id, i, 'failed')"
                      @click="openImage(m.imageUrls, i)"
                    />
                    <div
                      v-else
                      class="w-full h-full flex flex-col items-center justify-center gap-1 text-slate-400"
                      title="图片加载失败"
                    >
                      <ImageOff :size="18" aria-hidden="true" />
                      <span class="text-xs">图片加载失败</span>
                    </div>
                  </div>
                </div>
              </div>
              <div class="flex items-center gap-2 mt-0.5 px-1" :class="m.fromMe ? 'justify-end' : ''">
                <span class="text-xs text-slate-400">{{ fromNow(m.createdAt) }}</span>
                <button
                  v-if="!m.fromMe"
                  class="message-report min-h-11 min-w-11 text-xs text-muted hover:text-action transition-opacity"
                  @click="openReport(m.id)"
                >
                  举报
                </button>
              </div>
            </div>
          </div>
        </template>
      </div>
      <div
        class="chat-thumb"
        :class="{ 'is-visible': thumbShown }"
        :style="{ top: thumbTop + 'px', height: thumbHeight + 'px' }"
      ></div>
    </div>

    <!-- 输入区 -->
    <div class="pt-2 border-t border-slate-100 dark:border-slate-700">
      <ImageUploadPreview
        :images="images"
        list-class="flex gap-2 mb-2 flex-wrap"
        item-class="relative w-16 h-16 rounded-lg overflow-hidden shrink-0"
        progress="percent"
        :removable="false"
        @remove="removeImage"
        @retry="retryImage"
      />
      <div class="flex gap-2">
        <input
          ref="fileInput"
          type="file"
          :accept="ACCEPT"
          multiple
          class="hidden"
          :disabled="sending"
          @change="onFileChange"
        />
        <button
          class="btn-ghost !px-3 shrink-0 text-slate-500 hover:text-action"
          title="添加图片"
          :disabled="sending"
          @click="pickImages"
        >
          图片
        </button>
        <input
          v-model="text"
          maxlength="500"
          class="input flex-1"
          aria-label="发消息…（1-500 字）"
          placeholder="发消息…（1-500 字）"
          @keydown.enter.exact.prevent="send"
        />
        <button
          class="btn-primary shrink-0"
          :disabled="(!text.trim() && !images.length) || sending || uploading"
          @click="send"
        >
          {{ sending ? '发送中…' : '发送' }}
        </button>
      </div>
    </div>

    <ReportDialog v-model:show="showReport" target-type="message" :target-id="reportMsgId" />
    <Lightbox v-model:show="showLightbox" v-model:index="lightboxIndex" :urls="lightboxUrls" />
  </div>
</template>

<style scoped>
/* 触屏无需悬停即可举报；鼠标环境在悬停或键盘聚焦消息时显示。 */
@media (hover: hover) and (pointer: fine) {
  .message-report {
    opacity: 0;
  }
  .group:hover .message-report,
  .group:focus-within .message-report,
  .message-report:focus-visible {
    opacity: 1;
  }
}

/* 隐藏原生滚动条，改由自绘 thumb 展示 */
.chat-scroll {
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.chat-scroll::-webkit-scrollbar {
  display: none;
}

/* 自绘滚动条 thumb：悬浮/滚动时淡入，闲置 1.2s 后淡出 */
.chat-thumb {
  position: absolute;
  right: 2px;
  top: 0;
  width: 4px;
  border-radius: 9999px;
  background: var(--line); /* slate-300 */
  opacity: 0;
  transition: opacity 0.3s ease;
  pointer-events: none;
}
::global(.dark) .chat-thumb {
  background: var(--line);
} /* slate-600 */
.chat-thumb.is-visible {
  opacity: 1;
}
</style>
