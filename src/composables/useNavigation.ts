import { computed, provide, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useAppStore } from '../stores/app'
import { isLoggedIn, isAdmin } from '../services/auth'

/** 导航：NAV/mobileNav 动态生成、激活判断、侧边栏折叠持久化 */
export function useNavigation() {
  const store = useAppStore()
  const route = useRoute()

  // 导航动态生成：科目项随科目列表实时增减（删除科目自动隐藏，新增科目自动出现）
  // 侧边栏展示科目全名；移动端由 CSS truncate 截断
  const nav = computed(() => {
    // 访客态：社区 + 组队（公开小组列表可浏览；其余为个人学习功能，需登录）
    if (!isLoggedIn.value) {
      return [
        { path: '/community', icon: '💬', label: '社区', subject: false },
        { path: '/teams', icon: '👥', label: '组队协作', subject: false }
      ]
    }
    const subjectItems = store.subjects.map((s) => ({
      path: s.id === 'math' ? '/math' : s.id === 'english' ? '/english' : `/subject/${s.id}`,
      icon: s.icon,
      label: s.name,
      subject: true
    }))
    return [
      { path: '/', icon: '🏠', label: '首页', subject: false },
      { path: '/community', icon: '💬', label: '社区', subject: false },
      { path: '/teams', icon: '👥', label: '组队协作', subject: false },
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
        { path: '/teams', icon: '👥', label: '组队协作', subject: false },
        { path: `/login?redirect=${encodeURIComponent(route.path || '/community')}`, label: '登录', subject: false }
      ]
    }
    const subjectPaths = nav.value
      .filter((n) => n.subject)
      .slice(0, 1)
      .map((n) => n.path)
    const picks = ['/', ...subjectPaths, '/community', '/teams', '/pomodoro', '/settings']
    return picks.map((p) => nav.value.find((n) => n.path === p)).filter((n): n is NonNullable<typeof n> => !!n)
  })

  /** 导航激活判断：精确匹配或子路径匹配（避免 '/materials' 误激活 '/math' 这类前缀碰撞） */
  function isNavActive(path: string) {
    if (path === '/') return route.path === '/'
    return route.path === path || route.path.startsWith(path + '/')
  }

  // ---- 侧边栏折叠 / 展开（状态持久化，刷新后保持） ----
  const NAV_COLLAPSED_KEY = 'zsb-nav-collapsed'
  const navCollapsed = ref(localStorage.getItem(NAV_COLLAPSED_KEY) === '1')
  function toggleNav() {
    navCollapsed.value = !navCollapsed.value
    localStorage.setItem(NAV_COLLAPSED_KEY, navCollapsed.value ? '1' : '0')
  }
  // 侧边栏宽度状态注入给子页面（如帖子详情底部回复框），使其与主内容区同一列对齐
  provide('navCollapsed', navCollapsed)

  return { nav, mobileNav, isNavActive, navCollapsed, toggleNav }
}
