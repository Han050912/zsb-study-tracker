<script setup lang="ts">
import { computed, onMounted, provide, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAppStore } from './stores/app'
import { useCommunityStore } from './stores/community'
import { sessionUser, logout, isLoggedIn } from './services/auth'
import { restartReminder } from './services/reminder'
import Toast from './components/Toast.vue'
import AchievementModal from './components/AchievementModal.vue'
import Onboarding from './components/Onboarding.vue'
import UpdateDialog from './components/UpdateDialog.vue'

const store = useAppStore()
const community = useCommunityStore()
const route = useRoute()
const router = useRouter()

// 登录后拉取社区未读通知数；退出/过期时清空社区数据避免串号
watch(isLoggedIn, v => { if (v) community.fetchUnreadCount().catch(() => {}) }, { immediate: true })

// 导航动态生成：科目项随科目列表实时增减（删除科目自动隐藏，新增科目自动出现）
// 侧边栏展示科目全名；移动端由 CSS truncate 截断
const NAV = computed(() => {
  const subjectItems = store.subjects.map(s => ({
    path: s.id === 'math' ? '/math' : s.id === 'english' ? '/english' : `/subject/${s.id}`,
    icon: s.icon,
    label: s.name,
    subject: true
  }))
  return [
    { path: '/', icon: '🏠', label: '首页', subject: false },
    { path: '/community', icon: '💬', label: '社区', subject: false },
    ...subjectItems,
    { path: '/pomodoro', icon: '🍅', label: '专注', subject: false },
    { path: '/notes', icon: '📔', label: '笔记', subject: false },
    { path: '/daily-summary', icon: '📝', label: '总结', subject: false },
    { path: '/statistics', icon: '📊', label: '统计', subject: false },
    { path: '/error-book', icon: '📕', label: '错题本', subject: false },
    { path: '/habits', icon: '✅', label: '习惯', subject: false },
    { path: '/rewards', icon: '🏆', label: '成就', subject: false },
    { path: '/materials', icon: '📚', label: '资料', subject: false },
    { path: '/settings', icon: '⚙️', label: '设置', subject: false }
  ]
})
// 移动端底部导航：首页 + 第一个科目 + 社区/专注/总结/设置（最多 6 项，超出时减少科目位，避免挤压截断）
const mobileNav = computed(() => {
  const subjectPaths = NAV.value.filter(n => n.subject).slice(0, 1).map(n => n.path)
  const picks = ['/', ...subjectPaths, '/community', '/pomodoro', '/daily-summary', '/settings']
  return picks
    .map(p => NAV.value.find(n => n.path === p))
    .filter((n): n is NonNullable<typeof n> => !!n)
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
})

// 401 登录过期：清空内存中的用户数据，防止串号到下一个登录的账号
window.addEventListener('auth:expired', () => { store.resetState(); community.resetState() })

// ---- 每日学习提醒（浏览器 + 桌面端共用 src/services/reminder.ts 一套逻辑） ----
// 监听设置变更即时重调度：开关切换、时间修改均无需重启应用即可生效
watch(
  () => [store.settings.reminderEnabled, store.settings.reminderTime] as const,
  () => {
    restartReminder(
      () => ({ enabled: store.settings.reminderEnabled, time: store.settings.reminderTime }),
      (shown) => { if (!shown) toastRef.value?.show('提醒时间到！该开始学习啦 💪') }
    )
  },
  { immediate: true }
)

const isPomodoro = computed(() => route.path === '/pomodoro')
const isAuthPage = computed(() => route.path === '/login')
// 笔记页打开具体笔记时隐藏右上角头像浮层，把顶部右侧让给编辑工具栏
const isNotesEditing = computed(() =>
  route.path === '/notes' && (!!route.query.id || route.query.new === '1')
)

