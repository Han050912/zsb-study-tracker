import type { RouteRecordRaw } from 'vue-router'
import { communityRoutes } from '../features/community/routes'
import { collaborationRoutes } from '../features/collaboration/routes'
import { nextTick } from 'vue'
import { createRouter, createWebHashHistory } from 'vue-router'
import { isLoggedIn, isAdmin, isGuestMode } from '../services/auth'

const routes: RouteRecordRaw[] = [
  ...communityRoutes,
  ...collaborationRoutes,
  {
    path: '/login',
    name: 'login',
    component: () => import('../pages/Login.vue'),
    meta: { layout: 'auth', requiresAuth: false, guestAllowed: false, adminOnly: false, title: '登录' }
  },
  {
    path: '/',
    name: 'dashboard',
    component: () => import('../pages/Dashboard.vue'),
    meta: { layout: 'app', requiresAuth: true, guestAllowed: false, adminOnly: false, title: '首页' }
  },
  {
    path: '/math',
    name: 'math',
    component: () => import('../pages/Math.vue'),
    meta: { layout: 'app', requiresAuth: true, guestAllowed: false, adminOnly: false, title: '高等数学' }
  },
  {
    path: '/english',
    name: 'english',
    component: () => import('../pages/English.vue'),
    meta: { layout: 'app', requiresAuth: true, guestAllowed: false, adminOnly: false, title: '英语' }
  },
  {
    path: '/subject/:id',
    name: 'subject',
    component: () => import('../pages/Subject.vue'),
    meta: { layout: 'app', requiresAuth: true, guestAllowed: false, adminOnly: false, title: '科目' }
  },
  {
    path: '/error-book',
    name: 'error-book',
    component: () => import('../pages/ErrorBook.vue'),
    meta: { layout: 'app', requiresAuth: true, guestAllowed: false, adminOnly: false, title: '错题本' }
  },
  {
    path: '/pomodoro',
    name: 'pomodoro',
    component: () => import('../pages/Pomodoro.vue'),
    meta: { layout: 'immersive', requiresAuth: true, guestAllowed: false, adminOnly: false, title: '番茄钟' }
  },
  {
    path: '/habits',
    name: 'habits',
    component: () => import('../pages/Habits.vue'),
    meta: { layout: 'app', requiresAuth: true, guestAllowed: false, adminOnly: false, title: '习惯追踪' }
  },
  {
    path: '/daily-summary',
    name: 'daily-summary',
    component: () => import('../pages/DailySummary.vue'),
    meta: { layout: 'app', requiresAuth: true, guestAllowed: false, adminOnly: false, title: '每日总结' }
  },
  {
    path: '/messages',
    name: 'messages',
    component: () => import('../pages/Messages.vue'),
    meta: { layout: 'app', requiresAuth: true, guestAllowed: false, adminOnly: false, title: '消息' }
  },
  {
    path: '/messages/:peerId',
    name: 'message-chat',
    component: () => import('../pages/MessageChat.vue'),
    meta: { layout: 'app', requiresAuth: true, guestAllowed: false, adminOnly: false, title: '消息' }
  },
  {
    path: '/admin',
    name: 'admin',
    component: () => import('../pages/AdminReports.vue'),
    meta: { layout: 'app', requiresAuth: true, guestAllowed: false, adminOnly: true, title: '审核中心' }
  },
  {
    path: '/notes',
    name: 'notes',
    component: () => import('../pages/Notes.vue'),
    meta: { layout: 'app', requiresAuth: true, guestAllowed: false, adminOnly: false, title: '笔记' }
  },
  { path: '/daily-summary/:date', redirect: '/daily-summary' },
  {
    path: '/statistics',
    name: 'statistics',
    component: () => import('../pages/Statistics.vue'),
    meta: { layout: 'app', requiresAuth: true, guestAllowed: false, adminOnly: false, title: '数据统计' }
  },
  {
    path: '/rewards',
    name: 'rewards',
    component: () => import('../pages/Rewards.vue'),
    meta: { layout: 'app', requiresAuth: true, guestAllowed: false, adminOnly: false, title: '成就激励' }
  },
  {
    path: '/materials',
    name: 'materials',
    component: () => import('../pages/Materials.vue'),
    meta: { layout: 'app', requiresAuth: true, guestAllowed: false, adminOnly: false, title: '资料库' }
  },
  {
    path: '/account',
    name: 'account',
    component: () => import('../pages/Account.vue'),
    meta: { layout: 'app', requiresAuth: true, guestAllowed: false, adminOnly: false, title: '个人中心' }
  },
  {
    path: '/follows/:id',
    name: 'follows',
    component: () => import('../pages/FollowsPage.vue'),
    meta: { layout: 'app', requiresAuth: true, guestAllowed: false, adminOnly: false, title: '关系列表' }
  },
  {
    path: '/feedback',
    name: 'feedback',
    component: () => import('../pages/Feedback.vue'),
    meta: { layout: 'app', requiresAuth: true, guestAllowed: false, adminOnly: false, title: '意见反馈' }
  },
  {
    path: '/profile/:id',
    name: 'profile',
    component: () => import('../pages/ProfilePage.vue'),
    meta: { layout: 'app', requiresAuth: true, guestAllowed: false, adminOnly: false, title: '成长主页' }
  },
  {
    path: '/settings',
    name: 'settings',
    component: () => import('../pages/Settings.vue'),
    meta: { layout: 'app', requiresAuth: true, guestAllowed: false, adminOnly: false, title: '设置' }
  }
]

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
  // 滚动复位（P3-04）：页面滚动发生在 window（App 根节点 min-h-screen，<main> 无内部滚动容器），
  // savedPosition 可用 —— 前进导航回顶部，浏览器后退/前进恢复历史位置。
  // 仅 query 变化的页内导航（如关系列表 tab 同步 URL）不做复位，避免切 tab 被强行拉回顶部；
  // 恢复位置时等新页面完成渲染再执行，避免懒加载页内容未挂载、高度不足导致恢复失败
  scrollBehavior(to, from, savedPosition) {
    if (savedPosition) return nextTick().then(() => savedPosition)
    if (to.path === from.path) return {}
    return { left: 0, top: 0 }
  }
})

