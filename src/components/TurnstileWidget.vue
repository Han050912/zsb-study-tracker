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

const TURNSTILE_SITEKEY = '0x4AAAAAAEGLRGric6eUYnOv'
const LOAD_TIMEOUT_MS = 10_000
const MAX_RETRIES = 2

const container = ref<HTMLDivElement>()
const status = ref<'loading' | 'rendering' | 'ready' | 'error'>('loading')
let widgetId = ''

/** 单次加载 Turnstile JS SDK，附带超时保护 */
function loadScriptOnce(): Promise<void> {
  return new Promise((resolve, reject) => {
    if ((window as any).turnstile) { resolve(); return }

    const script = document.createElement('script')
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    script.async = true

    const timeoutId = setTimeout(() => {
      script.remove()
      reject(new Error('加载超时'))
    }, LOAD_TIMEOUT_MS)

    script.onload = () => { clearTimeout(timeoutId); resolve() }
    script.onerror = () => {
      clearTimeout(timeoutId)
      script.remove()
      reject(new Error('网络错误'))
    }
    document.head.appendChild(script)
  })
}

/** 带重试的脚本加载（指数退避） */
async function loadScript(): Promise<void> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      await loadScriptOnce()
      return
    } catch {
      if (attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, 2000 * (attempt + 1)))
      }
    }
  }
  throw new Error(`重试 ${MAX_RETRIES} 次后仍无法加载验证组件`)
}

onMounted(async () => {
  // 1. 加载 SDK（含超时 + 重试）
  try {
    await loadScript()
  } catch {
    status.value = 'error'
    emit('load-error')
    return
  }

  // 2. 渲染验证组件
  await nextTick()
  if (!container.value || !(window as any).turnstile) {
    status.value = 'error'
    emit('load-error')
    return
  }

  status.value = 'rendering'
  widgetId = (window as any).turnstile.render(container.value, {
    sitekey: TURNSTILE_SITEKEY,
    theme: 'light',
    callback: (t: string) => { token.value = t; status.value = 'ready' },
    'error-callback': () => { emit('load-error'); status.value = 'error' },
    'expired-callback': () => { token.value = '' },
  })
})

onUnmounted(() => {
  if (widgetId) (window as any).turnstile.remove(widgetId)
})

function reset() {
  if (widgetId) {
    (window as any).turnstile.reset(widgetId)
    token.value = ''
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