// ---- 侧边栏折叠 / 展开（状态持久化，刷新后保持） ----
const NAV_COLLAPSED_KEY = 'zsb-nav-collapsed'
const navCollapsed = ref(localStorage.getItem(NAV_COLLAPSED_KEY) === '1')
function toggleNav() {
  navCollapsed.value = !navCollapsed.value
  localStorage.setItem(NAV_COLLAPSED_KEY, navCollapsed.value ? '1' : '0')
}

// ---- 右上角账号头像下拉菜单 ----
const avatarOpen = ref(false)
const avatarLetter = computed(() => sessionUser.value?.username?.slice(0, 1).toUpperCase() || '👤')
function goAccount() {
  avatarOpen.value = false
  router.push('/account')
}
/** 切换账号 / 退出登录：立即退出，数据保存不阻塞 UI */
async function accountLogout(switchAccount: boolean) {
  avatarOpen.value = false
  const tip = switchAccount ? '切换账号？当前数据将被保存。' : '确认退出登录？数据将被保存到云端。'
  if (!window.confirm(tip)) return

  // ① 清空待推送的防抖定时器，用 beacon 异步发送（不阻塞）
  store.flushSave()
  // ② 再发起一次完整的 fetch 保存（不阻塞退出流程，静默失败）
  store.saveAsync().catch(() => {})

  // ③ 立即清理会话状态并跳转登录页
  logout()
  store.resetState()
  community.resetState()
  router.replace('/login')
}

/** 导航激活判断：精确匹配或子路径匹配（避免 '/materials' 误激活 '/math' 这类前缀碰撞） */
function isNavActive(path: string) {
  if (path === '/') return route.path === '/'
  return route.path === path || route.path.startsWith(path + '/')
}
const hideNav = computed(() => isPomodoro.value || isAuthPage.value)
const showOnboarding = computed(() => !isAuthPage.value && !store.settings.onboarded)

// Electron IPC: 托盘菜单触发页面导航
if (window.nav) {
  window.nav.onNav((route) => router.push(route))
}
</script>

