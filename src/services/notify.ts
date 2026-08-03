/**
 * 统一通知服务：浏览器（Web Notification API）与 Electron 桌面端（原生通知）
 * 共用这一套逻辑。桌面端通过 preload 桥接的 window.desktopNotify 调用主进程
 * 原生 Notification；浏览器端走标准 Web Notification，两端行为一致。
 */

export type NotifyPermission = 'granted' | 'denied' | 'default' | 'unsupported' | 'desktop'

/** 是否为桌面端（Electron preload 已桥接原生通知能力） */
export function isDesktopNotify(): boolean {
  return typeof window !== 'undefined' && !!window.desktopNotify?.available
}

/** 当前环境的通知权限状态；桌面端恒为 'desktop'（无需授权） */
export function notifyPermission(): NotifyPermission {
  if (isDesktopNotify()) return 'desktop'
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported'
  return Notification.permission
}

/**
 * 请求通知权限（仅浏览器端需要；桌面端直接返回 granted）。
 * 返回最终权限状态，调用方据此决定是否允许开启提醒。
 */
export async function requestNotifyPermission(): Promise<NotifyPermission> {
  if (isDesktopNotify()) return 'desktop'
  const perm = notifyPermission()
  if (perm !== 'default') return perm
  try {
    return await Notification.requestPermission()
  } catch {
    return Notification.permission
  }
}

/**
 * 弹出一条系统通知。两端统一入口。
 * 返回是否成功弹出（浏览器端未授权时返回 false，调用方可用 toast 兜底提示）。
 */
export function sendNotification(title: string, body: string): boolean {
  if (isDesktopNotify()) {
    window.desktopNotify!.show(title, body)
    return true
  }
  if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification(title, { body })
      return true
    } catch {
      return false
    }
  }
  return false
}
