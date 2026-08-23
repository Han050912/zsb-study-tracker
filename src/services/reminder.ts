/**
 * 每日学习提醒调度器：浏览器与桌面端共用。
 * 基于 setTimeout 链实现「每天定点提醒」，应用在运行期间持续有效；
 * 设置变更（开关/时间）时调用 restartReminder() 重新调度。
 */
import { sendNotification } from './notify'

let timer: ReturnType<typeof setTimeout> | null = null

function clearTimer() {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
}

/** 取消已调度的提醒（关闭提醒或应用卸载时调用） */
export function stopReminder() {
  clearTimer()
}

/**
 * 启动/重启每日提醒调度。
 * @param getConfig 读取最新提醒配置的回调（开关 + 时间 HH:mm），保证每次调度都用最新设置
 * @param onFire    提醒触发回调（返回 false 表示系统通知未弹出，调用方可 toast 兜底）
 */
export function restartReminder(
  getConfig: () => { enabled: boolean; time: string; suppressed?: boolean },
  onFire?: (shown: boolean) => void
) {
  clearTimer()
  const cfg = getConfig()
  if (!cfg.enabled) return

  const [h, m] = (cfg.time || '08:00').split(':').map(Number)
  if (Number.isNaN(h) || Number.isNaN(m)) return

  const target = new Date()
  target.setHours(h, m, 0, 0)
  if (target.getTime() <= Date.now()) target.setDate(target.getDate() + 1)

  timer = setTimeout(() => {
    if (!getConfig().suppressed) {
      const shown = sendNotification('专升本学习提醒', '该开始学习啦！坚持就是胜利 💪')
      onFire?.(shown)
    }
    // 递归调度下一天（重新读取配置，设置改动即时生效）
    restartReminder(getConfig, onFire)
  }, target.getTime() - Date.now())
}
