<script lang="ts">
// 同时挂载或手动重试复用正在加载的 SDK，避免重复插入脚本。
let sdkLoadFlight: Promise<void> | null = null
</script>

<script setup lang="ts">
/**
 * Cloudflare Turnstile 人机验证组件（仅 Web 端使用）
 * 桌面端构建（--mode desktop）时由编译期常量 __DESKTOP_BUILD__ 整体 tree-shake，不打入产物
 *
 * 因 challenges.cloudflare.com 在国内网络环境下可达性不稳定，
 * 加载脚本时设有 10s 超时 + 最多 2 次重试（间隔 2s / 4s），避免永久卡在"正在验证…"状态。
 */
import { ref, onMounted, onUnmounted, nextTick } from 'vue'

const token = defineModel<string>('token', { default: '' })
const emit = defineEmits<{ (e: 'load-error'): void }>()

// 本地开发（vite dev）使用 Turnstile 官方测试 sitekey（始终通过），
// 与 worker/.dev.vars 中的测试 secret（1x0000000000000000000000000000000AA）配套，避免本地环境被真实校验卡住。
// 生产构建（vite build）自动使用真实 sitekey，不受影响。
const TURNSTILE_SITEKEY = import.meta.env.DEV ? '1x00000000000000000000AA' : '0x4AAAAAAEGLRGric6eUYnOv'
const LOAD_TIMEOUT_MS = 10_000
const MAX_RETRIES = 2

type TurnstileSdk = {
  ready(callback: () => void): void
  render(container: HTMLElement, options: Record<string, unknown>): string
  reset(id: string): void
  remove(id: string): void
}
const getSdk = () => (window as Window & { turnstile?: TurnstileSdk }).turnstile

const container = ref<HTMLDivElement>()
const status = ref<'loading' | 'rendering' | 'ready' | 'error'>('loading')
let widgetId = ''
let disposed = false

/** 单次加载 Turnstile JS SDK，附带超时保护 */
function loadScriptOnce(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (getSdk()) {
      resolve()
      return
    }

    const script = document.createElement('script')
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    script.async = true

    const timeoutId = setTimeout(() => {
      script.remove()
      reject(new Error('加载超时'))
    }, LOAD_TIMEOUT_MS)

    script.onload = () => {
      clearTimeout(timeoutId)
      resolve()
    }
    script.onerror = () => {
      clearTimeout(timeoutId)
      script.remove()
      reject(new Error('网络错误'))
    }
    document.head.appendChild(script)
  })
}

/** 带重试的脚本加载（指数退避） */
async function loadScriptWithRetries(): Promise<void> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      await loadScriptOnce()
      return
    } catch {
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)))
      }
    }
  }
  throw new Error(`重试 ${MAX_RETRIES} 次后仍无法加载验证组件`)
}

function loadScript(): Promise<void> {
  if (!sdkLoadFlight) {
    sdkLoadFlight = loadScriptWithRetries().finally(() => {
      sdkLoadFlight = null
    })
  }
  return sdkLoadFlight
}

onMounted(async () => {
  try {
    await loadScript()
    if (disposed) return
    await nextTick()
    const sdk = getSdk()
    if (!sdk) throw new Error('验证组件未就绪')
    await new Promise<void>((resolve, reject) => {
      const timeoutId = setTimeout(() => reject(new Error('验证组件初始化超时')), LOAD_TIMEOUT_MS)
      sdk.ready(() => {
        clearTimeout(timeoutId)
        resolve()
      })
    })
    if (disposed) return
    if (!container.value) throw new Error('验证容器未就绪')
    status.value = 'rendering'
    widgetId = sdk.render(container.value, {
      sitekey: TURNSTILE_SITEKEY,
      theme: 'auto',
      // 标准尺寸为 300 × 65px；表单布局为原生 iframe 保留完整宽度。
      size: 'normal',
      retry: 'auto',
      'refresh-expired': 'auto',
      'refresh-timeout': 'auto',
      callback: (t: string) => {
        if (disposed) return
        token.value = t
        status.value = 'ready'
      },
      'error-callback': () => {
        if (disposed) return false
        token.value = ''
        emit('load-error')
        status.value = 'error'
        return false // 让 Turnstile 继续自动重试；成功后的 token 会清除页面失败提示。
      },
      'expired-callback': () => {
        if (disposed) return
        token.value = ''
        status.value = 'rendering'
      },
      'timeout-callback': () => {
        if (disposed) return
        token.value = ''
        status.value = 'rendering'
      }
    })
  } catch {
    if (disposed) return
    token.value = ''
    status.value = 'error'
    emit('load-error')
  }
})

onUnmounted(() => {
  disposed = true
  if (widgetId) getSdk()?.remove(widgetId)
})

function reset() {
  if (!disposed && widgetId) {
    token.value = ''
    status.value = 'rendering'
    getSdk()?.reset(widgetId)
  }
}

defineExpose({ reset })
</script>

<template>
  <div class="flex flex-col items-center my-1">
    <div v-if="status === 'loading'" class="text-xs text-slate-400 mb-2">正在加载人机验证组件…</div>
    <div ref="container" class="flex justify-center"></div>
  </div>
</template>
