<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, ref } from 'vue'

/**
 * 桌面端自动更新弹窗
 * 数据来源：electron-updater 经主进程 IPC 推送（版本号 / 发布说明 / 发布日期 / 下载进度）
 * 仅在 Electron 打包环境（window.updater 存在）下工作，Web 端自动隐藏
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
      install: () => void
      onAvailable: (cb: (info: UpdateInfo) => void) => void
      onProgress: (cb: (p: { percent: number }) => void) => void
      onDownloaded: (cb: (info: { version: string }) => void) => void
      onError: (cb: (msg: string) => void) => void
    }
  | undefined

// 全局 Toast（App.vue 通过 provide('toast') 注入），用于弹窗未打开时也提示更新错误
const toast = inject<(m: string) => void>('toast', () => {})

const show = ref(false)
const info = ref<UpdateInfo | null>(null)
// idle: 待确认 | downloading: 下载中 | downloaded: 待重启
const stage = ref<'idle' | 'downloading' | 'downloaded'>('idle')
const percent = ref(0)
const errorMsg = ref('')

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
        current = { icon: '📋', title: '更新内容', items: [] }
        result.push(current)
      }
      current.items.push(text)
    }
  }
  return result.filter(s => s.items.length > 0)
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
  stage.value = 'downloading'
  updater?.download()
}
function restartInstall() {
  updater?.install()
}
function close() {
  // 下载中不允许关闭，避免用户误以为更新已取消
  if (stage.value === 'downloading') return
  show.value = false
}

onMounted(() => {
  if (!updater) return
  updater.onAvailable((i) => {
    info.value = i
    stage.value = 'idle'
    percent.value = 0
    errorMsg.value = ''
    show.value = true
  })
  updater.onProgress((p) => {
    percent.value = Math.min(100, Math.max(0, Math.round(p.percent)))
  })
  updater.onDownloaded(() => {
    stage.value = 'downloaded'
  })
  updater.onError((msg) => {
    if (show.value) {
      // 下载阶段出错：回到待确认态并提示，可重试
      stage.value = 'idle'
      errorMsg.value = `下载失败：${msg}`
    } else {
      // 弹窗未打开（如手动检查更新时失败），也提示用户
      toast(`检查更新失败：${msg}`)
    }
  })
})

onBeforeUnmount(() => { show.value = false })
</script>

<template>
  <Teleport to="body">
    <Transition name="update-fade">
      <div v-if="show && info" class="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" @click.self="close">
        <div class="update-pop bg-white dark:bg-slate-800 w-full max-w-2xl rounded-xl shadow-2xl flex flex-col max-h-[85vh]">
          <!-- 头部：版本标题 + 前往发布页 -->
          <div class="flex items-center justify-between px-6 pt-5 pb-3">
            <h3 class="text-2xl font-bold text-slate-800 dark:text-slate-100">新版本 v{{ info.version }}</h3>
            <button
              class="px-4 py-1.5 rounded-md bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium transition-colors shrink-0"
              @click="goReleasePage">
              前往发布页
            </button>
          </div>

          <!-- 发布说明（分组列表，可滚动） -->
          <div class="update-scroll flex-1 overflow-y-auto px-6 py-2 min-h-0">
            <template v-if="sections.length">
              <div v-for="sec in sections" :key="sec.title" class="mb-4">
                <div class="flex items-center gap-2 font-bold text-slate-800 dark:text-slate-100 mb-2">
                  <span>{{ sec.icon }}</span><span>{{ sec.title }}</span>
                </div>
                <ul class="space-y-2">
                  <li v-for="(item, idx) in sec.items" :key="idx"
                    class="flex items-start gap-2.5 text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
                    <span class="mt-[7px] w-1.5 h-1.5 rounded-full bg-slate-800 dark:bg-slate-300 shrink-0"></span>
                    <span>{{ item }}</span>
                  </li>
                </ul>
              </div>
            </template>
            <div v-else class="text-sm text-slate-400 py-6 text-center">暂无详细更新说明</div>

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
                  @click="close">取消</button>
                <button
                  class="px-5 py-1.5 rounded-md bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium transition-colors"
                  @click="startDownload">更新</button>
              </template>
              <!-- 下载中：进度条 + 百分比 -->
              <template v-else-if="stage === 'downloading'">
                <div class="flex items-center gap-3">
                  <div class="w-40 h-1.5 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
                    <div class="h-full bg-blue-500 rounded-full transition-all duration-300" :style="{ width: percent + '%' }"></div>
                  </div>
                  <span class="text-sm text-slate-500 tabular-nums">{{ percent }}%</span>
                </div>
              </template>
              <!-- 下载完成：稍后 / 立即重启 -->
              <template v-else>
                <button
                  class="px-5 py-1.5 rounded-md border border-blue-500 text-blue-500 text-sm font-medium hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
                  @click="close">稍后重启</button>
                <button
                  class="px-5 py-1.5 rounded-md bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium transition-colors"
                  @click="restartInstall">立即重启更新</button>
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
  from { transform: scale(0.95) translateY(8px); opacity: 0; }
  to { transform: scale(1) translateY(0); opacity: 1; }
}
@keyframes update-pop-out {
  from { transform: scale(1); opacity: 1; }
  to { transform: scale(0.97); opacity: 0; }
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
