import { createRouter, createWebHashHistory } from 'vue-router'
import { isLoggedIn, isAdmin, isGuestMode } from '../services/auth'


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
  { path: '/teams', name: 'teams', component: () => import('../pages/Teams.vue'), meta: { title: '组队挑战' } },
  { path: '/teams/:id', name: 'team-detail', component: () => import('../pages/TeamDetail.vue'), meta: { title: '小组详情' } },
  { path: '/community/circles', name: 'circles', component: () => import('../pages/Circles.vue'), meta: { title: '话题圈子' } },
  { path: '/community/circles/:id', name: 'circle-detail', component: () => import('../pages/CircleDetail.vue'), meta: { title: '圈子详情' } },
  { path: '/community/topic/:subjectId', name: 'topic-discussion', component: () => import('../pages/TopicDiscussion.vue'), meta: { title: '知识点讨论' } },
  { path: '/community/post/:id', name: 'community-post', component: () => import('../pages/CommunityPost.vue'), meta: { title: '帖子详情' } },
  { path: '/messages', name: 'messages', component: () => import('../pages/Messages.vue'), meta: { title: '消息' } },
  { path: '/community/partners', name: 'partners', component: () => import('../pages/Partners.vue'), meta: { title: '学习搭子' } },
  { path: '/partners/study', name: 'partner-study', component: () => import('../pages/PartnerStudy.vue'), meta: { title: '开黑自习室' } },
  { path: '/partners/plans', name: 'partner-plans', component: () => import('../pages/PartnerPlans.vue'), meta: { title: '协作备考计划' } },
  { path: '/partners/reviews', name: 'partner-reviews', component: () => import('../pages/PartnerReviews.vue'), meta: { title: '复盘邀约' } },
  { path: '/partners/shares', name: 'partner-shares', component: () => import('../pages/PartnerShares.vue'), meta: { title: '搭子分享' } },
  { path: '/partners/shares/preview/:id', name: 'partner-share-preview', component: () => import('../pages/PartnerSharePreview.vue'), meta: { title: '分享预览' } },
  { path: '/messages/:peerId', name: 'message-chat', component: () => import('../pages/MessageChat.vue'), meta: { title: '消息' } },
  { path: '/community/notifications', name: 'community-notifications', component: () => import('../pages/CommunityNotifications.vue'), meta: { title: '通知中心' } },
  { path: '/admin', name: 'admin', component: () => import('../pages/AdminReports.vue'), meta: { title: '审核中心' } },
  { path: '/notes', name: 'notes', component: () => import('../pages/Notes.vue'), meta: { title: '笔记' } },
  { path: '/daily-summary/:date', redirect: '/daily-summary' },
  { path: '/statistics', name: 'statistics', component: () => import('../pages/Statistics.vue'), meta: { title: '数据统计' } },
  { path: '/rewards', name: 'rewards', component: () => import('../pages/Rewards.vue'), meta: { title: '成就激励' } },
  { path: '/materials', name: 'materials', component: () => import('../pages/Materials.vue'), meta: { title: '资料库' } },
  { path: '/account', name: 'account', component: () => import('../pages/Account.vue'), meta: { title: '个人中心' } },
  { path: '/follows/:id', name: 'follows', component: () => import('../pages/FollowsPage.vue'), meta: { title: '关系列表' } },
  { path: '/feedback', name: 'feedback', component: () => import('../pages/Feedback.vue'), meta: { title: '意见反馈' } },
  { path: '/profile/:id', name: 'profile', component: () => import('../pages/ProfilePage.vue'), meta: { title: '成长主页' } },
  { path: '/settings', name: 'settings', component: () => import('../pages/Settings.vue'), meta: { title: '设置' } }
]

export const router = createRouter({
  history: createWebHashHistory(),
  routes
})

// 登录守卫（访问控制）：
// 1. 已登录访问登录/注册页 → 首页
// 2. 未登录仅可访问两类页面：登录页；或已通过「先随便看看」开启访客模式后的公开页（社区广场/帖子详情/组队）。
//    其余路径（含直接输入 URL 进入公开页、未开启访客模式即访问公开页）一律回登录页
// 3. 审核中心仅管理员可见（未登录已在上一步拦截，此处仅约束已登录的非管理员）
router.beforeEach((to) => {
  if (isLoggedIn.value && to.name === 'login') return { name: 'dashboard' }

  if (!isLoggedIn.value) {
    const guestAllowed = to.name === 'community' || to.name === 'community-post' || to.name === 'teams'
    const canBrowse = isGuestMode.value && guestAllowed
    if (to.name !== 'login' && !canBrowse) return { name: 'login' }
  }

  if (to.name === 'admin' && !isAdmin.value) return { name: 'community' }
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
