/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

/** 编译期常量：桌面端（Electron）构建标识，由 vite.config.ts define 注入 */
declare const __DESKTOP_BUILD__: boolean
/** 编译期常量：桌面端认证令牌，Worker 校验以跳过 Turnstile */
declare const __DESKTOP_TOKEN__: string

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

/** Electron preload 桥接（仅桌面端打包环境注入） */
interface Window {
  updater?: {
    available: boolean
    check: () => void
    download: () => void
    install: () => void
    onAvailable: (cb: (info: { version: string; releaseName: string; releaseNotes: string; releaseDate: string }) => void) => void
    onProgress: (cb: (p: { percent: number; transferred: number; total: number; bytesPerSecond: number }) => void) => void
    onDownloaded: (cb: (info: { version: string }) => void) => void
    onError: (cb: (msg: string) => void) => void
  }
  desktopNotify?: {
    available: boolean
    show: (title: string, body: string) => void
  }
  /** 托盘菜单导航桥接：主进程 IPC 触发页面跳转 */
  nav?: {
    onNav: (cb: (route: { path: string; query?: Record<string, string> }) => void) => void
  }
}
