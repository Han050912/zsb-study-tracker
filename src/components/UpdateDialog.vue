<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Ban } from '@lucide/vue'
import { useToast } from '../composables/useToast'
import { OVERLAY_LAYER, useOverlayDismiss } from '../composables/useOverlayDismiss'

/**
 * 桌面端自动更新弹窗
 * 数据来源：electron-updater 经主进程 IPC 推送（版本号 / 发布说明 / 发布日期 / 下载进度）
 * 仅在 Windows 桌面端（window.updater 存在，preload 同条件暴露）下工作，Web 端与非 Windows 桌面端自动隐藏
 */

interface UpdateInfo {
  version: string
  releaseName: string
  releaseNotes: string
  releaseDate: string
}
interface NoteSection {
  icon: string
  title: string
  items: string[]
}

const updater = (window as any).updater as
  | {
      check: () => void
      download: () => void
      cancelDownload: () => void
      install: () => void
      onAvailable: (cb: (info: UpdateInfo) => void) => () => void
      onProgress: (cb: (p: { percent: number }) => void) => () => void
      onDownloaded: (cb: (info: { version: string }) => void) => () => void
      onError: (cb: (msg: string) => void) => () => void
    }
  | undefined

// 全局 Toast（App.vue 通过 provide(TOAST_KEY) 注入），用于弹窗未打开时也提示更新错误
const toast = useToast()

const show = ref(false)
const info = ref<UpdateInfo | null>(null)
// idle: 待确认 | downloading: 下载中（弹窗可关闭，下载转后台） | downloaded: 待重启
const stage = ref<'idle' | 'downloading' | 'downloaded'>('idle')
const percent = ref(0)
const errorMsg = ref('')
// 用户已请求取消下载：用于吞掉主进程随后的「取消」类 error 事件（取消不是失败）
const cancelRequested = ref(false)

/** 分组图标：按发布说明的章节标题关键字匹配 */
function sectionIcon(title: string): string {
  if (/新增|功能|feat/i.test(title)) return '✨'
  if (/修复|bug|fix/i.test(title)) return '🐞'
  if (/优化|体验|性能/i.test(title)) return '⚡'
  if (/兼容|说明|注意/i.test(title)) return '📌'
  return '🔹'
}

/** 解析 GitHub Release 的 Markdown 正文为「章节 + 列表项」结构 */
const sections = computed<NoteSection[]>(() => {
  const md = info.value?.releaseNotes || ''
  if (!md.trim()) return []
  const result: NoteSection[] = []
  let current: NoteSection | null = null
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const h = line.match(/^#{1,4}\s*(.+)$/)
    if (h) {
      const title = h[1].replace(/[*_`]/g, '').trim()
      current = { icon: sectionIcon(title), title, items: [] }
      result.push(current)
      continue
    }
    const li = line.match(/^[-*]\s+(.+)$/) || line.match(/^\d+[.、]\s*(.+)$/)
    if (li) {
      const text = li[1].replace(/[*_`]/g, '').trim()
      if (!current) {
        current = { icon: '', title: '更新内容', items: [] }
        result.push(current)
      }
      current.items.push(text)
    }
  }
  return result.filter((s) => s.items.length > 0)
})

/** 发布日期：YYYY-MM-DD 友好展示 */
const releaseDateText = computed(() => {
  const d = info.value?.releaseDate
  if (!d) return ''
  const date = new Date(d)
  if (Number.isNaN(date.getTime())) return d.slice(0, 10)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
})

const RELEASE_PAGE = 'https://github.com/Han050912/zsb-study-tracker/releases'
function goReleasePage() {
  const tag = info.value?.version ? `tag/v${info.value.version}` : 'latest'
  window.open(`${RELEASE_PAGE}/${tag}`, '_blank', 'noopener,noreferrer')
}

