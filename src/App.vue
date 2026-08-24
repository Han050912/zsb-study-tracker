<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAppStore } from './stores/app'
import { useCommunityStore } from './stores/community'
import { sessionUser, logout, isLoggedIn, isAdmin, goLogin } from './services/auth'
import { restartReminder } from './services/reminder'
import { startTodoReminder, checkTodoReminders } from './services/todoReminder'
import Toast from './components/Toast.vue'
import AchievementModal from './components/AchievementModal.vue'
import Onboarding from './components/Onboarding.vue'
import UpdateDialog from './components/UpdateDialog.vue'
import { imageUrl, communityApi } from './api/community'
import { isDndActive } from './utils/dnd'

const store = useAppStore()
const community = useCommunityStore()
const route = useRoute()
const router = useRouter()

// 登录后定时拉取社区未读通知数 + 消息未读数（实时红点）；切后台暂停、回前台立即补拉；退出/过期时停止轮询
let unreadTimer: ReturnType<typeof setInterval> | null = null
/** 消息未读数（私信模块独立，不与通知未读混算） */
const messageUnread = ref(0)
function fetchUnread() {
  community.fetchUnreadCount().catch(() => {})
  communityApi.messageUnreadCount().then(r => { messageUnread.value = r.count }).catch(() => {})
}
function startUnreadTimer() {
  if (unreadTimer) clearInterval(unreadTimer)
  unreadTimer = setInterval(fetchUnread, 30000)
}
function stopUnreadTimer() {
  if (unreadTimer) { clearInterval(unreadTimer); unreadTimer = null }
}
function onUnreadVisibilityChange() {
  if (document.visibilityState === 'visible') {
    fetchUnread()
    if (isLoggedIn.value) startUnreadTimer()
  } else {
    stopUnreadTimer()
  }
}
function startUnreadPolling() {
  stopUnreadPolling()
  fetchUnread()
  startUnreadTimer()
  document.addEventListener('visibilitychange', onUnreadVisibilityChange)
}
function stopUnreadPolling() {
  stopUnreadTimer()
  document.removeEventListener('visibilitychange', onUnreadVisibilityChange)
}
watch(isLoggedIn, v => { if (v) startUnreadPolling(); else stopUnreadPolling() }, { immediate: true })
onBeforeUnmount(stopUnreadPolling)

