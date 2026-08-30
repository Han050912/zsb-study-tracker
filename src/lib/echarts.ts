import * as echarts from 'echarts/core'
import { LineChart, BarChart, PieChart, RadarChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, LegendComponent, RadarComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

/**
 * echarts 按需注册（唯一入口）：全仓 11 处 useChart 调用仅用到
 * line/bar/pie/radar 图表与 Grid/Tooltip/Legend/Radar 组件（已盘点）。
 * 本文件经 useChart 动态 import 加载，不进入任何静态依赖链。
 */
echarts.use([
  LineChart, BarChart, PieChart, RadarChart,
  GridComponent, TooltipComponent, LegendComponent, RadarComponent,
  CanvasRenderer
])

export default echarts
