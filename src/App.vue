<script setup lang="ts">
import { usePartnerStore } from './features/collaboration/stores/partners'
import { useSquadStore } from './features/collaboration/stores/squads'
import { useStudyTimerStore } from './stores/studyTimer'
import { computed, defineAsyncComponent, onMounted, onUnmounted, provide, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAppStore } from './stores/app'
import { useCommunityFeedStore, usePostStore, useNotificationStore } from './stores/community'
import { sessionUser, logout, isLoggedIn, goLogin } from './services/auth'
import Toast from './components/Toast.vue'
import Onboarding from './components/Onboarding.vue'
import UpdateDialog from './components/UpdateDialog.vue'
import ConfirmDialog from './components/ConfirmDialog.vue'
import NavIcon from './components/NavIcon.vue'
import Modal from './components/Modal.vue'
import { ChevronLeft, ChevronRight, GraduationCap, MessageSquare, Timer } from '@lucide/vue'
import { imageUrl } from './api/community'
import { isDndActive } from './utils/dnd'
import { TOAST_KEY } from './composables/useToast'
import { useConfirmProvider } from './composables/useConfirm'
import { useUnreadPolling } from './composables/useUnreadPolling'
import { useReminders } from './composables/useReminders'
import { useNavigation, type NavigationGroup } from './composables/useNavigation'
import { useAppReady, bootError, bootRetrying, retryBoot } from './composables/useAppBoot'
import { routeLoading, routeLoadError } from './router/loading'
import { syncIssue } from './stores/app/sync'
import { hasVolatileOutboxChanges } from './services/syncOutbox'

// 成就分享弹窗按需异步加载：切断入口对 markdown-it/katex 依赖链（AchievementModal → PostComposer → utils/markdown）的静态引用
const AchievementModal = defineAsyncComponent(() => import('./components/AchievementModal.vue'))

const store = useAppStore()
const community = useNotificationStore()
const route = useRoute()
const router = useRouter()

// ---- Toast 全局服务 ----
const toastRef = ref<InstanceType<typeof Toast>>()
const showToast = (msg: string) => toastRef.value?.show(msg)
provide(TOAST_KEY, showToast)

// ---- 全局确认弹窗（替代原生 confirm；App 自身亦直接使用 confirmFn） ----
const { confirmState, confirmFn, resolveConfirm } = useConfirmProvider()

// ---- 未读轮询（登录后拉取社区/消息未读数；见 composables/useUnreadPolling.ts） ----
const { messageUnread } = useUnreadPolling()
// ---- 提醒调度（每日提醒 + 待办提醒 + 搭子提醒；见 composables/useReminders.ts） ----
// 本组件的 inject 只会读取祖先，提醒兜底显式使用本组件提供的 Toast。
useReminders(showToast)
// ---- 导航（动态生成 + 激活判断 + 折叠持久化；见 composables/useNavigation.ts） ----
const { navGroups, currentGroup, isNavActive, navCollapsed, toggleNav } = useNavigation()
const mobileMenu = ref<NavigationGroup | null>(null)
const mobileMenuGroup = computed(() => navGroups.value.find((group) => group.key === mobileMenu.value))
const navigationTitle = computed(
  () => navGroups.value.find((group) => group.key === currentGroup.value)?.label || '专升本助手'
)
watch(
  () => route.fullPath,
  () => {
    mobileMenu.value = null
    avatarOpen.value = false
  }
)

// ---- 首屏补水门控（main.ts 把云端数据拉取移出挂载路径；未就绪前只渲染骨架） ----
const ready = useAppReady()
function reloadPage() {
  window.location.reload()
}
const offline = ref(!navigator.onLine)
const retryingSync = ref(false)
function updateNetwork() {
  offline.value = !navigator.onLine
}
window.addEventListener('online', updateNetwork)
window.addEventListener('offline', updateNetwork)
onUnmounted(() => {
  window.removeEventListener('online', updateNetwork)
  window.removeEventListener('offline', updateNetwork)
})
async function retrySync() {
  if (retryingSync.value) return
  retryingSync.value = true
  try {
    const result = await store.syncNow()
    toastRef.value?.show(result.ok ? '数据已同步' : syncIssue.value || '同步失败，请检查网络后重试')
  } finally {
    retryingSync.value = false
  }
}

