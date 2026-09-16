<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, onUnmounted, provide, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAppStore } from './stores/app'
import { useCommunityStore } from './stores/community'
import { sessionUser, logout, isLoggedIn, goLogin } from './services/auth'
import Toast from './components/Toast.vue'
import Onboarding from './components/Onboarding.vue'
import UpdateDialog from './components/UpdateDialog.vue'
import ConfirmDialog from './components/ConfirmDialog.vue'
import { imageUrl } from './api/community'
import { isDndActive } from './utils/dnd'
import { TOAST_KEY } from './composables/useToast'
import { useConfirmProvider } from './composables/useConfirm'
import { useUnreadPolling } from './composables/useUnreadPolling'
import { useReminders } from './composables/useReminders'
import { useNavigation } from './composables/useNavigation'
import { useAppReady } from './composables/useAppBoot'

// 成就分享弹窗按需异步加载：切断入口对 markdown-it/katex 依赖链（AchievementModal → PostComposer → utils/markdown）的静态引用
const AchievementModal = defineAsyncComponent(() => import('./components/AchievementModal.vue'))

const store = useAppStore()
const community = useCommunityStore()
const route = useRoute()
const router = useRouter()

// ---- Toast 全局服务 ----
const toastRef = ref<InstanceType<typeof Toast>>()
provide(TOAST_KEY, (msg: string) => toastRef.value?.show(msg))

// ---- 全局确认弹窗（替代原生 confirm；App 自身亦直接使用 confirmFn） ----
const { confirmState, confirmFn, resolveConfirm } = useConfirmProvider()

// ---- 未读轮询（登录后拉取社区/消息未读数；见 composables/useUnreadPolling.ts） ----
const { messageUnread } = useUnreadPolling()
// ---- 提醒调度（每日提醒 + 待办提醒 + 搭子提醒；见 composables/useReminders.ts） ----
useReminders()
// ---- 导航（动态生成 + 激活判断 + 折叠持久化；见 composables/useNavigation.ts） ----
const { nav: NAV, mobileNav, isNavActive, navCollapsed, toggleNav } = useNavigation()

// ---- 首屏补水门控（main.ts 把云端数据拉取移出挂载路径；未就绪前只渲染骨架） ----
const ready = useAppReady()

// ---- 主题 ----
function applyTheme() {
  const t = store.settings.theme
  const dark = t === 'dark' || (t === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
}
// 主题在补水完成后才随 settings.theme 从云端就位，且 index.html 会先按 prefers-color-scheme 预置 dark 类，
// 因此必须 watch 而不是只在 onMounted 应用一次（immediate 负责用用户显式选择的主题纠正预置值）
watch(() => store.settings.theme, applyTheme, { immediate: true })
onMounted(() => {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme)
})

// 401 登录过期：清空会话与内存中的用户数据，防止串号到下一个登录的账号
// （logout 置空 currentUser → isLoggedIn 变 false → 触发未读轮询停止）
window.addEventListener('auth:expired', () => {
  logout()
  store.resetState()
  community.resetState()
})

const dndActive = computed(() => isDndActive(store.settings))

// 全屏沉浸页：番茄钟 + 开黑自习室（进入后隐藏全局导航，实现真正全屏）
const isFullscreenPage = computed(() => route.path === '/pomodoro' || route.path === '/partners/study')
const isAuthPage = computed(() => route.path === '/login')
// 笔记页打开具体笔记时隐藏右上角头像浮层，把顶部右侧让给编辑工具栏
const isNotesEditing = computed(() => route.path === '/notes' && (!!route.query.id || route.query.new === '1'))
const hideNav = computed(() => isFullscreenPage.value || isAuthPage.value)
const showOnboarding = computed(() => isLoggedIn.value && !isAuthPage.value && !store.settings.onboarded)

// ---- 右上角账号头像下拉菜单 ----
// 不复用 useOverlayDismiss：其完整模式（body 滚动锁定 + Tab 焦点陷阱 + 打开时强制移焦）
// 面向遮罩式弹窗，对轻量下拉菜单过重；这里仅补 ESC 关闭 + aria + 关闭时归还焦点，
// 「点击外部关闭」沿用既有的透明遮罩层行为。
const avatarOpen = ref(false)
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

  // ② 清理会话状态并跳转登录页
  logout()
  store.resetState()
  community.resetState()
  // 退出后回登录页；访客浏览模式仅能由登录页「先随便看看」入口进入
  router.replace('/login')
}

// Electron IPC: 托盘菜单触发页面导航
if (window.nav) {
  window.nav.onNav((route) => router.push(route))
}
</script>

