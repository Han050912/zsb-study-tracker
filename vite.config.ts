import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig(({ mode }) => ({
  plugins: [
    vue(),
    // PWA：移动端可安装 + 基础离线缓存；桌面端（Electron）同样启用，无影响
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['logo.png'],
      manifest: false, // 复用 public/manifest.json（已包含完整配置），避免双份维护
      workbox: {
        // 预缓存所有构建产物 + public 静态资源
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        // 排除截图目录（仅 README 用，体积大且与运行无关）
        globIgnores: ['**/screenshots/**', '**/donate/**'],
        // 单页应用路由兜底
        navigateFallback: 'index.html',
        // 运行时缓存：仅对 API 域名做 NetworkFirst，数据以服务端为准、断网可读旧数据
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/cn\.zsbservice\.de5\.net\/api\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              expiration: { maxEntries: 64, maxAgeSeconds: 60 * 60 * 24 },
              networkTimeoutSeconds: 10
            }
          }
        ]
      }
    })
  ],
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
