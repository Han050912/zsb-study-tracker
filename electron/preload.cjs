/**
 * 预加载脚本：以 contextBridge 安全桥接自动更新能力到渲染进程
 * 渲染进程通过 window.updater 调用，全程不暴露 nodeIntegration
 */
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('updater', {
  /** 是否有更新能力（仅打包后的桌面端存在） */
  available: true,
  /** 手动检查更新 */
  check: () => ipcRenderer.send('update:check'),
  /** 开始下载更新包 */
  download: () => ipcRenderer.send('update:download'),
  /** 退出并安装更新 */
  install: () => ipcRenderer.send('update:install'),
  /** 发现新版本（携带版本号/发布说明/发布日期） */
  onAvailable: (cb) => ipcRenderer.on('update:available', (_e, info) => cb(info)),
  /** 下载进度（percent/transferred/total/bytesPerSecond） */
  onProgress: (cb) => ipcRenderer.on('update:progress', (_e, p) => cb(p)),
  /** 下载完成，可重启安装 */
  onDownloaded: (cb) => ipcRenderer.on('update:downloaded', (_e, info) => cb(info)),
  /** 更新流程出错 */
  onError: (cb) => ipcRenderer.on('update:error', (_e, msg) => cb(msg))
})

// 桌面原生通知桥接：渲染进程统一走 src/services/notify.ts 调度
contextBridge.exposeInMainWorld('desktopNotify', {
  /** 是否存在桌面原生通知能力（Electron 端为 true，浏览器端 undefined） */
  available: true,
  /** 弹出系统原生通知 */
  show: (title, body) => ipcRenderer.send('notify:show', { title, body })
})

// 托盘菜单导航桥接：主进程通过 IPC 触发渲染进程页面跳转
contextBridge.exposeInMainWorld('nav', {
  onNav: (cb) => ipcRenderer.on('nav', (_e, route) => cb(route))
})
