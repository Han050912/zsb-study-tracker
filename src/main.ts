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
  app.use(createPinia())

  // 2. 恢复登录状态；已登录则预载该用户的历史数据
  const user = restoreSession()
  if (user) {
    useAppStore().hydrate()
  }

  app.use(router)
  app.mount('#app')
}

bootstrap().catch(e => {
  console.error('应用初始化失败', e)
  document.body.innerHTML = '<p style="padding:2rem;text-align:center;color:#888">应用初始化失败，请刷新重试</p>'
})