// ---- 主题 ----
function applyTheme() {
  const t = store.settings.theme
  const dark = t === 'dark' || (t === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
}
// 主题在补水完成后才随 settings.theme 从云端就位，且 index.html 会先按 prefers-color-scheme 预置 dark 类，
// 因此必须 watch 而不是只在 onMounted 应用一次（immediate 负责用用户显式选择的主题纠正预置值）
watch(() => store.settings.theme, applyTheme, { immediate: true })
// 系统主题跟随：保存 MediaQueryList 引用，卸载时成对移除 change 监听
let darkSchemeMql: MediaQueryList | null = null
onMounted(() => {
  darkSchemeMql = window.matchMedia('(prefers-color-scheme: dark)')
  darkSchemeMql.addEventListener('change', applyTheme)
})

// 401 登录过期：清空会话与内存中的用户数据，防止串号到下一个登录的账号
// （logout 置空 currentUser → isLoggedIn 变 false → 触发未读轮询停止）
// 命名函数：App 卸载时需按同一引用成对移除
function onAuthExpired() {
  store.resetState()
  usePartnerStore().resetState()
  useSquadStore().resetState()
  useStudyTimerStore().finishSession()
  community.resetState()
  useCommunityFeedStore().resetState()
  usePostStore().resetState()
}
window.addEventListener('auth:expired', onAuthExpired)

const dndActive = computed(() => isDndActive(store.settings))

// 全屏沉浸页：番茄钟 + 开黑自习室（进入后隐藏全局导航，实现真正全屏）
const isFullscreenPage = computed(() => route.meta.layout === 'immersive')
const isAuthPage = computed(() => route.meta.layout === 'auth')
// 笔记页打开具体笔记时隐藏右上角头像浮层，把顶部右侧让给编辑工具栏
const hideNav = computed(() => isFullscreenPage.value || isAuthPage.value)
const showOnboarding = computed(() => isLoggedIn.value && !isAuthPage.value && !store.settings.onboarded)

// ---- 右上角账号头像下拉菜单 ----
// 不复用 useOverlayDismiss：其完整模式（body 滚动锁定 + Tab 焦点陷阱 + 打开时强制移焦）
// 面向遮罩式弹窗，对轻量下拉菜单过重；这里仅补 ESC 关闭 + aria + 关闭时归还焦点，
// 「点击外部关闭」沿用既有的透明遮罩层行为。
const avatarOpen = ref(false)
function focusMainContent() {
  document.getElementById('main-content')?.focus()
}
const avatarBtn = ref<HTMLButtonElement | null>(null)
/** ESC 关闭菜单并把焦点还给触发按钮（仅菜单打开时响应） */
function onAvatarMenuKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && avatarOpen.value) {
    e.preventDefault()
    avatarOpen.value = false
    avatarBtn.value?.focus()
  }
}
onMounted(() => window.addEventListener('keydown', onAvatarMenuKeydown))
onUnmounted(() => window.removeEventListener('keydown', onAvatarMenuKeydown))
const avatarLetter = computed(() => sessionUser.value?.username?.slice(0, 1).toUpperCase() || '')
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
/** 切换账号 / 退出登录：等待数据保存完成后退出（保存失败的变更保留在按账号分桶的 outbox 中，重登自动续传） */
async function accountLogout(switchAccount: boolean) {
  avatarOpen.value = false
  const tip = switchAccount ? '切换账号？当前数据将被保存。' : '确认退出登录？数据将被保存到云端。'
  if (!(await confirmFn(tip))) return

  // ① 阻塞推送全部待保存变更（含笔记正文）：resetState 会清 outbox，必须先等推送完成
  await store.saveAsync()
  if (hasVolatileOutboxChanges()) {
    toastRef.value?.show('部分修改尚未写入本地或云端，请保持当前账号并重试同步后再退出。')
    return
  }

  // ② 清理会话状态并跳转登录页
  logout()
  store.resetState()
  usePartnerStore().resetState()
  useSquadStore().resetState()
  useStudyTimerStore().finishSession()
  community.resetState()
  useCommunityFeedStore().resetState()
  usePostStore().resetState()
  // 退出后回登录页；访客浏览模式仅能由登录页「先随便看看」入口进入
  router.replace('/login')
}

// Electron IPC: 托盘菜单触发页面导航
// （preload 的 onNav 返回取消订阅函数；window.nav 的全局类型声明尚未标注返回值，
//  此处局部收窄，避免为改类型越权动 src/env.d.ts）
const navBridge = window.nav as
  { onNav: (cb: (route: { path: string; query?: Record<string, string> }) => void) => () => void } | undefined
const offNav = navBridge?.onNav((route) => router.push(route))

onUnmounted(() => {
  window.removeEventListener('auth:expired', onAuthExpired)
  darkSchemeMql?.removeEventListener('change', applyTheme)
  darkSchemeMql = null
  offNav?.()
})
</script>

