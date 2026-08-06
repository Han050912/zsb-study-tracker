import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig(({ mode }) => ({
  plugins: [vue()],
  base: './',
  // 编译期常量：桌面端（Electron）构建标识。
  // --mode desktop 时为 true，Login.vue 中的 Turnstile 组件分支被整体 tree-shake，不进入桌面产物
  define: {
    __DESKTOP_BUILD__: JSON.stringify(mode === 'desktop'),
    // 桌面端认证令牌：编译进桌面产物，前端请求带此头，Worker 校验以跳过 Turnstile
    __DESKTOP_TOKEN__: JSON.stringify(mode === 'desktop' ? 'zsb-desktop-v2' : '')
  },
  build: {
    chunkSizeWarningLimit: 1500
  }
}))
