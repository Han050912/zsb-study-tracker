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
 * SDK 加载和验证挑战分别限时；失败后等待用户重试，避免网络异常时无限自动刷新。
 */
import { ref, onMounted, onUnmounted, nextTick } from 'vue'

const token = defineModel<string>('token', { default: '' })
const emit = defineEmits<{ (e: 'load-error', message: string): void }>()

// 本地开发（vite dev）使用 Turnstile 官方测试 sitekey（始终通过），
// 与 worker/.dev.vars 中的测试 secret（1x0000000000000000000000000000000AA）配套，避免本地环境被真实校验卡住。
// 生产构建（vite build）自动使用真实 sitekey，不受影响。
const TURNSTILE_SITEKEY = import.meta.env.DEV ? '1x00000000000000000000AA' : '0x4AAAAAAEGLRGric6eUYnOv'
const LOAD_TIMEOUT_MS = 10_000
const MAX_RETRIES = 2
const CHALLENGE_TIMEOUT_MS = 30_000

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
let challengeTimer: ReturnType<typeof setTimeout> | null = null

function clearChallengeTimer() {
  if (challengeTimer) clearTimeout(challengeTimer)
  challengeTimer = null
}

function removeWidget() {
  if (!widgetId) return
  const id = widgetId
  widgetId = ''
  try {
    getSdk()?.remove(id)
  } catch {
    // SDK 清理失败也必须展示错误，并让下一次挂载获得干净容器。
    container.value?.replaceChildren?.()
  }
}

function fail(message: string) {
  if (disposed || status.value === 'error') return
  clearChallengeTimer()
  token.value = ''
  status.value = 'error'
  removeWidget()
  emit('load-error', message)
}

function startChallengeTimer() {
  clearChallengeTimer()
  status.value = 'rendering'
  challengeTimer = setTimeout(() => fail('人机验证超时。请检查网络连接后重新加载验证。'), CHALLENGE_TIMEOUT_MS)
}

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
    startChallengeTimer()
    widgetId = sdk.render(container.value, {
      sitekey: TURNSTILE_SITEKEY,
      theme: 'auto',
      // 标准尺寸为 300 × 65px；表单布局为原生 iframe 保留完整宽度。
      size: 'normal',
      retry: 'never',
      'refresh-expired': 'auto',
      'refresh-timeout': 'manual',
      callback: (t: string) => {
        if (disposed || status.value === 'error') return
        clearChallengeTimer()
        token.value = t
        status.value = 'ready'
      },
      'error-callback': (code: string) => {
        const configError = ['110100', '110110', '110200'].includes(code)
        fail(
          configError
            ? '人机验证配置异常，请联系管理员。'
            : '人机验证未完成。请检查网络连接或浏览器拦截设置后重新加载验证。'
        )
        return true
      },
      'expired-callback': () => {
        if (disposed || status.value === 'error') return
        token.value = ''
        startChallengeTimer()
      },
      'timeout-callback': () => {
        fail('人机验证已超时，请重新加载验证并完成验证。')
      }
    })
    if (status.value === 'error') removeWidget()
  } catch {
    fail('人机验证未能加载。请检查网络连接或浏览器拦截设置后重新加载验证。')
  }
})

onUnmounted(() => {
  disposed = true
  clearChallengeTimer()
  removeWidget()
})

function reset() {
  if (!disposed && widgetId) {
    token.value = ''
    startChallengeTimer()
    try {
      getSdk()?.reset(widgetId)
    } catch {
      fail('人机验证未能重新启动，请重新加载验证。')
    }
  }
}

defineExpose({ reset })
</script>

<template>
  <div class="flex flex-col items-center my-1">
    <p v-if="status === 'loading' || status === 'rendering'" class="text-sm text-muted mb-2" role="status">
      {{ status === 'loading' ? '正在加载人机验证组件…' : '正在验证，请完成下方的人机验证…' }}
    </p>
    <div ref="container" class="flex justify-center"></div>
  </div>
</template>