// 登录守卫（访问控制）：
// 1. 已登录访问登录/注册页 → 首页
// 2. 未登录仅可访问两类页面：登录页；或已通过「先随便看看」开启访客模式后的公开页（社区广场/帖子详情/组队）。
//    其余路径（含直接输入 URL 进入公开页、未开启访客模式即访问公开页）一律回登录页
// 3. 审核中心仅管理员可见（未登录已在上一步拦截，此处仅约束已登录的非管理员）
router.beforeEach((to) => {
  if (isLoggedIn.value && to.meta.layout === 'auth') return { name: 'dashboard' }

  if (!isLoggedIn.value) {
    const guestAllowed = to.meta.guestAllowed === true
    const canBrowse = isGuestMode.value && guestAllowed
    if (to.meta.requiresAuth !== false && to.meta.layout !== 'auth' && !canBrowse) return { name: 'login' }
  }

  if (to.meta.adminOnly && !isAdmin.value) return { name: 'community' }
})

// 异步页面组件加载失败（dev server 重启/版本更新后，旧标签页持有的模块 URL 失效）时，
// RouterView 会渲染空白。自愈策略：整页刷新一次拉取最新模块；用 sessionStorage 防止刷新死循环
const ROUTE_RELOAD_KEY = 'route-error-reloaded'
router.onError((err, to) => {
  console.error(`页面加载失败: ${to.fullPath}`, err)
  if (sessionStorage.getItem(ROUTE_RELOAD_KEY)) return
  sessionStorage.setItem(ROUTE_RELOAD_KEY, '1')
  window.location.reload()
})

router.afterEach((to) => {
  document.title = `${to.meta.title || ''} · 专升本学习助手`
  // 导航成功即解除自愈锁
  sessionStorage.removeItem(ROUTE_RELOAD_KEY)
})
