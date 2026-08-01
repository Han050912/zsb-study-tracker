import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  base: './',
  // sql.js 的 wasm 通过 ?url 作为静态资源加载，排除预打包避免路径问题
  optimizeDeps: {
    exclude: ['sql.js']
  },
  build: {
    chunkSizeWarningLimit: 1500
  }
})
