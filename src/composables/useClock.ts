import { computed, onMounted, onUnmounted, ref } from 'vue'

/**
 * 实时系统时钟：每秒刷新（番茄专注 / 开黑自习室共用）。
 * 返回原始 now（供派生计算，如「今日」键随时钟跨天自动切换）与格式化好的时钟 / 日期文本。
 * 挂载时启动 1s 定时器，组件销毁自动清理，调用方无需手动管理生命周期。
 */
export function useClock() {
  const now = ref(new Date())
  let clockHandle: ReturnType<typeof setInterval> | null = null

  const clockText = computed(() => {
    const d = now.value
    return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':')
  })
  const dateText = computed(() => {
    const d = now.value
    const week = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()]
    return `${d.getMonth() + 1}月${d.getDate()}日 星期${week}`
  })

  onMounted(() => {
    clockHandle = setInterval(() => {
      now.value = new Date()
    }, 1000)
  })
  onUnmounted(() => {
    if (clockHandle) clearInterval(clockHandle)
  })

  return { now, clockText, dateText }
}
