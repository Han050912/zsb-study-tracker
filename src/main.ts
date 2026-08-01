import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { router } from './router'
import { initDatabase } from './db/database'
import { restoreSession } from './services/auth'
import { useAppStore } from './stores/app'
import './style.css'
import 'katex/dist/katex.min.css'

async function bootstrap() {
  // 1. 初始化 SQLite 数据库（sql.js / WASM）
  await initDatabase()

  const app = createApp(App)
  const pinia = createPinia()
  app.use(pinia)

  // 2. 恢复登录状态；已登录则预载该用户的历史数据（显式传入 pinia 实例）
  const user = await restoreSession()
  if (user) {
    // 会话恢复无密码，无法解密数据：仅在内存中已有密钥时载入；否则进入应用后按需处理
    try {
      await useAppStore(pinia).hydrate()
    } catch {
      // 无法解密（如刷新后密钥丢失）则跳过，用户重新登录后会再次 hydrate
      console.warn('会话恢复但数据无法解密，需重新登录')
    }
  }

  app.use(router)
  app.mount('#app')
}

bootstrap().catch(e => {
  console.error('应用初始化失败', e)
  document.body.innerHTML = '<p style="padding:2rem;text-align:center;color:#888">应用初始化失败，请刷新重试</p>'
})