<template>
  <!-- 首屏补水门控：视觉与 index.html 内联骨架一致；数据未就位前不渲染主界面（骨架态 ≠ 空态） -->
  <div v-if="!ready && bootError" class="min-h-screen flex items-center justify-center p-6">
    <section class="card max-w-md w-full space-y-4" role="alert">
      <h1 class="page-title">暂时无法加载学习数据</h1>
      <p class="text-sm text-slate-600 dark:text-slate-300">{{ bootError }}</p>
      <p class="text-sm text-slate-500">已保存的数据不会因此被清空，连接恢复后可继续加载。</p>
      <button class="btn-primary w-full" :disabled="bootRetrying" @click="retryBoot?.()">
        {{ bootRetrying ? '正在重试…' : '重新加载' }}
      </button>
    </section>
  </div>
  <div
    v-else-if="!ready"
    role="status"
    aria-busy="true"
    class="fixed inset-0 z-[100] flex flex-col gap-3 bg-slate-50 dark:bg-slate-900 pt-content-top px-4"
  >
    <p class="text-sm text-muted">正在加载学习数据…</p>
    <div aria-hidden="true" class="h-4 w-2/5 rounded-full bg-slate-200 dark:bg-slate-700 animate-pulse"></div>
    <div aria-hidden="true" class="h-24 rounded-card bg-slate-200 dark:bg-slate-700 animate-pulse"></div>
    <div aria-hidden="true" class="h-24 rounded-card bg-slate-200 dark:bg-slate-700 animate-pulse"></div>
  </div>
  <div v-else class="min-h-screen">
    <a v-if="!hideNav" class="skip-link" href="#main-content" @click.prevent="focusMainContent">跳到主要内容</a>
    <aside
      v-if="!hideNav"
      class="app-sidebar hidden md:flex fixed inset-y-0 left-0 pl-safe-left flex-col z-30"
      :class="navCollapsed ? 'w-16 is-collapsed' : 'w-56'"
      aria-label="主导航"
    >
      <RouterLink to="/" class="app-brand" :aria-label="isLoggedIn ? '专升本助手，今天' : '专升本助手'">
        <span class="brand-symbol"><GraduationCap :size="21" aria-hidden="true" /></span>
        <span v-if="!navCollapsed">专升本助手</span>
      </RouterLink>
      <div v-if="!navCollapsed" class="sidebar-context">
        <template v-if="isLoggedIn">
          <span>{{ store.settings.userName }}</span>
          <RouterLink v-if="store.examCountdown !== null" to="/settings" class="countdown-note">
            <strong v-if="store.examCountdown === 0" class="countdown-today">考试就在今天</strong>
            <template v-else>
              <span>距考试</span>
              <strong class="countdown-days font-data">{{ store.examCountdown }}</strong>
              <span>天</span>
            </template>
          </RouterLink>
          <RouterLink v-else to="/settings" class="countdown-note">设置考试日期</RouterLink>
        </template>
        <button v-else class="btn-primary w-full" @click="goLogin(router)">登录，记录备考</button>
      </div>
      <nav class="sidebar-groups flex-1 overflow-y-auto">
        <div v-for="group in navGroups" :key="group.key" class="nav-group" :aria-label="group.label">
          <p v-if="group.key !== 'today' && !navCollapsed" class="nav-group-label">{{ group.label }}</p>
          <RouterLink
            v-for="item in group.items"
            :key="item.path"
            :to="item.path"
            class="nav-link sidebar-link"
            :aria-current="isNavActive(item.path) ? 'page' : undefined"
            :aria-label="item.label"
            :title="navCollapsed ? item.label : undefined"
          >
            <NavIcon :icon="item.icon" :subject="item.subject" class="shrink-0" />
            <span v-if="!navCollapsed" class="truncate">{{ item.label }}</span>
          </RouterLink>
        </div>
      </nav>
      <div class="sidebar-footer">
        <p v-if="isLoggedIn && !navCollapsed" class="sidebar-stats">
          <span
            ><b class="font-data">{{ store.gamification.streak }}</b> 天连续学习</span
          >
          <span
            ><b class="font-data">{{ store.gamification.points }}</b> 积分</span
          >
        </p>
        <button
          type="button"
          class="sidebar-collapse"
          :class="navCollapsed ? 'justify-center' : ''"
          :aria-label="navCollapsed ? '展开导航' : '收起导航'"
          :aria-expanded="!navCollapsed"
          @click="toggleNav"
        >
          <ChevronRight v-if="navCollapsed" :size="18" aria-hidden="true" />
          <ChevronLeft v-else :size="18" aria-hidden="true" />
          <span v-if="!navCollapsed">收起导航</span>
        </button>
      </div>
    </aside>

    <!-- 右上角：登录态显示账号头像入口（含未读通知角标，通知中心已并入头像下拉菜单）；访客态显示登录按钮 -->
    <div
      v-if="!hideNav"
      class="app-header fixed top-0 inset-x-0 z-40 flex items-center gap-3"
      :class="navCollapsed ? 'md:left-16' : 'md:left-56'"
    >
      <div class="header-location hidden md:flex">
        <span class="header-context">{{ navigationTitle }}</span>
        <ChevronRight :size="14" class="text-muted" aria-hidden="true" />
        <span class="header-page">{{ route.meta.title || '学习工作台' }}</span>
      </div>
      <RouterLink to="/" class="header-brand text-lg font-bold md:hidden">专升本助手</RouterLink>
      <div class="flex-1"></div>
      <RouterLink v-if="isLoggedIn" to="/pomodoro" class="header-focus hidden sm:inline-flex">
        <Timer :size="15" aria-hidden="true" />开始专注
      </RouterLink>
      <template v-if="isLoggedIn">
        <button class="icon-button relative" aria-label="消息" @click="goMessages">
          <MessageSquare :size="19" aria-hidden="true" />
          <span v-if="messageUnread && (!dndActive || !store.settings.dndMuteMessage)" class="header-unread">{{
            dndActive ? '·' : messageUnread > 99 ? '99+' : messageUnread
          }}</span>
        </button>
        <button
          ref="avatarBtn"
          class="account-trigger relative z-50"
          title="账号菜单"
          aria-haspopup="true"
          :aria-expanded="avatarOpen"
          @click.stop="avatarOpen = !avatarOpen"
        >
          <img
            v-if="store.settings.avatar"
            :src="imageUrl(store.settings.avatar)"
            class="w-full h-full object-cover rounded-full"
            alt="我的头像"
          />
          <template v-else>{{ avatarLetter }}</template>
          <!-- 未读角标（通知未读 + 消息未读）：勿扰仅红点（无数字）；普通数字角标 -->
          <span
            v-if="dndActive && (community.unreadExcludingMuted || (messageUnread && !store.settings.dndMuteMessage))"
            class="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-[var(--base-correction)] ring-2 ring-white dark:ring-slate-800"
          ></span>
          <span
            v-else-if="!dndActive && community.unreadCount + messageUnread"
            class="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-[var(--base-correction)] text-white text-[9px] font-bold flex items-center justify-center ring-2 ring-white dark:ring-slate-800"
          >
            {{ community.unreadCount + messageUnread > 99 ? '99+' : community.unreadCount + messageUnread }}
          </span>
        </button>
        <div v-if="avatarOpen" class="fixed inset-0 z-40" @click="avatarOpen = false"></div>
        <Transition name="menu">
          <div
            v-if="avatarOpen"
            class="account-menu absolute right-header-right top-content-top z-50 w-44 border py-1.5"
          >
            <button
              class="w-full flex items-center justify-between px-4 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
              @click="goMessages"
            >
              <span>消息</span>
              <span
                v-if="messageUnread"
                class="min-w-[16px] h-4 px-1 rounded-full bg-[var(--base-correction)] text-white text-[9px] font-bold flex items-center justify-center"
                >{{ messageUnread > 99 ? '99+' : messageUnread }}</span
              >
            </button>
            <button
              class="w-full flex items-center justify-between px-4 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
              @click="goNotifications"
            >
              <span>通知中心</span>
              <span
                v-if="community.unreadCount"
                class="min-w-[16px] h-4 px-1 rounded-full bg-[var(--base-correction)] text-white text-[9px] font-bold flex items-center justify-center"
                >{{ community.unreadCount > 99 ? '99+' : community.unreadCount }}</span
              >
            </button>
            <button
              class="w-full text-left px-4 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
              @click="goFeedback"
            >
              意见反馈
            </button>
            <button
              class="w-full text-left px-4 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
              @click="goAccount"
            >
              我的账号
            </button>
            <button
              class="w-full text-left px-4 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
              @click="accountLogout(true)"
            >
              切换账号
            </button>
            <button
              class="w-full text-left px-4 py-2 text-sm text-correction hover:bg-[var(--correction-soft)]"
              @click="accountLogout(false)"
            >
              退出登录
            </button>
          </div>
        </Transition>
      </template>
      <button v-else class="btn-primary" @click="goLogin(router)">登录</button>
    </div>

    <!-- 主内容（非全屏页顶部预留头像入口空间，避免遮挡页面标题栏右侧操作区；笔记编辑态不预留，工具栏置顶） -->
    <main
      id="main-content"
      tabindex="-1"
      :class="
        hideNav
          ? ''
          : (navCollapsed ? 'md:pl-16' : 'md:pl-56') +
            ' pl-safe-left pr-safe-right pb-content-bottom md:pb-6 pt-content-top'
      "
    >
      <div
        v-if="isLoggedIn && (offline || syncIssue)"
        role="status"
        class="mx-4 mb-3 rounded-card border border-correction/30 bg-correction/10 p-3 text-sm text-ink flex flex-wrap items-center gap-3"
      >
        <span class="flex-1 min-w-0">{{ offline ? '网络已断开，当前修改待同步。连接恢复后请重试。' : syncIssue }}</span>
        <button class="btn-ghost" :disabled="offline || retryingSync" @click="retrySync">
          {{ retryingSync ? '同步中…' : '重试同步' }}
        </button>
      </div>
      <!--
        按 route.path 作 key：同一路由记录内仅参数变化（/profile/a → /profile/b、/messages/a → /messages/b）
        时路由复用组件实例、onMounted 不再触发，而多个页面（ProfilePage / FollowsPage / UserWorksTabs /
        MessageChat）在 setup 中一次性捕获了路由参数，会导致 URL 已变内容仍旧。
        这里以 path（已包含全部路径参数）区分实例，强制重建以消除该类缺陷。
        用 route.path 而非 route.fullPath：仅 query 变化（/notes?id=…、列表页 tab）不应重建页面、丢失页内状态。
      -->
      <RouterView v-slot="{ Component }">
        <div v-if="routeLoadError" role="alert" class="study-page space-y-3">
          <p class="text-sm text-correction">{{ routeLoadError }}</p>
          <button class="btn-primary" @click="reloadPage">重新加载页面</button>
        </div>
        <div v-else-if="routeLoading || !Component" role="status" aria-busy="true" class="study-page space-y-3">
          <p class="text-sm text-muted">正在加载页面…</p>
          <div aria-hidden="true" class="h-24 rounded-card bg-slate-200 dark:bg-slate-700 animate-pulse"></div>
        </div>
        <Transition name="fade">
          <div v-if="Component" v-show="!routeLoading && !routeLoadError" :key="route.path" class="min-w-0">
            <component :is="Component" />
          </div>
        </Transition>
      </RouterView>
    </main>

    <!-- 四个入口各有明确分组；次级功能通过原生链接进入，保留浏览器后退。 -->
    <nav v-if="!hideNav" class="mobile-nav md:hidden fixed bottom-0 inset-x-0 z-30" aria-label="移动端主导航">
      <template v-for="group in navGroups" :key="group.key">
        <RouterLink
          v-if="group.key === 'today'"
          to="/"
          class="nav-link mobile-nav-item"
          :aria-current="isNavActive('/') ? 'page' : undefined"
        >
          <NavIcon :icon="group.icon" /><span>今天</span>
        </RouterLink>
        <button
          v-else
          class="nav-link mobile-nav-item"
          :class="{ 'is-current': currentGroup === group.key }"
          aria-haspopup="dialog"
          :aria-expanded="mobileMenu === group.key"
          @click="mobileMenu = group.key"
        >
          <NavIcon :icon="group.icon" /><span>{{ group.shortLabel }}</span>
        </button>
      </template>
      <button v-if="!isLoggedIn" class="nav-link mobile-nav-item" @click="goLogin(router)">
        <NavIcon icon="CircleUserRound" /><span>登录</span>
      </button>
    </nav>
    <Modal :show="!!mobileMenuGroup" :title="mobileMenuGroup?.label || ''" @close="mobileMenu = null">
      <nav class="mobile-menu-grid" :aria-label="mobileMenuGroup?.label">
        <RouterLink
          v-for="item in mobileMenuGroup?.items"
          :key="item.path"
          :to="item.path"
          class="nav-link mobile-menu-link"
          :aria-current="isNavActive(item.path) ? 'page' : undefined"
          @click="mobileMenu = null"
        >
          <NavIcon :icon="item.icon" :subject="item.subject" /><span>{{ item.label }}</span>
        </RouterLink>
      </nav>
    </Modal>

    <Toast ref="toastRef" />
    <ConfirmDialog
      :show="!!confirmState"
      :message="confirmState?.message ?? ''"
      :danger="confirmState?.danger ?? false"
      @confirm="resolveConfirm(true)"
      @cancel="resolveConfirm(false)"
    />
    <AchievementModal />
    <Onboarding v-if="showOnboarding" />
    <!-- 桌面端自动更新弹窗（Web 端无 window.updater，自动隐藏） -->
    <UpdateDialog />
  </div>
</template>
