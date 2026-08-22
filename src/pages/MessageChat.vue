<script setup lang="ts">
import { computed, inject, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { communityApi, uploadImage, imageUrl, IMAGE_MAX_PER_MESSAGE } from '../api/community'
import UserAvatar from '../components/community/UserAvatar.vue'
import ReportDialog from '../components/community/ReportDialog.vue'
import { fromNow } from '../utils/date'
import { useAppStore } from '../stores/app'
import type { CommunityMessage } from '../types'

interface PendingImage {
  localUrl: string
  file?: File
  url?: string
  progress: number
  error?: string
}

/**
 * 私信聊天页：倒序游标分页拉取，正序渲染；5s 轮询新消息；打开即已读对方消息。
 * 单条消息可举报（仅对方发来的）。
 */
const route = useRoute()
const router = useRouter()
const store = useAppStore()
const toast = inject<(m: string) => void>('toast', () => {})
const peerId = route.params.peerId as string

const messages = ref<CommunityMessage[]>([]) // 服务端返回倒序，渲染时正序
const nextCursor = ref<string | null>(null)
const peerName = ref('')
const peerAvatar = ref('')
const loading = ref(true)
const sending = ref(false)
const text = ref('')
const images = ref<PendingImage[]>([])
const uploading = computed(() => images.value.some(i => i.progress < 1 && !i.error))
const listRef = ref<HTMLDivElement | null>(null)

/** 正序渲染（旧 → 新） */
const ordered = computed(() => [...messages.value].reverse())

let pollTimer: ReturnType<typeof setInterval> | null = null

async function load(reset = false) {
  try {
    const res = await communityApi.messagesWith(peerId, reset ? null : nextCursor.value)
    if (reset) {
      // 刷新最新一页：保留已向上翻页加载的更早历史（否则 5s 轮询会把历史冲掉）；
      // 更早历史必然比最新一页更旧，直接拼接在后面仍保持倒序
      const latestIds = new Set(res.messages.map(m => m.id))
      const older = messages.value.filter(m => !latestIds.has(m.id))
      messages.value = [...res.messages, ...older]
      // 翻页游标只在首屏建立；轮询刷新不得回退已推进的游标
      if (nextCursor.value === null) nextCursor.value = res.nextCursor
    } else {
      // 向上翻页：追加更早的消息（按 id 去重）
      const known = new Set(messages.value.map(m => m.id))
      messages.value = [...messages.value, ...res.messages.filter(m => !known.has(m.id))]
      nextCursor.value = res.nextCursor
    }
    // 会话列表接口拿不到对方名/头像，从资料卡补
    if (!peerName.value) {
      const p = await communityApi.profile(peerId)
      peerName.value = p.userName
      peerAvatar.value = p.avatar || ''
    }
  } catch (e: any) {
    if (loading.value) toast(e?.message || '加载失败')
  } finally {
    loading.value = false
  }
}

async function scrollToBottom() {
  await nextTick()
  listRef.value?.scrollTo({ top: listRef.value.scrollHeight })
}

onMounted(async () => {
  await load(true)
  await scrollToBottom()
  pollTimer = setInterval(async () => {
    const before = messages.value.length
    await load(true)
    if (messages.value.length !== before) await scrollToBottom()
  }, 5000)
})

onUnmounted(() => { if (pollTimer) clearInterval(pollTimer) })

// ---- 图片 ----
const fileInput = ref<HTMLInputElement | null>(null)
const ACCEPT = 'image/jpeg,image/png,image/webp'

function openImage(url: string) {
  window.open(url, '_blank', 'noopener')
}

function pickImage() {
  if (images.value.length >= IMAGE_MAX_PER_MESSAGE) { toast(`最多 ${IMAGE_MAX_PER_MESSAGE} 张图片`); return }
  fileInput.value?.click()
}

async function onPick(e: Event) {
  const files = Array.from((e.target as HTMLInputElement).files ?? [])
  for (const file of files) {
    if (images.value.length >= IMAGE_MAX_PER_MESSAGE) { toast(`最多 ${IMAGE_MAX_PER_MESSAGE} 张图片`); break }
    const item: PendingImage = { localUrl: URL.createObjectURL(file), file, progress: 0 }
    images.value.push(item)
    uploadImage(item.file!, r => { item.progress = r })
      .then(res => { if (res?.url) item.url = res.url; else item.error = '上传返回异常，请重试' })
      .catch((e: any) => { item.error = e?.message || '上传失败' })
  }
  ;(e.target as HTMLInputElement).value = ''
}

function removeImage(idx: number) {
  const [item] = images.value.splice(idx, 1)
  if (item) URL.revokeObjectURL(item.localUrl)
}

function retryImage(idx: number) {
  const img = images.value[idx]
  if (!img?.file) return
  img.error = undefined
  img.progress = 0
  uploadImage(img.file, r => { img.progress = r })
    .then(res => { if (res?.url) img.url = res.url; else img.error = '上传返回异常，请重试' })
    .catch((e: any) => { img.error = e?.message || '上传失败' })
}

async function send() {
  const t = text.value.trim()
  // 图文至少一项（支持纯图片私信）；上传中禁止发送
  if ((!t && !images.value.length) || sending.value) return
  if (images.value.some(i => i.error)) { toast('存在上传失败的图片，请重试或移除后发送'); return }
  if (uploading.value) { toast('图片上传中，请稍候'); return }
  const urls = images.value.map(i => i.url!).filter(Boolean)
  sending.value = true
  try {
    const m = await communityApi.sendMessage(peerId, t, urls)
    messages.value.unshift(m) // 倒序数组头部插入（最新）
    text.value = ''
    images.value.forEach(i => URL.revokeObjectURL(i.localUrl))
    images.value = []
    await scrollToBottom()
  } catch (e: any) {
    toast(e?.message || '发送失败')
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
  <div class="max-w-2xl mx-auto flex flex-col" style="height: calc(100vh - 10rem)">
    <!-- 头部 -->
    <div class="flex items-center gap-2 pb-2 border-b border-slate-100 dark:border-slate-700">
      <button class="btn-ghost !px-2" @click="router.push('/community/messages')">← 私信</button>
      <UserAvatar :name="peerName || '?'" :avatar="peerAvatar" size="sm" />
      <span class="font-semibold text-sm truncate flex-1">{{ peerName || '加载中…' }}</span>
    </div>

    <!-- 消息区 -->
    <div ref="listRef" class="flex-1 overflow-y-auto py-3 space-y-3">
      <div v-if="loading" class="text-center text-xs text-slate-400 py-8">加载中…</div>
      <template v-else>
        <div v-if="nextCursor" class="text-center">
          <button class="text-xs text-primary-500 hover:underline" @click="load()">加载更早的消息</button>
        </div>
        <div v-if="!ordered.length" class="text-center text-xs text-slate-400 py-8">打个招呼吧～</div>
        <div v-for="m in ordered" :key="m.id" class="flex gap-2" :class="m.fromMe ? 'flex-row-reverse' : ''">
          <UserAvatar :name="m.fromMe ? '我' : peerName" :avatar="m.fromMe ? store.settings.avatar : peerAvatar" size="sm" class="shrink-0 mt-0.5" />
          <div class="max-w-[75%] group">
            <div class="rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap break-words"
              :class="m.fromMe
                ? 'bg-[#95EC69] text-slate-900 rounded-tr-sm'
                : 'bg-slate-100 dark:bg-slate-700 dark:text-white rounded-tl-sm'">
              <template v-if="m.content">{{ m.content }}</template>
              <div v-if="m.imageUrls?.length" class="grid gap-1.5 mt-1" :class="m.imageUrls.length > 1 ? 'grid-cols-2' : 'grid-cols-1'">
                <img v-for="(u, i) in m.imageUrls" :key="i" :src="imageUrl(u)" alt="图片"
                  class="rounded-lg max-w-[220px] object-cover cursor-zoom-in" @click="openImage(imageUrl(u))" />
              </div>
            </div>
            <div class="flex items-center gap-2 mt-0.5 px-1" :class="m.fromMe ? 'justify-end' : ''">
              <span class="text-[10px] text-slate-400">{{ fromNow(m.createdAt) }}</span>
              <button v-if="!m.fromMe" class="text-[10px] text-slate-300 hover:text-orange-500 opacity-0 group-hover:opacity-100 transition-opacity"
                @click="openReport(m.id)">举报</button>
            </div>
          </div>
        </div>
      </template>
    </div>

    <!-- 输入区 -->
    <div class="pt-2 border-t border-slate-100 dark:border-slate-700">
      <div v-if="images.length" class="flex gap-2 mb-2 flex-wrap">
        <div v-for="(img, i) in images" :key="img.localUrl" class="relative w-16 h-16 rounded-lg overflow-hidden shrink-0">
          <img :src="img.localUrl" class="w-full h-full object-cover" alt="待发送图片" />
          <div v-if="img.progress < 1 && !img.error" class="absolute inset-0 bg-black/40 flex items-center justify-center text-[10px] text-white">
            {{ Math.round(img.progress * 100) }}%
          </div>
          <div v-if="img.error" class="absolute inset-0 flex flex-col items-center justify-center gap-0.5 text-[10px] bg-white/70 dark:bg-slate-900/70">
            <button class="text-red-500 font-medium" @click="retryImage(i)">重试</button>
            <button class="text-slate-500" @click="removeImage(i)">移除</button>
          </div>
        </div>
      </div>
      <div class="flex gap-2">
        <input ref="fileInput" type="file" :accept="ACCEPT" multiple class="hidden" @change="onPick" />
        <button class="btn-ghost !px-3 shrink-0 text-slate-500 hover:text-primary-500" title="添加图片" @click="pickImage">图片</button>
        <input v-model="text" maxlength="500" class="input flex-1" placeholder="发私信…（1-500 字）"
          @keydown.enter.exact.prevent="send" />
        <button class="btn-primary shrink-0" :disabled="(!text.trim() && !images.length) || sending || uploading" @click="send">
          {{ sending ? '发送中…' : '发送' }}
        </button>
      </div>
    </div>

    <ReportDialog v-model:show="showReport" target-type="message" :target-id="reportMsgId" />
  </div>
</template>