<template>
  <div class="min-h-screen">
    <!-- 桌面侧边栏（支持折叠/展开） -->
    <aside v-if="!hideNav" class="hidden md:flex fixed inset-y-0 left-0 flex-col bg-white dark:bg-slate-800 border-r border-slate-100 dark:border-slate-700 z-30 transition-all duration-200"
      :class="navCollapsed ? 'w-16' : 'w-56'">
      <div class="px-5 py-5" :class="navCollapsed ? '!px-3' : ''">
        <div class="flex items-center gap-2 text-lg font-bold text-primary-600 dark:text-primary-400" :class="navCollapsed ? 'justify-center' : ''">
          <img :src="'./logo.png'" alt="Logo" class="w-8 h-8 shrink-0" /><span v-if="!navCollapsed">专升本助手</span>
        </div>
        <div v-if="!navCollapsed" class="text-xs text-slate-400 mt-1">{{ store.settings.userName }} · {{ store.level.name }}学者</div>
      </div>
      <div v-if="store.examCountdown !== null && !navCollapsed" class="mx-4 mb-3 rounded-xl bg-gradient-to-r from-primary-500 to-primary-600 text-white px-3 py-2 text-center">
        <template v-if="store.examCountdown > 0">
          <div class="text-[10px] opacity-80">距考试还有</div>
          <div class="text-xl font-bold leading-tight">{{ store.examCountdown }} 天</div>
        </template>
        <div v-else class="text-sm font-bold leading-tight py-1">考试就是今天，加油！💪</div>
      </div>
      <nav class="flex-1 overflow-y-auto px-3 space-y-1 pb-4" :class="navCollapsed ? '!px-2' : ''">
        <RouterLink v-for="item in NAV" :key="item.path" :to="item.path"
          class="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors"
          :class="[isNavActive(item.path)
            ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 font-semibold'
            : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700',
            navCollapsed ? 'justify-center !px-2' : '']"
          :title="navCollapsed ? item.label : ''">
          <span class="text-lg">{{ item.icon }}</span><span v-if="!navCollapsed">{{ item.label }}</span>
        </RouterLink>
      </nav>
      <button class="mx-3 mb-2 flex items-center gap-2 rounded-xl px-3 py-2 text-xs text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
        :class="navCollapsed ? 'justify-center !px-2' : ''"
        :title="navCollapsed ? '展开导航' : '收起导航'" @click="toggleNav">
        <span>{{ navCollapsed ? '»' : '«' }}</span><span v-if="!navCollapsed">收起导航</span>
      </button>
      <div v-if="!navCollapsed" class="px-5 py-3 text-[10px] text-slate-400">积分 {{ store.gamification.points }} · 🔥{{ store.gamification.streak }}天</div>
    </aside>

    <!-- 右上角通知铃铛 + 账号头像入口（个人中心 / 切换账号 / 退出登录）；笔记编辑态隐藏 -->
    <div v-if="!hideNav && !isNotesEditing" class="fixed top-3 right-4 z-40 flex items-center gap-2">
      <button class="relative w-9 h-9 rounded-full bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 text-base flex items-center justify-center shadow-md hover:shadow-lg transition-shadow"
        title="通知中心" @click="router.push('/community/notifications')">
        🔔
        <span v-if="community.unreadCount"
          class="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-white text-[9px] font-bold flex items-center justify-center">
          {{ community.unreadCount > 99 ? '99+' : community.unreadCount }}
        </span>
      </button>
      <button class="relative z-50 w-9 h-9 rounded-full bg-gradient-to-br from-primary-500 to-indigo-600 text-white text-sm font-bold flex items-center justify-center shadow-md hover:shadow-lg transition-shadow"
        title="账号菜单" @click.stop="avatarOpen = !avatarOpen">
        {{ avatarLetter }}
      </button>
      <!-- 点击遮罩关闭下拉 -->
      <div v-if="avatarOpen" class="fixed inset-0 z-40" @click="avatarOpen = false"></div>
      <div v-if="avatarOpen" class="absolute right-0 top-11 z-50 w-40 rounded-xl bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 shadow-lg py-1.5">
        <button class="w-full text-left px-4 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700" @click="goAccount">👤 个人中心</button>
        <button class="w-full text-left px-4 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700" @click="accountLogout(true)">🔁 切换账号</button>
        <button class="w-full text-left px-4 py-2 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20" @click="accountLogout(false)">🚪 退出登录</button>
      </div>
    </div>

    <!-- 主内容（非全屏页顶部预留头像入口空间，避免遮挡页面标题栏右侧操作区；笔记编辑态不预留，工具栏置顶） -->
    <main :class="hideNav ? '' : (navCollapsed ? 'md:pl-16' : 'md:pl-56') + ' pb-20 md:pb-6' + (isNotesEditing ? '' : ' pt-14')">
      <RouterView v-slot="{ Component }">
        <Transition name="fade">
          <component :is="Component" />
        </Transition>
      </RouterView>
    </main>

    <!-- 移动端底部导航 -->
    <nav v-if="!hideNav" class="md:hidden fixed bottom-0 inset-x-0 bg-white dark:bg-slate-800 border-t border-slate-100 dark:border-slate-700 z-30 flex justify-around py-1.5" style="padding-bottom: env(safe-area-inset-bottom)">
      <RouterLink v-for="item in mobileNav" :key="item.path" :to="item.path"
        class="flex flex-col items-center px-2 py-1 text-[10px] rounded-lg max-w-[64px]"
        :class="isNavActive(item.path)
          ? 'text-primary-600 dark:text-primary-400 font-semibold' : 'text-slate-500 dark:text-slate-400'">
        <span class="text-xl leading-none">{{ item.icon }}</span>
        <span class="truncate w-full text-center">{{ item.label }}</span>
      </RouterLink>
    </nav>

    <Toast ref="toastRef" />
    <AchievementModal />
    <Onboarding v-if="showOnboarding" />
    <!-- 桌面端自动更新弹窗（Web 端无 window.updater，自动隐藏） -->
    <UpdateDialog />
  </div>
</template>