function startDownload() {
  errorMsg.value = ''
  cancelRequested.value = false
  stage.value = 'downloading'
  show.value = true
  updater?.download()
}
/** 取消下载：回待确认态，经 IPC 通知主进程中止下载（之后可重新发起） */
function cancelDownload() {
  cancelRequested.value = true
  stage.value = 'idle'
  updater?.cancelDownload()
}
function restartInstall() {
  updater?.install()
}
function close() {
  // 下载中允许关闭：下载转后台继续，完成后经 update:downloaded 重新打开弹窗
  show.value = false
}

/** 弹窗面板：焦点陷阱与 Esc 的锚点 */
const panelRef = ref<HTMLElement | null>(null)

// Esc 关闭 + Tab 焦点陷阱 + body 滚动锁定 + 焦点移入/归还下沉到弹层栈：
// 只有位于栈顶时响应键盘，避免被上层弹层盖住时仍抢 Esc
const { onOverlayMousedown, onOverlayClick } = useOverlayDismiss(close, {
  show: () => show.value && !!info.value,
  panel: () => panelRef.value
})

// IPC 订阅的取消函数：组件卸载时统一调用，防止重复挂载时 ipcRenderer 监听器累积泄漏
const unsubscribes: Array<() => void> = []

onMounted(() => {
  if (!updater) return
  unsubscribes.push(
    updater.onAvailable((i) => {
      info.value = i
      stage.value = 'idle'
      percent.value = 0
      errorMsg.value = ''
      cancelRequested.value = false
      show.value = true
    }),
    updater.onProgress((p) => {
      percent.value = Math.min(100, Math.max(0, Math.round(p.percent)))
    }),
    updater.onDownloaded(() => {
      // 后台下载完成：重新打开弹窗进入「待重启」态
      stage.value = 'downloaded'
      show.value = true
    }),
    updater.onError((msg) => {
      if (cancelRequested.value) {
        // 用户主动取消引发的取消错误：静默忽略，保持待确认态
        cancelRequested.value = false
        return
      }
      // 回到待确认态，保证可以重新发起更新（无死角）
      stage.value = 'idle'
      if (show.value) {
        // 弹窗开着（含下载阶段出错）：就地提示，可重试
        errorMsg.value = `下载失败：${msg}`
      } else {
        // 弹窗已关闭（如后台下载失败 / 手动检查更新时失败）：Toast 提示
        toast(`更新失败：${msg}`)
      }
    })
  )
})

onBeforeUnmount(() => {
  unsubscribes.forEach((off) => off())
  unsubscribes.length = 0
  show.value = false
})
</script>