// 导航动态生成：科目项随科目列表实时增减（删除科目自动隐藏，新增科目自动出现）
// 侧边栏展示科目全名；移动端由 CSS truncate 截断
const NAV = computed(() => {
  // 访客态：社区 + 组队（公开小组列表可浏览；其余为个人学习功能，需登录）
  if (!isLoggedIn.value) {
    return [
      { path: '/community', icon: '💬', label: '社区', subject: false },
      { path: '/teams', icon: '👥', label: '组队', subject: false }
    ]
  }
  const subjectItems = store.subjects.map(s => ({
    path: s.id === 'math' ? '/math' : s.id === 'english' ? '/english' : `/subject/${s.id}`,
    icon: s.icon,
    label: s.name,
    subject: true
  }))
  return [
    { path: '/', icon: '🏠', label: '首页', subject: false },
    { path: '/community', icon: '💬', label: '社区', subject: false },
    { path: '/teams', icon: '👥', label: '组队', subject: false },
    ...subjectItems,
    { path: '/pomodoro', icon: '🍅', label: '专注', subject: false },
    { path: '/notes', icon: '📔', label: '笔记', subject: false },
    { path: '/daily-summary', icon: '📝', label: '总结', subject: false },
    { path: '/statistics', icon: '📊', label: '统计', subject: false },
    { path: '/error-book', icon: '📕', label: '错题本', subject: false },
    { path: '/habits', icon: '✅', label: '习惯', subject: false },
    { path: '/rewards', icon: '🏆', label: '成就', subject: false },
    { path: '/materials', icon: '📚', label: '资料', subject: false },
    { path: '/settings', icon: '⚙️', label: '设置', subject: false },
    // 管理员专属：审核中心（举报队列）
    ...(isAdmin.value ? [{ path: '/admin', icon: '🛡️', label: '审核', subject: false }] : [])
  ]
})
// 移动端底部导航：首页 + 第一个科目 + 社区/专注/总结/设置（最多 6 项，超出时减少科目位，避免挤压截断）
const mobileNav = computed(() => {
  // 访客态：社区 + 组队 + 登录（登录是移动端主要转化入口，携带回跳地址）
  if (!isLoggedIn.value) {
    return [
      { path: '/community', icon: '💬', label: '社区', subject: false },
      { path: '/teams', icon: '👥', label: '组队', subject: false },
      { path: `/login?redirect=${encodeURIComponent(route.path || '/community')}`, label: '登录', subject: false }
    ]
  }
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

// 401 登录过期：清空会话与内存中的用户数据，防止串号到下一个登录的账号
// （logout 置空 currentUser → isLoggedIn 变 false → 触发未读轮询停止）
window.addEventListener('auth:expired', () => { logout(); store.resetState(); community.resetState() })

// ---- 每日学习提醒（浏览器 + 桌面端共用 src/services/reminder.ts 一套逻辑） ----
// 监听设置变更即时重调度：开关切换、时间修改均无需重启应用即可生效
watch(
  () => [store.settings.reminderEnabled, store.settings.reminderTime] as const,
  () => {
    restartReminder(
      () => ({ enabled: store.settings.reminderEnabled, time: store.settings.reminderTime, suppressed: isDndActive(store.settings) }),
      (shown) => { if (!shown) toastRef.value?.show('提醒时间到！该开始学习啦') }
    )
  },
  { immediate: true }
)

// ---- 待办开始 / 最晚截止提醒（见 src/services/todoReminder.ts）----
// 应用运行期间后台轮询，到点弹系统通知；桌面端最小化到托盘后仍可收到
onMounted(() => {
  startTodoReminder({
    getTodos: () => store.todos,
    onNotified: (ids, kind) => store.markTodosNotified(ids, kind),
    onFallback: msg => toastRef.value?.show(msg),
    isSuppressed: () => isDndActive(store.settings)
  })
})
// 云端数据到位、新增待办或改动时间后立即检查一次，无需等下一轮轮询
watch(
  () => store.todos.map(t => `${t.id}:${t.startAt ?? ''}:${t.dueAt ?? ''}:${t.done ? 1 : 0}`).join('|'),
  () => checkTodoReminders()
)

const dndActive = computed(() => isDndActive(store.settings))

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
// 侧边栏宽度状态注入给子页面（如帖子详情底部回复框），使其与主内容区同一列对齐
provide('navCollapsed', navCollapsed)

// ---- 右上角账号头像下拉菜单 ----
const avatarOpen = ref(false)
const avatarLetter = computed(() => sessionUser.value?.username?.slice(0, 1).toUpperCase() || '👤')
function goAccount() {
  avatarOpen.value = false
  router.push('/account')
}
function goFeedback() {
  avatarOpen.value = false
  router.push('/feedback')
}
function goNotifications() {
  avatarOpen.value = false
  router.push('/community/notifications')
}
function goMessages() {
  avatarOpen.value = false
  router.push('/messages')
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
  // 退出后回登录页；访客浏览模式仅能由登录页「先随便看看」入口进入
  router.replace('/login')
}

/** 导航激活判断：精确匹配或子路径匹配（避免 '/materials' 误激活 '/math' 这类前缀碰撞） */
function isNavActive(path: string) {
  if (path === '/') return route.path === '/'
  return route.path === path || route.path.startsWith(path + '/')
}
const hideNav = computed(() => isPomodoro.value || isAuthPage.value)
const showOnboarding = computed(() => isLoggedIn.value && !isAuthPage.value && !store.settings.onboarded)

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
        <div v-if="!navCollapsed" class="text-xs text-slate-400 mt-1">{{ isLoggedIn ? `${store.settings.userName} · ${store.level.name}学者` : '访客浏览中' }}</div>
      </div>
      <div v-if="isLoggedIn && store.examCountdown !== null && !navCollapsed" class="mx-4 mb-3 rounded-xl bg-gradient-to-r from-primary-500 to-primary-600 text-white px-3 py-2 text-center">
        <template v-if="store.examCountdown > 0">
          <div class="text-[10px] opacity-80">距考试还有</div>
          <div class="text-xl font-bold leading-tight">{{ store.examCountdown }} 天</div>
        </template>
        <div v-else class="text-sm font-bold leading-tight py-1">考试就是今天，加油！</div>
      </div>
      <button v-else-if="!isLoggedIn && !navCollapsed" class="mx-4 mb-3 rounded-xl bg-gradient-to-r from-primary-500 to-primary-600 text-white px-3 py-2.5 text-center hover:opacity-90 transition-opacity"
        @click="goLogin(router)">
        <div class="text-sm font-bold">登录</div>
        <div class="text-[10px] opacity-80 mt-0.5">解锁全部学习功能</div>
      </button>
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
      <div v-if="isLoggedIn && !navCollapsed" class="mx-3 mb-3 grid grid-cols-2 gap-2">
        <div class="rounded-xl bg-amber-50 dark:bg-amber-500/10 px-3 py-2 flex flex-col items-center justify-center text-center">
          <div class="text-[15px] font-bold leading-none text-amber-600 dark:text-amber-400">{{ store.gamification.points }}</div>
          <div class="text-[10px] text-slate-400 mt-0.5">积分</div>
        </div>
        <div class="rounded-xl bg-purple-50 dark:bg-purple-500/10 px-3 py-2 flex flex-col items-center justify-center text-center">
          <div class="text-[15px] font-bold leading-none text-purple-600 dark:text-purple-400">{{ store.gamification.streak }}</div>
          <div class="text-[10px] text-slate-400 mt-0.5">连续学习天数</div>
        </div>
      </div>
    </aside>

    <!-- 右上角：登录态显示账号头像入口（含未读通知角标，通知中心已并入头像下拉菜单）；访客态显示登录按钮 -->
    <div v-if="!hideNav && !isNotesEditing" class="fixed top-3 right-4 z-40 flex items-center gap-3">
      <template v-if="isLoggedIn">
        <button class="relative z-50 w-9 h-9 rounded-full bg-gradient-to-br from-primary-500 to-indigo-600 text-white text-sm font-bold flex items-center justify-center shadow-md hover:shadow-lg transition-shadow"
          title="账号菜单" @click.stop="avatarOpen = !avatarOpen">
          <img v-if="store.settings.avatar" :src="imageUrl(store.settings.avatar)" class="w-full h-full object-cover rounded-full" alt="我的头像">
          <template v-else>{{ avatarLetter }}</template>
          <!-- 未读角标（通知未读 + 消息未读）：勿扰仅红点（无数字）；普通数字角标 -->
          <span v-if="dndActive && (community.unreadExcludingMuted || (messageUnread && !store.settings.dndMuteMessage))"
            class="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-rose-500 ring-2 ring-white dark:ring-slate-800"></span>
          <span v-else-if="!dndActive && (community.unreadCount + messageUnread)"
            class="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-white text-[9px] font-bold flex items-center justify-center ring-2 ring-white dark:ring-slate-800">
            {{ (community.unreadCount + messageUnread) > 99 ? '99+' : (community.unreadCount + messageUnread) }}
          </span>
        </button>
        <div v-if="avatarOpen" class="fixed inset-0 z-40" @click="avatarOpen = false"></div>
        <div v-if="avatarOpen" class="absolute right-0 top-11 z-50 w-40 rounded-xl bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 shadow-lg py-1.5">
          <button class="w-full flex items-center justify-between px-4 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700" @click="goMessages">
            <span>消息</span>
            <span v-if="messageUnread" class="min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-white text-[9px] font-bold flex items-center justify-center">{{ messageUnread > 99 ? '99+' : messageUnread }}</span>
          </button>
          <button class="w-full flex items-center justify-between px-4 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700" @click="goNotifications">
            <span>通知中心</span>
            <span v-if="community.unreadCount" class="min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-white text-[9px] font-bold flex items-center justify-center">{{ community.unreadCount > 99 ? '99+' : community.unreadCount }}</span>
          </button>
          <button class="w-full text-left px-4 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700" @click="goFeedback">意见反馈</button>
          <button class="w-full text-left px-4 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700" @click="goAccount">个人中心</button>
          <button class="w-full text-left px-4 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700" @click="accountLogout(true)">切换账号</button>
          <button class="w-full text-left px-4 py-2 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20" @click="accountLogout(false)">退出登录</button>
        </div>
      </template>
      <button v-else class="px-4 py-2 rounded-full bg-primary-500 text-white text-sm font-semibold shadow-md hover:bg-primary-600 hover:shadow-lg transition-colors"
        @click="goLogin(router)">登录</button>
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
