import { createRouter, createWebHashHistory } from 'vue-router'
import { isLoggedIn } from '../services/auth'


const routes = [
  { path: '/login', name: 'login', component: () => import('../pages/Login.vue'), meta: { title: '登录' } },
  { path: '/', name: 'dashboard', component: () => import('../pages/Dashboard.vue'), meta: { title: '首页' } },
  { path: '/math', name: 'math', component: () => import('../pages/Math.vue'), meta: { title: '高等数学' } },
  { path: '/english', name: 'english', component: () => import('../pages/English.vue'), meta: { title: '英语' } },
  { path: '/subject/:id', name: 'subject', component: () => import('../pages/Subject.vue'), meta: { title: '科目' } },
  { path: '/error-book', name: 'error-book', component: () => import('../pages/ErrorBook.vue'), meta: { title: '错题本' } },
  { path: '/pomodoro', name: 'pomodoro', component: () => import('../pages/Pomodoro.vue'), meta: { title: '番茄钟' } },
  { path: '/habits', name: 'habits', component: () => import('../pages/Habits.vue'), meta: { title: '习惯追踪' } },
  { path: '/daily-summary', name: 'daily-summary', component: () => import('../pages/DailySummary.vue'), meta: { title: '每日总结' } },
  { path: '/community', name: 'community', component: () => import('../pages/Community.vue'), meta: { title: '社区广场' } },
  { path: '/community/post/:id', name: 'community-post', component: () => import('../pages/CommunityPost.vue'), meta: { title: '帖子详情' } },
  { path: '/community/notifications', name: 'community-notifications', component: () => import('../pages/CommunityNotifications.vue'), meta: { title: '通知中心' } },
  { path: '/notes', name: 'notes', component: () => import('../pages/Notes.vue'), meta: { title: '笔记' } },
  { path: '/daily-summary/:date', redirect: '/daily-summary' },
  { path: '/statistics', name: 'statistics', component: () => import('../pages/Statistics.vue'), meta: { title: '数据统计' } },
  { path: '/rewards', name: 'rewards', component: () => import('../pages/Rewards.vue'), meta: { title: '成就激励' } },
  { path: '/materials', name: 'materials', component: () => import('../pages/Materials.vue'), meta: { title: '资料库' } },
  { path: '/account', name: 'account', component: () => import('../pages/Account.vue'), meta: { title: '个人中心' } },
  { path: '/settings', name: 'settings', component: () => import('../pages/Settings.vue'), meta: { title: '设置' } }
]

export const router = createRouter({
  history: createWebHashHistory(),
  routes
})

// 登录守卫：未登录访问任意页面跳转登录页；已登录访问登录页跳转首页（按路由名判断，避免路径硬编码）
router.beforeEach((to) => {
  if (!isLoggedIn.value && to.name !== 'login') return { name: 'login' }
  if (isLoggedIn.value && to.name === 'login') return { name: 'dashboard' }
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
