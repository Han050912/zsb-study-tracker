import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'
import { writeFileSync } from 'node:fs'
import path from 'node:path'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // API 域名单一来源：.env 的 VITE_API_BASE（process.env 优先，供 CI 覆盖）
  const apiBase = process.env.VITE_API_BASE || env.VITE_API_BASE || ''
  return {
    plugins: [
      // 把 API 域名落为构建产物，供 Electron 主进程运行时读取（域名单一来源 = .env 的 VITE_API_BASE）
      {
        name: 'emit-api-base',
        closeBundle() {
          writeFileSync(path.resolve(__dirname, 'dist/api-base.json'), JSON.stringify({ apiBase }))
        }
      },
      vue(),
      // PWA：移动端可安装 + 基础离线缓存；桌面端（Electron）同样启用，无影响
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['logo.png'],
        manifest: false, // 复用 public/manifest.json（已包含完整配置），避免双份维护
        workbox: {
          // 预缓存 app shell（index js/css、小路由 chunk、图标）+ 笔记正文渲染器 + public 静态资源。
          // 策略（2026-09-15 决定）：核心阅读路径必须预缓存——离线读笔记/公式是学习类 PWA 的核心价值，
          // 且笔记正文存 IndexedDB 不过期，若渲染器按需缓存（30 天过期）会出现「正文读得到、渲染不了」的错配
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
          globIgnores: [
            // 截图/捐赠目录：仅 README 用，体积大且与运行无关
            '**/screenshots/**',
            '**/donate/**',
            // 懒加载大件不预缓存（首装省 ~670KB 传输，gzip 口径）：统计图表/PDF 阅读器/分享图/KaTeX 字体
            // 均为「非首次必用」重件，首次使用后经 runtimeCaching 离线可用
            'assets/echarts-*.js',
            'assets/pdf-*.js',
            'assets/html2canvas*.js',
            'assets/KaTeX_*'
          ],
          // 单页应用路由兜底
          navigateFallback: 'index.html',
          runtimeCaching: [
            {
              // /api/* 一律不缓存：这些响应全按账号隔离（/api/auth/me、通知、私信、成长主页、待办、设置……），
              // 一旦进 SW 缓存，同一设备换账号或网络慢时会把上一账号的数据展示给下一个用户（跨账号串数据）。
              // NetworkOnly 让请求直连网络，离线时直接失败——离线可用性由「预缓存的 app shell + IndexedDB 中的
              // 笔记正文」保证，不依赖 API 缓存。
              // 域名点号需转义；apiBase 为空时正则退化为 /^\/api\/.*/i（本地 dev 无 API 域名，可接受）
              urlPattern: new RegExp(`^${apiBase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/api/.*`, 'i'),
              handler: 'NetworkOnly'
            },
            {
              // 同源静态资源按需缓存：不预缓存的懒加载大件（echarts/pdf/html2canvas）与 KaTeX 字体
              // 首次使用后离线可用；同时覆盖 pdf.worker.mjs——旧 globPatterns 不含 .mjs，
              // 该文件此前从未被任何规则缓存，PDF 离线阅读实际不可用
              urlPattern: /\/assets\/.+\.(?:js|mjs|css|woff2?|ttf)$/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'static-assets-runtime',
                // chunk 带内容 hash，跨版本靠条目上限清理旧文件
                expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 30 }
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
      // 桌面端认证令牌：优先取 CI 环境变量 DESKTOP_TOKEN，其次读 .env.desktop.local（已 gitignore）；
      // 与 Worker env.DESKTOP_TOKEN 保持一致，不写死源码；都未配置时桌面端回退人机验证（fail-closed）
      __DESKTOP_TOKEN__: JSON.stringify(mode === 'desktop' ? process.env.DESKTOP_TOKEN || env.DESKTOP_TOKEN || '' : '')
    },
    build: {
      chunkSizeWarningLimit: 1500
    }
  }
})
