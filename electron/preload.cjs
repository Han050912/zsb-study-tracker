/**
 * 预加载脚本：以 contextBridge 安全桥接自动更新能力到渲染进程
 * 渲染进程通过 window.updater 调用，全程不暴露 nodeIntegration
 */
const { contextBridge, ipcRenderer } = require('electron')

/**
 * IPC 事件订阅：注册监听并返回取消订阅函数（contextBridge 支持函数作为返回值跨上下文代理）。
 * 渲染进程在组件卸载（onBeforeUnmount）时调用返回值，防止重复挂载的组件累积 ipcRenderer 监听器泄漏。
 */
function subscribe(channel, cb) {
  const listener = (_e, payload) => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

contextBridge.exposeInMainWorld('updater', {
  /** 是否有更新能力（仅打包后的桌面端存在） */
  available: true,
  /** 手动检查更新 */
  check: () => ipcRenderer.send('update:check'),
  /** 开始下载更新包 */
  download: () => ipcRenderer.send('update:download'),
  /** 退出并安装更新 */
  install: () => ipcRenderer.send('update:install'),
  /** 发现新版本（携带版本号/发布说明/发布日期）；返回取消订阅函数 */
  onAvailable: (cb) => subscribe('update:available', cb),
  /** 下载进度（percent/transferred/total/bytesPerSecond）；返回取消订阅函数 */
  onProgress: (cb) => subscribe('update:progress', cb),
  /** 下载完成，可重启安装；返回取消订阅函数 */
  onDownloaded: (cb) => subscribe('update:downloaded', cb),
  /** 更新流程出错；返回取消订阅函数 */
  onError: (cb) => subscribe('update:error', cb)
})

// 桌面原生通知桥接：渲染进程统一走 src/services/notify.ts 调度
contextBridge.exposeInMainWorld('desktopNotify', {
  /** 是否存在桌面原生通知能力（Electron 端为 true，浏览器端 undefined） */
  available: true,
  /** 弹出系统原生通知（icon 为 data URL，缺省用默认图标） */
  show: (title, body, icon) => ipcRenderer.send('notify:show', { title, body, icon })
})

// 托盘菜单导航桥接：主进程通过 IPC 触发渲染进程页面跳转
contextBridge.exposeInMainWorld('nav', {
  /** 订阅托盘导航事件；返回取消订阅函数，组件卸载时调用以免监听器泄漏 */
  onNav: (cb) => subscribe('nav', cb)
})

// 桌面端认证令牌桥接：令牌仅存于主进程，渲染进程经 IPC 换取后自行缓存在内存中，
// 用于登录/注册等请求的 X-Desktop-Token 头（跳过人机验证），不编译进渲染进程产物
contextBridge.exposeInMainWorld('desktopAuth', {
  /** 从主进程换取桌面端认证令牌（与 Worker 共享的 DESKTOP_TOKEN；未配置时为空串） */
  getToken: () => ipcRenderer.invoke('auth:desktop-token')
})
