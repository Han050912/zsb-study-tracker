import { onMounted, onUnmounted, ref, watch, type Ref } from 'vue'
import * as echarts from 'echarts'

/** ECharts 封装：自动初始化、响应式 resize、主题感知 */
export function useChart(optionFn: () => echarts.EChartsOption, deps: Ref<any>[] = []) {
  const el = ref<HTMLElement>()
  let chart: echarts.ECharts | null = null

  const isDark = () => document.documentElement.classList.contains('dark')

  function render() {
    if (!el.value) return
    if (!chart) chart = echarts.init(el.value)
    chart.setOption(optionFn())
  }

  const onResize = () => chart?.resize()
  const observer = new MutationObserver(() => {
    if (chart) { chart.dispose(); chart = null }
    render()
  })

  onMounted(() => {
    render()
    window.addEventListener('resize', onResize)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  })
  onUnmounted(() => {
    window.removeEventListener('resize', onResize)
    observer.disconnect()
    chart?.dispose()
  })
  watch(deps, render, { deep: true })

  return { el, isDark }
}

export function chartTextColor() {
  return document.documentElement.classList.contains('dark') ? '#cbd5e1' : '#475569'
}
