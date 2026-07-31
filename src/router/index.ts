import { createRouter, createWebHashHistory } from 'vue-router'
import { defineAsyncComponent } from 'vue'

const routes = [
  { path: '/', name: 'dashboard', component: defineAsyncComponent(() => import('../pages/Dashboard.vue')), meta: { title: '首页' } },
  { path: '/math', name: 'math', component: defineAsyncComponent(() => import('../pages/Math.vue')), meta: { title: '高等数学' } },
  { path: '/english', name: 'english', component: defineAsyncComponent(() => import('../pages/English.vue')), meta: { title: '英语' } },
  { path: '/subject/:id', name: 'subject', component: defineAsyncComponent(() => import('../pages/Subject.vue')), meta: { title: '科目' } },
  { path: '/error-book', name: 'error-book', component: defineAsyncComponent(() => import('../pages/ErrorBook.vue')), meta: { title: '错题本' } },
  { path: '/pomodoro', name: 'pomodoro', component: defineAsyncComponent(() => import('../pages/Pomodoro.vue')), meta: { title: '番茄钟' } },
  { path: '/habits', name: 'habits', component: defineAsyncComponent(() => import('../pages/Habits.vue')), meta: { title: '习惯追踪' } },
  { path: '/daily-summary', name: 'daily-summary', component: defineAsyncComponent(() => import('../pages/DailySummary.vue')), meta: { title: '每日总结' } },
  { path: '/daily-summary/:date', name: 'summary-detail', component: defineAsyncComponent(() => import('../pages/DailySummary.vue')), meta: { title: '总结详情' } },
  { path: '/statistics', name: 'statistics', component: defineAsyncComponent(() => import('../pages/Statistics.vue')), meta: { title: '数据统计' } },
  { path: '/rewards', name: 'rewards', component: defineAsyncComponent(() => import('../pages/Rewards.vue')), meta: { title: '成就激励' } },
  { path: '/materials', name: 'materials', component: defineAsyncComponent(() => import('../pages/Materials.vue')), meta: { title: '资料库' } },
  { path: '/settings', name: 'settings', component: defineAsyncComponent(() => import('../pages/Settings.vue')), meta: { title: '设置' } }
]

export const router = createRouter({
  history: createWebHashHistory(),
  routes
})

router.afterEach((to) => {
  document.title = `${to.meta.title || ''} · 专升本学习助手`
})