<template>
  <Teleport to="body">
    <Transition name="update-fade">
      <div
        v-if="show && info"
        class="fixed inset-0 flex items-center justify-center bg-black/40 p-4"
        :class="OVERLAY_LAYER.lightbox"
        @mousedown="onOverlayMousedown"
        @click="onOverlayClick"
      >
        <div
          ref="panelRef"
          role="dialog"
          aria-modal="true"
          aria-labelledby="update-dialog-title"
          class="update-pop bg-white dark:bg-slate-800 w-full max-w-2xl rounded-xl shadow-2xl flex flex-col max-h-[85vh]"
        >
          <!-- 头部：版本标题 + 前往发布页 -->
          <div class="flex items-center justify-between px-6 pt-5 pb-3">
            <h3 id="update-dialog-title" class="text-2xl font-bold text-slate-800 dark:text-slate-100">
              新版本 v{{ info.version }}
            </h3>
            <button
              class="px-4 py-1.5 rounded-md bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium transition-colors shrink-0"
              @click="goReleasePage"
            >
              前往发布页
            </button>
          </div>

          <!-- 发布说明（分组列表，可滚动） -->
          <div class="update-scroll flex-1 overflow-y-auto px-6 py-2 min-h-0">
            <template v-if="sections.length">
              <div v-for="sec in sections" :key="sec.title" class="mb-4">
                <div class="flex items-center gap-2 font-bold text-slate-800 dark:text-slate-100 mb-2">
                  <span v-if="sec.icon">{{ sec.icon }}</span
                  ><span>{{ sec.title }}</span>
                </div>
                <ul class="space-y-2">
                  <li
                    v-for="(item, idx) in sec.items"
                    :key="idx"
                    class="flex items-start gap-2.5 text-sm text-slate-700 dark:text-slate-300 leading-relaxed"
                  >
                    <span class="mt-[7px] w-1.5 h-1.5 rounded-full bg-slate-800 dark:bg-slate-300 shrink-0"></span>
                    <span>{{ item }}</span>
                  </li>
                </ul>
              </div>
            </template>
            <div v-else class="text-sm text-slate-400 py-6 text-center">暂无详细更新说明</div>

            <p v-if="stage === 'downloading'" class="text-xs text-slate-400 mt-2">
              可关闭弹窗，下载将在后台继续，完成后会重新打开本窗口。
            </p>

            <p v-if="errorMsg" class="text-xs text-red-500 mt-2">{{ errorMsg }}</p>
          </div>

          <!-- 底部：发布日期 + 操作按钮 -->
          <div class="flex items-center justify-between px-6 py-4 border-t border-slate-100 dark:border-slate-700">
            <span class="text-xs text-slate-400">{{ releaseDateText ? `发布于 ${releaseDateText}` : '' }}</span>
            <div class="flex items-center gap-3">
              <!-- 待确认 -->
              <template v-if="stage === 'idle'">
                <button
                  class="px-5 py-1.5 rounded-md border border-blue-500 text-blue-500 text-sm font-medium hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
                  @click="close"
                >
                  取消
                </button>
                <button
                  class="px-5 py-1.5 rounded-md bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium transition-colors"
                  @click="startDownload"
                >
                  更新
                </button>
              </template>
              <!-- 下载中：进度条 + 百分比 + 取消下载（关闭弹窗后下载转后台继续） -->
              <template v-else-if="stage === 'downloading'">
                <div class="flex items-center gap-3">
                  <div class="flex items-center gap-3">
                    <div class="w-40 h-1.5 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
                      <div
                        class="h-full bg-blue-500 rounded-full transition-all duration-300"
                        :style="{ width: percent + '%' }"
                      ></div>
                    </div>
                    <span class="text-sm text-slate-500 tabular-nums">{{ percent }}%</span>
                  </div>
                  <button
                    class="flex items-center gap-1.5 px-4 py-1.5 rounded-md border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                    @click="cancelDownload"
                  >
                    <Ban class="w-4 h-4" aria-hidden="true" />
                    取消下载
                  </button>
                </div>
              </template>
              <!-- 下载完成：稍后 / 立即重启 -->
              <template v-else>
                <button
                  class="px-5 py-1.5 rounded-md border border-blue-500 text-blue-500 text-sm font-medium hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
                  @click="close"
                >
                  稍后重启
                </button>
                <button
                  class="px-5 py-1.5 rounded-md bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium transition-colors"
                  @click="restartInstall"
                >
                  立即重启更新
                </button>
              </template>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* 遮罩淡入淡出 */
.update-fade-enter-active,
.update-fade-leave-active {
  transition: opacity 0.2s ease;
}
.update-fade-enter-from,
.update-fade-leave-to {
  opacity: 0;
}
/* 卡片弹出动画：缩放 + 轻微上浮 */
.update-fade-enter-active .update-pop {
  animation: update-pop-in 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}
.update-fade-leave-active .update-pop {
  animation: update-pop-out 0.15s ease-in;
}
@keyframes update-pop-in {
  from {
    transform: scale(0.95) translateY(8px);
    opacity: 0;
  }
  to {
    transform: scale(1) translateY(0);
    opacity: 1;
  }
}
@keyframes update-pop-out {
  from {
    transform: scale(1);
    opacity: 1;
  }
  to {
    transform: scale(0.97);
    opacity: 0;
  }
}
/* 内容区滚动条（贴近参考图的细灰滚动条） */
.update-scroll::-webkit-scrollbar {
  width: 6px;
}
.update-scroll::-webkit-scrollbar-track {
  background: transparent;
}
.update-scroll::-webkit-scrollbar-thumb {
  background: #cbd5e1;
  border-radius: 3px;
}
.update-scroll::-webkit-scrollbar-thumb:hover {
  background: #94a3b8;
}
</style>
