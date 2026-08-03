/// <reference types="vite/client" />

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
  maimemoAPI?: {
    available: boolean
    fetch: (token: string) => Promise<{ newWords: number; reviewWords: number; finished: number; total: number }>
  }
}