<template>
  <!-- 首屏补水门控：视觉与 index.html 内联骨架一致；数据未就位前不渲染主界面（骨架态 ≠ 空态） -->
  <div
    v-if="!ready"
    class="fixed inset-0 z-[100] flex flex-col gap-3 bg-slate-50 dark:bg-slate-900 pt-content-top px-4"
  >
    <div class="h-4 w-2/5 rounded-full bg-slate-200 dark:bg-slate-700 animate-pulse"></div>
    <div class="h-24 rounded-2xl bg-slate-200 dark:bg-slate-700 animate-pulse"></div>
    <div class="h-24 rounded-2xl bg-slate-200 dark:bg-slate-700 animate-pulse"></div>
  </div>
  <div v-else class="min-h-screen">
    <!-- 桌面侧边栏（支持折叠/展开） -->
    <aside
      v-if="!hideNav"
      class="hidden md:flex fixed inset-y-0 left-0 pl-safe-left flex-col bg-white dark:bg-slate-800 border-r border-slate-100 dark:border-slate-700 z-30 transition-all duration-200"
      :class="navCollapsed ? 'w-16' : 'w-56'"
    >
      <div class="px-5 py-5" :class="navCollapsed ? '!px-3' : ''">
        <div
          class="flex items-center gap-2 text-lg font-bold text-primary-600 dark:text-primary-400"
          :class="navCollapsed ? 'justify-center' : ''"
        >
          <img :src="'./logo.png'" alt="Logo" class="w-8 h-8 shrink-0" /><span v-if="!navCollapsed">专升本助手</span>
        </div>
        <div v-if="!navCollapsed" class="text-xs text-slate-400 mt-1">
          {{ isLoggedIn ? `${store.settings.userName} · ${store.level.name}学者` : '访客浏览中' }}
        </div>
      </div>
      <div
        v-if="isLoggedIn && store.examCountdown !== null && !navCollapsed"
        class="mx-4 mb-3 rounded-xl bg-gradient-to-r from-primary-500 to-primary-600 text-white px-3 py-2 text-center"
      >
        <template v-if="store.examCountdown > 0">
          <div class="text-[10px] opacity-80">距考试还有</div>
          <div class="text-xl font-bold leading-tight">{{ store.examCountdown }} 天</div>
        </template>
        <div v-else class="text-sm font-bold leading-tight py-1">考试就是今天，加油！</div>
      </div>
      <button
        v-else-if="!isLoggedIn && !navCollapsed"
        class="mx-4 mb-3 rounded-xl bg-gradient-to-r from-primary-500 to-primary-600 text-white px-3 py-2.5 text-center hover:opacity-90 transition-opacity"
        @click="goLogin(router)"
      >
        <div class="text-sm font-bold">登录</div>
        <div class="text-[10px] opacity-80 mt-0.5">解锁全部学习功能</div>
      </button>
      <nav class="flex-1 overflow-y-auto px-3 space-y-1 pb-4" :class="navCollapsed ? '!px-2' : ''">
        <RouterLink
          v-for="item in NAV"
          :key="item.path"
          :to="item.path"
          class="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors"
          :class="[
            isNavActive(item.path)
              ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 font-semibold'
              : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700',
            navCollapsed ? 'justify-center !px-2' : ''
          ]"
          :title="navCollapsed ? item.label : ''"
        >
          <span class="text-lg">{{ item.icon }}</span
          ><span v-if="!navCollapsed">{{ item.label }}</span>
        </RouterLink>
      </nav>
      <button
        class="mx-3 mb-2 flex items-center gap-2 rounded-xl px-3 py-2 text-xs text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
        :class="navCollapsed ? 'justify-center !px-2' : ''"
        :title="navCollapsed ? '展开导航' : '收起导航'"
        @click="toggleNav"
      >
        <span>{{ navCollapsed ? '»' : '«' }}</span
        ><span v-if="!navCollapsed">收起导航</span>
      </button>
      <div v-if="isLoggedIn && !navCollapsed" class="mx-3 mb-3 grid grid-cols-2 gap-2">
        <div
          class="rounded-xl bg-amber-50 dark:bg-amber-500/10 px-3 py-2 flex flex-col items-center justify-center text-center"
        >
          <div class="text-[15px] font-bold leading-none text-amber-600 dark:text-amber-400">
            {{ store.gamification.points }}
          </div>
          <div class="text-[10px] text-slate-400 mt-0.5">积分</div>
        </div>
        <div
          class="rounded-xl bg-purple-50 dark:bg-purple-500/10 px-3 py-2 flex flex-col items-center justify-center text-center"
        >
          <div class="text-[15px] font-bold leading-none text-purple-600 dark:text-purple-400">
            {{ store.gamification.streak }}
          </div>
          <div class="text-[10px] text-slate-400 mt-0.5">连续学习天数</div>
        </div>
      </div>
    </aside>

    <!-- 右上角：登录态显示账号头像入口（含未读通知角标，通知中心已并入头像下拉菜单）；访客态显示登录按钮 -->
    <div
      v-if="!hideNav && !isNotesEditing"
      class="fixed top-header-top right-header-right z-40 flex items-center gap-3"
    >
      <template v-if="isLoggedIn">
        <button
          ref="avatarBtn"
          class="relative z-50 w-9 h-9 rounded-full bg-gradient-to-br from-primary-500 to-indigo-600 text-white text-sm font-bold flex items-center justify-center shadow-md hover:shadow-lg transition-shadow"
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
            class="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-rose-500 ring-2 ring-white dark:ring-slate-800"
          ></span>
          <span
            v-else-if="!dndActive && community.unreadCount + messageUnread"
            class="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-white text-[9px] font-bold flex items-center justify-center ring-2 ring-white dark:ring-slate-800"
          >
            {{ community.unreadCount + messageUnread > 99 ? '99+' : community.unreadCount + messageUnread }}
          </span>
        </button>
        <div v-if="avatarOpen" class="fixed inset-0 z-40" @click="avatarOpen = false"></div>
        <div
          v-if="avatarOpen"
          class="absolute right-0 top-11 z-50 w-40 rounded-xl bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 shadow-lg py-1.5"
        >
          <button
            class="w-full flex items-center justify-between px-4 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
            @click="goMessages"
          >
            <span>消息</span>
            <span
              v-if="messageUnread"
              class="min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-white text-[9px] font-bold flex items-center justify-center"
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
              class="min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-white text-[9px] font-bold flex items-center justify-center"
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
            个人中心
          </button>
          <button
            class="w-full text-left px-4 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
            @click="accountLogout(true)"
          >
            切换账号
          </button>
          <button
            class="w-full text-left px-4 py-2 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
            @click="accountLogout(false)"
          >
            退出登录
          </button>
        </div>
      </template>
      <button
        v-else
        class="px-4 py-2 rounded-full bg-primary-500 text-white text-sm font-semibold shadow-md hover:bg-primary-600 hover:shadow-lg transition-colors"
        @click="goLogin(router)"
      >
        登录
      </button>
    </div>

    <!-- 主内容（非全屏页顶部预留头像入口空间，避免遮挡页面标题栏右侧操作区；笔记编辑态不预留，工具栏置顶） -->
    <main
      :class="
        hideNav
          ? ''
          : (navCollapsed ? 'md:pl-16' : 'md:pl-56') +
            ' pl-safe-left pr-safe-right pb-content-bottom md:pb-6' +
            (isNotesEditing ? '' : ' pt-content-top')
      "
    >
      <!--
        按 route.path 作 key：同一路由记录内仅参数变化（/profile/a → /profile/b、/messages/a → /messages/b）
        时路由复用组件实例、onMounted 不再触发，而多个页面（ProfilePage / FollowsPage / UserWorksTabs /
        MessageChat）在 setup 中一次性捕获了路由参数，会导致 URL 已变内容仍旧。
        这里以 path（已包含全部路径参数）区分实例，强制重建以消除该类缺陷。
        用 route.path 而非 route.fullPath：仅 query 变化（/notes?id=…、列表页 tab）不应重建页面、丢失页内状态。
      -->
      <RouterView v-slot="{ Component }">
        <Transition name="fade">
          <component :is="Component" :key="route.path" />
        </Transition>
      </RouterView>
    </main>

    <!-- 移动端底部导航 -->
    <nav
      v-if="!hideNav"
      class="md:hidden fixed bottom-0 inset-x-0 bg-white dark:bg-slate-800 border-t border-slate-100 dark:border-slate-700 z-30 flex justify-around pt-1.5 pb-safe-bottom pl-safe-left pr-safe-right"
    >
      <RouterLink
        v-for="item in mobileNav"
        :key="item.path"
        :to="item.path"
        class="flex flex-col items-center px-2 py-1 text-[10px] rounded-lg max-w-[64px]"
        :class="
          isNavActive(item.path)
            ? 'text-primary-600 dark:text-primary-400 font-semibold'
            : 'text-slate-500 dark:text-slate-400'
        "
      >
        <span class="text-xl leading-none">{{ item.icon }}</span>
        <span class="truncate w-full text-center">{{ item.label }}</span>
      </RouterLink>
    </nav>

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
