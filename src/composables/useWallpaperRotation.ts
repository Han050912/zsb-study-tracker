import { onUnmounted, ref } from 'vue'
import { API_BASE } from '../api/client'

/**
 * 壁纸轮播：专注全屏页共用（番茄专注 / 开黑自习室）。
 * 经 Worker 代理从哲风壁纸拉取静态壁纸，每 5 分钟自动轮换；
 * 图片预加载成功才切换 bgUrl，加载失败保持空值，由页面渐变背景兜底降级。
 */
export function useWallpaperRotation() {
  const bgUrl = ref('')
  let bgTimer: ReturnType<typeof setInterval> | null = null

  function fetchBackground() {
    // r 参数防缓存；Worker 每次 302 到一张随机静态壁纸
    const url = `${API_BASE}/api/proxy/wallpaper?r=${Date.now()}`
    const img = new Image()
    img.onload = () => {
      bgUrl.value = url
    }
    img.src = url
  }

  /** 开始轮播：立即拉取一张，之后每 5 分钟轮换；重复调用幂等 */
  function startBgRotation() {
    if (bgTimer) return
    fetchBackground()
    bgTimer = setInterval(fetchBackground, 300_000)
  }

  /** 停止轮播并清空背景（页面恢复渐变兜底） */
  function stopBgRotation() {
    if (bgTimer) {
      clearInterval(bgTimer)
      bgTimer = null
    }
    bgUrl.value = ''
  }

  // 组件销毁时兜底停止轮播，调用方无需再在 onUnmounted 手动清理
  onUnmounted(stopBgRotation)

  return { bgUrl, startBgRotation, stopBgRotation }
}
