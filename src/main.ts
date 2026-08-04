import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { router } from './router'
import { restoreSession } from './services/auth'
import { useAppStore } from './stores/app'
import './style.css'
import 'katex/dist/katex.min.css'

async function bootstrap() {
  const app = createApp(App)
  const pinia = createPinia()
  app.use(pinia)

  // 恢复登录状态；已登录则从云端全量拉取该用户的历史数据（显式传入 pinia 实例）
  const store = useAppStore(pinia)
  const user = await restoreSession()
  if (user) {
    try {
      await store.hydrate()
    } catch (e) {
      // 拉取失败（如网络异常）则跳过，用户重新登录后会再次 hydrate
      console.warn('云端数据拉取失败', e)
    }
  }

  // 页面关闭/刷新前兜底推送防抖窗口内的未保存修改
  window.addEventListener('beforeunload', () => store.flushSave())

  app.use(router)
  app.mount('#app')
}

bootstrap().catch(e => {
  console.error('应用初始化失败', e)
  document.body.innerHTML = '<p style="padding:2rem;text-align:center;color:#888">应用初始化失败，请刷新重试</p>'
})
