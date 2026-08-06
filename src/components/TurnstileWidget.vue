<script setup lang="ts">
/**
 * Cloudflare Turnstile 人机验证组件（仅 Web 端使用）
 * 桌面端构建（--mode desktop）时由编译期常量 __DESKTOP_BUILD__ 整体 tree-shake，不打入产物
 */
import { ref, onMounted, onUnmounted, nextTick } from 'vue'

const token = defineModel<string>('token', { default: '' })
const emit = defineEmits<{ (e: 'load-error'): void }>()

const TURNSTILE_SITEKEY = '0x4AAAAAAEGLRGric6eUYnOv'
const container = ref<HTMLDivElement>()
let widgetId = ''

function loadScript(): Promise<void> {
  return new Promise((resolve) => {
    if ((window as any).turnstile) { resolve(); return }
    const script = document.createElement('script')
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    script.async = true
    script.defer = true
    script.onload = () => resolve()
    // 加载失败（网络/CSP 拦截）也 resolve，避免 onMounted 永久悬挂；由父级提示用户
    script.onerror = () => { emit('load-error'); resolve() }
    document.head.appendChild(script)
  })
}

onMounted(async () => {
  await loadScript()
  await nextTick()
  if (!container.value || !(window as any).turnstile) return
  widgetId = (window as any).turnstile.render(container.value, {
    sitekey: TURNSTILE_SITEKEY,
    theme: 'light',
    callback: (t: string) => { token.value = t },
    // 域名不在白名单、网络问题等导致渲染失败时通知父级
    'error-callback': () => { emit('load-error') },
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
  <div ref="container" class="flex justify-center my-1"></div>
</template>
