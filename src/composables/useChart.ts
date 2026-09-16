import { onMounted, onUnmounted, ref, watch, type Ref } from 'vue'
import type { EChartsOption } from 'echarts'
// ECharts / ECElementEvent 实例与事件类型须与 echartsModule（echarts/core）
// 声明链同源：'echarts' 主入口的 ECharts、ECElementEvent 与 core 侧是两条
// 独立声明链（private 成员 nominal 不兼容），故单独从 echarts/core 导入；
// 均为 type-only，零运行时
import type { ECharts, ECElementEvent } from 'echarts/core'

type EchartsModule = (typeof import('../lib/echarts'))['default']
let modulePromise: Promise<EchartsModule> | null = null
let echartsModule: EchartsModule | null = null

/** 模块级单例：首次图表挂载触发 echarts 加载，多个图表实例共享同一次网络往返 */
function ensureEcharts(): Promise<EchartsModule> {
  modulePromise ??= import('../lib/echarts')
    .then((m) => {
      echartsModule = m.default
      return m.default
    })
    .catch((e) => {
      // 加载失败置空缓存，避免永久缓存 rejected promise，后续挂载可重试
      modulePromise = null
      throw e
    })
  return modulePromise
}

/** 图表状态：loading=chunk 加载中 / ready=可渲染 / error=加载失败（调用方渲染带重试的占位） */
export type ChartStatus = 'loading' | 'ready' | 'error'

/**
 * ECharts 封装：自动初始化、响应式 resize、主题感知；onClick 可选，绑定图表点击事件。
 * el 与 status 相互独立：容器（el）何时出现不影响加载，两者任一就位都会在就绪时渲染。
 */
export function useChart(
  optionFn: () => EChartsOption | null | undefined,
  deps: Ref<any>[] = [],
  onClick?: (params: ECElementEvent) => void
) {
  const el = ref<HTMLElement>()
  const status = ref<ChartStatus>('loading')
  let chart: ECharts | null = null

  const isDark = () => document.documentElement.classList.contains('dark')

  function render() {
    if (!el.value || status.value !== 'ready' || !echartsModule) return
    if (!chart) {
      chart = echartsModule.init(el.value)
      if (onClick) chart.on('click', onClick)
    }
    const option = optionFn()
    if (option == null) {
      chart.clear()
      return
    }
    chart.setOption(option)
  }

  const onResize = () => chart?.resize()
  // 仅在暗色模式实际切换时销毁重建（文字/配色随主题变化）；
  // <html> class 的无关变动（如滚动锁定、第三方库）不再触发整表 dispose + 重绘
  let wasDark = isDark()
  const observer = new MutationObserver(() => {
    const nowDark = isDark()
    if (nowDark === wasDark) return
    wasDark = nowDark
    if (chart) {
      chart.dispose()
      chart = null
    }
    render()
  })

  // 容器自身尺寸变化时自适应：v-show 隐藏→显示（display:none 时 echarts 量得 0×0，
  // 图表不可见，需等容器恢复真实尺寸后 resize 才能正常渲染）、侧栏折叠、窗口分栏等
  let ro: ResizeObserver | null = null

  /** 跟随容器挂载/卸载：容器换了节点就要重新观察（v-if 后置出现、错误占位替换等） */
  function observeResize(node: HTMLElement | undefined) {
    ro?.disconnect()
    ro = null
    if (!node) return
    ro = new ResizeObserver(() => {
      if (!el.value || !chart) return
      const { width, height } = el.value.getBoundingClientRect()
      if (width > 0 && height > 0) chart.resize()
    })
    ro.observe(node)
  }

  /** 加载 echarts chunk：不再依赖容器是否已挂载；失败置 error，由调用方渲染占位与重试入口 */
  function load() {
    status.value = 'loading'
    void ensureEcharts()
      .then(() => {
        status.value = 'ready'
        render()
      })
      .catch((e) => {
        status.value = 'error'
        console.error('[useChart] echarts 加载失败', e)
      })
  }

  /** 加载失败后由占位按钮调用：ensureEcharts 失败时已清空模块缓存，这里重新发起 import */
  function retry() {
    if (status.value === 'error') load()
  }

  onMounted(() => {
    window.addEventListener('resize', onResize)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    load()
  })
  onUnmounted(() => {
    window.removeEventListener('resize', onResize)
    observer.disconnect()
    ro?.disconnect()
    chart?.dispose()
  })
  // 容器后置出现（无数据→新增数据）必须能初始化渲染：跟住 el 而非只在挂载时渲染一次；
  // 容器被移除（条件渲染收起）则销毁实例，避免图表悬挂在已脱离文档的节点上
  watch(
    el,
    (node) => {
      observeResize(node)
      if (!node) {
        chart?.dispose()
        chart = null
        return
      }
      render()
    },
    { flush: 'post' }
  )
  // deps 均为 computed/getter（值变更产生新引用），浅监听即可触发重绘；
  // 移除 deep 遍历，避免每次响应式变动都递归遍历整棵数据树
  watch(deps, render)

  return { el, status, retry, isDark }
}

export function chartTextColor() {
  return document.documentElement.classList.contains('dark') ? '#cbd5e1' : '#475569'
}
