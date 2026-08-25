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

/** 生成首字母渐变头像 data URL（用户未设置头像时兜底，与 UserAvatar 视觉一致） */
function buildInitialIcon(name: string): string {
  try {
    const canvas = document.createElement('canvas')
    canvas.width = 128
    canvas.height = 128
    const ctx = canvas.getContext('2d')
    if (!ctx) return ''
    const grad = ctx.createLinearGradient(0, 0, 128, 128)
    grad.addColorStop(0, '#6366f1')
    grad.addColorStop(1, '#4f46e5')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, 128, 128)
    ctx.fillStyle = '#ffffff'
    ctx.font = 'bold 64px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText((name || '升').trim().slice(0, 1).toUpperCase(), 64, 68)
    return canvas.toDataURL('image/png')
  } catch {
    return ''
  }
}

/**
 * 构建通知图标。有头像时返回头像完整 URL（由 Electron 主进程 net.fetch 下载，绕开渲染进程 CORS 限制）；
 * 无头像时返回首字母渐变头像 data URL。
 * @param name      用户昵称（生成首字母头像用）
 * @param avatarUrl 头像完整 URL（无则 undefined）
 */
export function buildAvatarIcon(name: string, avatarUrl?: string): string {
  return avatarUrl || buildInitialIcon(name)
}

/**
 * 弹出一条系统通知。两端统一入口。
 * @param title 通知标题
 * @param body  通知正文
 * @param icon  通知图标：头像完整 URL 或 data URL（缺省用系统默认图标；可用 buildAvatarIcon 生成）
 * 返回是否成功弹出（浏览器端未授权时返回 false，调用方可用 toast 兜底提示）。
 */
export function sendNotification(title: string, body: string, icon?: string): boolean {
  if (isDesktopNotify()) {
    window.desktopNotify!.show(title, body, icon)
    return true
  }
  if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification(title, { body, icon })
      return true
    } catch {
      return false
    }
  }
  return false
}
