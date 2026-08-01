<script setup lang="ts">
import { computed, onMounted, provide, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useAppStore } from './stores/app'
import Toast from './components/Toast.vue'
import AchievementModal from './components/AchievementModal.vue'
import Onboarding from './components/Onboarding.vue'

const store = useAppStore()
const route = useRoute()

const NAV = [
  { path: '/', icon: '🏠', label: '首页' },
  { path: '/math', icon: '📐', label: '高数' },
  { path: '/english', icon: '📖', label: '英语' },
  { path: '/pomodoro', icon: '🍅', label: '专注' },
  { path: '/daily-summary', icon: '📝', label: '总结' },
  { path: '/statistics', icon: '📊', label: '统计' },
  { path: '/error-book', icon: '📕', label: '错题本' },
  { path: '/habits', icon: '✅', label: '习惯' },
  { path: '/rewards', icon: '🏆', label: '成就' },
  { path: '/materials', icon: '📚', label: '资料' },
  { path: '/account', icon: '👤', label: '我的' },
  { path: '/settings', icon: '⚙️', label: '设置' }
]
// 移动端底部导航：按路径选取，避免 NAV 顺序变化导致索引错位
const mobileNav = computed(() => {
  const pick = (path: string) => NAV.find(n => n.path === path)!
  return ['/', '/math', '/english', '/pomodoro', '/daily-summary', '/settings'].map(pick)
})

// ---- Toast 全局服务 ----
const toastRef = ref<InstanceType<typeof Toast>>()
provide('toast', (msg: string) => toastRef.value?.show(msg))

// ---- 主题 ----
function applyTheme() {
  const t = store.settings.theme
  const dark = t === 'dark' || (t === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
}
onMounted(() => {
  applyTheme()
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme)
  // 每日提醒
  if (store.settings.reminderEnabled && 'Notification' in window && Notification.permission === 'granted') {
    scheduleReminder()
  }
})
function scheduleReminder() {
  const [h, m] = (store.settings.reminderTime || '08:00').split(':').map(Number)
  const nowD = new Date()
  const target = new Date()
  target.setHours(h, m, 0, 0)
  if (target.getTime() <= nowD.getTime()) target.setDate(target.getDate() + 1)
  setTimeout(() => {
    new Notification('专升本学习提醒', { body: '该开始学习啦！坚持就是胜利 💪' })
    scheduleReminder()
  }, target.getTime() - nowD.getTime())
}

const isPomodoro = computed(() => route.path === '/pomodoro')
const isAuthPage = computed(() => route.path === '/login')
const hideNav = computed(() => isPomodoro.value || isAuthPage.value)
const showOnboarding = computed(() => !isAuthPage.value && !store.settings.onboarded)
</script>

<template>
  <div class="min-h-screen">
    <!-- 桌面侧边栏 -->
    <aside v-if="!hideNav" class="hidden md:flex fixed inset-y-0 left-0 w-56 flex-col bg-white dark:bg-slate-800 border-r border-slate-100 dark:border-slate-700 z-30">
      <div class="px-5 py-5">
        <div class="text-lg font-bold text-primary-600 dark:text-primary-400">🎓 专升本助手</div>
        <div class="text-xs text-slate-400 mt-1">{{ store.settings.userName }} · {{ store.level.name }}学者</div>
      </div>
      <div v-if="store.examCountdown !== null" class="mx-4 mb-3 rounded-xl bg-gradient-to-r from-primary-500 to-primary-600 text-white px-3 py-2 text-center">
        <div class="text-[10px] opacity-80">距考试还有</div>
        <div class="text-xl font-bold leading-tight">{{ store.examCountdown }} 天</div>
      </div>
      <nav class="flex-1 overflow-y-auto px-3 space-y-1 pb-4">
        <RouterLink v-for="item in NAV" :key="item.path" :to="item.path"
          class="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors"
          :class="route.path === item.path || (item.path !== '/' && route.path.startsWith(item.path))
            ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 font-semibold'
            : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'">
          <span class="text-lg">{{ item.icon }}</span>{{ item.label }}
        </RouterLink>
      </nav>
      <div class="px-5 py-3 text-[10px] text-slate-400">积分 {{ store.gamification.points }} · 🔥{{ store.gamification.streak }}天</div>
    </aside>

    <!-- 主内容 -->
    <main :class="hideNav ? '' : 'md:pl-56 pb-20 md:pb-6'">
      <RouterView v-slot="{ Component }">
        <Transition name="fade" mode="out-in">
          <component :is="Component" />
        </Transition>
      </RouterView>
    </main>

    <!-- 移动端底部导航 -->
    <nav v-if="!hideNav" class="md:hidden fixed bottom-0 inset-x-0 bg-white dark:bg-slate-800 border-t border-slate-100 dark:border-slate-700 z-30 flex justify-around py-1.5" style="padding-bottom: env(safe-area-inset-bottom)">
      <RouterLink v-for="item in mobileNav" :key="item.path" :to="item.path"
        class="flex flex-col items-center px-2 py-1 text-[10px] rounded-lg"
        :class="route.path === item.path || (item.path !== '/' && route.path.startsWith(item.path))
          ? 'text-primary-600 dark:text-primary-400 font-semibold' : 'text-slate-500 dark:text-slate-400'">
        <span class="text-xl leading-none">{{ item.icon }}</span>{{ item.label }}
      </RouterLink>
    </nav>

    <Toast ref="toastRef" />
    <AchievementModal />
    <Onboarding v-if="showOnboarding" />
  </div>
</template>
