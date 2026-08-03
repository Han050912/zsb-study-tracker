import { createRouter, createWebHashHistory } from 'vue-router'
import { defineAsyncComponent } from 'vue'
import { isLoggedIn } from '../services/auth'

const routes = [
  { path: '/login', name: 'login', component: defineAsyncComponent(() => import('../pages/Login.vue')), meta: { title: '登录' } },
  { path: '/', name: 'dashboard', component: defineAsyncComponent(() => import('../pages/Dashboard.vue')), meta: { title: '首页' } },
  { path: '/math', name: 'math', component: defineAsyncComponent(() => import('../pages/Math.vue')), meta: { title: '高等数学' } },
  { path: '/english', name: 'english', component: defineAsyncComponent(() => import('../pages/English.vue')), meta: { title: '英语' } },
  { path: '/subject/:id', name: 'subject', component: defineAsyncComponent(() => import('../pages/Subject.vue')), meta: { title: '科目' } },
  { path: '/error-book', name: 'error-book', component: defineAsyncComponent(() => import('../pages/ErrorBook.vue')), meta: { title: '错题本' } },
  { path: '/pomodoro', name: 'pomodoro', component: defineAsyncComponent(() => import('../pages/Pomodoro.vue')), meta: { title: '番茄钟' } },
  { path: '/habits', name: 'habits', component: defineAsyncComponent(() => import('../pages/Habits.vue')), meta: { title: '习惯追踪' } },
  { path: '/daily-summary', name: 'daily-summary', component: defineAsyncComponent(() => import('../pages/DailySummary.vue')), meta: { title: '每日总结' } },
  { path: '/notes', name: 'notes', component: defineAsyncComponent(() => import('../pages/Notes.vue')), meta: { title: '笔记' } },
  // 旧版「总结详情」路由已废弃（往日总结改为悬浮卡片），旧链接重定向到总结页，避免空白
  { path: '/daily-summary/:date', redirect: '/daily-summary' },
  { path: '/statistics', name: 'statistics', component: defineAsyncComponent(() => import('../pages/Statistics.vue')), meta: { title: '数据统计' } },
  { path: '/rewards', name: 'rewards', component: defineAsyncComponent(() => import('../pages/Rewards.vue')), meta: { title: '成就激励' } },
  { path: '/materials', name: 'materials', component: defineAsyncComponent(() => import('../pages/Materials.vue')), meta: { title: '资料库' } },
  { path: '/account', name: 'account', component: defineAsyncComponent(() => import('../pages/Account.vue')), meta: { title: '个人中心' } },
  { path: '/settings', name: 'settings', component: defineAsyncComponent(() => import('../pages/Settings.vue')), meta: { title: '设置' } }
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

router.afterEach((to) => {
  document.title = `${to.meta.title || ''} · 专升本学习助手`
})
