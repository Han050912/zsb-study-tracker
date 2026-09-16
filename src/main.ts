import { createApp, ref } from 'vue'
import { createPinia } from 'pinia'
import { registerSW } from 'virtual:pwa-register'
import App from './App.vue'
import { router } from './router'
import { restoreSession } from './services/auth'
import { useAppStore } from './stores/app'
import { APP_READY_KEY } from './composables/useAppBoot'
import './style.css'

// PWA：注册 Service Worker（autoUpdate 模式，新版本发布后台自动更新）
registerSW({ immediate: true })

async function bootstrap() {
  const app = createApp(App)
  const pinia = createPinia()
  app.use(pinia)

  // 会话恢复必须先于路由首次导航：登录守卫按 isLoggedIn 决定是否重定向到登录页，
  // 若在会话未恢复时就挂载，已登录用户会被瞬时重定向到登录页（并丢掉原路径）。
  // 未登录时 restoreSession 不发请求，因此这条 await 对大多数冷启动是同步完成的。
  const user = await restoreSession()

  // 首屏不再等待云端全量数据：挂载前 #app 由 index.html 内联骨架占位，
  // 挂载后由 App 依据 APP_READY_KEY 继续显示骨架直到补水结束——挂载路径上只剩会话恢复一次往返，
  // 弱网下既立即有加载反馈，也不会把「默认空数据」渲染成「真实空态」。
  const ready = ref(false)
  app.provide(APP_READY_KEY, ready)
  app.use(router)
  app.mount('#app')

  const store = useAppStore(pinia)
  // 页面关闭/刷新前兜底推送防抖窗口内的未保存修改
  window.addEventListener('beforeunload', () => store.flushSave())

  if (user) {
    try {
      // 已登录则从云端全量拉取该用户的历史数据（显式传入 pinia 实例）
      await store.hydrate()
    } catch (e) {
      // 拉取失败（如网络异常）则跳过，用户重新登录后会再次 hydrate
      console.warn('云端数据拉取失败', e)
    }
  }
  ready.value = true
}

bootstrap().catch((e) => console.error('应用初始化失败', e))
