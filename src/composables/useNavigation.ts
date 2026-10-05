import { computed, provide, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useAppStore } from '../stores/app'
import { isLoggedIn, isAdmin } from '../services/auth'

export type NavigationGroup = 'today' | 'study' | 'together' | 'account'
interface NavigationItem {
  path: string
  icon: string
  label: string
  subject: boolean
  group: NavigationGroup
}

/** 导航分组只负责入口呈现；路由、权限与动态科目仍使用现有来源。 */
export function useNavigation() {
  const store = useAppStore()
  const route = useRoute()
  const nav = computed<NavigationItem[]>(() => {
    const together: NavigationItem[] = [
      { path: '/community', icon: 'MessagesSquare', label: '升本讨论', subject: false, group: 'together' },
      { path: '/teams', icon: 'Users', label: '搭子与小队', subject: false, group: 'together' }
    ]
    if (!isLoggedIn.value) return together
    return [
      { path: '/', icon: 'CalendarCheck', label: '今天', subject: false, group: 'today' },
      ...store.subjects.map((s): NavigationItem => ({
        path: s.id === 'math' ? '/math' : s.id === 'english' ? '/english' : `/subject/${s.id}`,
        icon: s.icon,
        label: s.name,
        subject: true,
        group: 'study'
      })),
      { path: '/pomodoro', icon: 'Timer', label: '番茄钟', subject: false, group: 'study' },
      { path: '/error-book', icon: 'BookMarked', label: '我的错题', subject: false, group: 'study' },
      { path: '/notes', icon: 'NotebookPen', label: '我的笔记', subject: false, group: 'study' },
      { path: '/daily-summary', icon: 'SquarePen', label: '每日总结', subject: false, group: 'study' },
      { path: '/statistics', icon: 'ChartNoAxesColumn', label: '学习统计', subject: false, group: 'study' },
      { path: '/habits', icon: 'ListChecks', label: '习惯打卡', subject: false, group: 'study' },
      { path: '/materials', icon: 'Library', label: '学习资料', subject: false, group: 'study' },
      ...together,
      { path: '/account', icon: 'CircleUserRound', label: '我的账号', subject: false, group: 'account' },
      { path: '/rewards', icon: 'Award', label: '积分与成就', subject: false, group: 'account' },
      { path: '/settings', icon: 'Settings', label: '设置', subject: false, group: 'account' },
      ...(isAdmin.value
        ? [{ path: '/admin', icon: 'ShieldCheck', label: '审核中心', subject: false, group: 'account' as const }]
        : [])
    ]
  })
  const groups: { key: NavigationGroup; label: string; shortLabel: string; icon: string }[] = [
    { key: 'today', label: '今天', shortLabel: '今天', icon: 'CalendarCheck' },
    { key: 'study', label: '我的学习', shortLabel: '学习', icon: 'BookOpen' },
    { key: 'together', label: '一起备考', shortLabel: '一起备考', icon: 'Users' },
    { key: 'account', label: '我的', shortLabel: '我的', icon: 'CircleUserRound' }
  ]
  const navGroups = computed(() =>
    groups
      .map((group) => ({ ...group, items: nav.value.filter((item) => item.group === group.key) }))
      .filter((group) => group.items.length)
  )

  function isNavActive(path: string) {
    if (path === '/') return route.path === '/'
    return route.path === path || route.path.startsWith(path + '/')
  }
  const currentGroup = computed<NavigationGroup | null>(() => {
    const item = nav.value.find((item) => isNavActive(item.path))
    if (item) return item.group
    if (/^\/(messages|profile|follows)(\/|$)/.test(route.path)) return 'together'
    if (route.path === '/feedback') return 'account'
    return null
  })

  // 保留原存储键、224/64px 两档及注入，避免破坏详情页固定回复栏。
  const NAV_COLLAPSED_KEY = 'zsb-nav-collapsed'
  const navCollapsed = ref(localStorage.getItem(NAV_COLLAPSED_KEY) === '1')
  function toggleNav() {
    navCollapsed.value = !navCollapsed.value
    localStorage.setItem(NAV_COLLAPSED_KEY, navCollapsed.value ? '1' : '0')
  }
  provide('navCollapsed', navCollapsed)
  return { navGroups, currentGroup, isNavActive, navCollapsed, toggleNav }
}
