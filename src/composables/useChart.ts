import { onMounted, onUnmounted, ref, watch, type Ref } from 'vue'
import * as echarts from 'echarts'

/** ECharts 封装：自动初始化、响应式 resize、主题感知；onClick 可选，绑定图表点击事件 */
export function useChart(optionFn: () => echarts.EChartsOption, deps: Ref<any>[] = [], onClick?: (params: echarts.ECElementEvent) => void) {
  const el = ref<HTMLElement>()
  let chart: echarts.ECharts | null = null

  const isDark = () => document.documentElement.classList.contains('dark')

  function render() {
    if (!el.value) return
    if (!chart) {
      chart = echarts.init(el.value)
      if (onClick) chart.on('click', onClick)
    }
    chart.setOption(optionFn())
  }

  const onResize = () => chart?.resize()
  // 仅在暗色模式实际切换时销毁重建（文字/配色随主题变化）；
  // <html> class 的无关变动（如滚动锁定、第三方库）不再触发整表 dispose + 重绘
  let wasDark = isDark()
  const observer = new MutationObserver(() => {
    const nowDark = isDark()
    if (nowDark === wasDark) return
    wasDark = nowDark
    if (chart) { chart.dispose(); chart = null }
    render()
  })

  // 容器自身尺寸变化时自适应：v-show 隐藏→显示（display:none 时 echarts 量得 0×0，
  // 图表不可见，需等容器恢复真实尺寸后 resize 才能正常渲染）、侧栏折叠、窗口分栏等
  let ro: ResizeObserver | null = null

  onMounted(() => {
    render()
    window.addEventListener('resize', onResize)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    if (el.value) {
      ro = new ResizeObserver(() => {
        if (!el.value || !chart) return
        const { width, height } = el.value.getBoundingClientRect()
        if (width > 0 && height > 0) chart.resize()
      })
      ro.observe(el.value)
    }
  })
  onUnmounted(() => {
    window.removeEventListener('resize', onResize)
    observer.disconnect()
    ro?.disconnect()
    chart?.dispose()
  })
  // deps 均为 computed/getter（值变更产生新引用），浅监听即可触发重绘；
  // 移除 deep 遍历，避免每次响应式变动都递归遍历整棵数据树
  watch(deps, render)

  return { el, isDark }
}

export function chartTextColor() {
  return document.documentElement.classList.contains('dark') ? '#cbd5e1' : '#475569'
}
