import type { RouteRecordRaw } from 'vue-router'
export const collaborationRoutes: RouteRecordRaw[] = [
  {
    path: '/teams',
    name: 'teams',
    component: () => import('../../pages/Teams.vue'),
    meta: { layout: 'app', requiresAuth: true, guestAllowed: true, adminOnly: false, title: '组队协作' }
  },
  {
    path: '/teams/squads/:teamId',
    name: 'team-detail',
    component: () => import('../../pages/TeamDetail.vue'),
    meta: { layout: 'app', requiresAuth: true, guestAllowed: false, adminOnly: false, title: '小组详情' }
  },
  {
    path: '/teams/partners/study',
    name: 'partner-study',
    component: () => import('../../pages/PartnerStudy.vue'),
    meta: { layout: 'immersive', requiresAuth: true, guestAllowed: false, adminOnly: false, title: '开黑自习室' }
  },
  {
    path: '/teams/partners/plans',
    name: 'partner-plans',
    component: () => import('../../pages/PartnerPlans.vue'),
    meta: { layout: 'app', requiresAuth: true, guestAllowed: false, adminOnly: false, title: '协作备考计划' }
  },
  {
    path: '/teams/partners/reviews',
    name: 'partner-reviews',
    component: () => import('../../pages/PartnerReviews.vue'),
    meta: { layout: 'app', requiresAuth: true, guestAllowed: false, adminOnly: false, title: '复盘邀约' }
  },
  {
    path: '/teams/partners/shares',
    name: 'partner-shares',
    component: () => import('../../pages/PartnerShares.vue'),
    meta: { layout: 'app', requiresAuth: true, guestAllowed: false, adminOnly: false, title: '搭子分享' }
  },
  {
    path: '/teams/partners/shares/preview/:id',
    name: 'partner-share-preview',
    component: () => import('../../pages/PartnerSharePreview.vue'),
    meta: { layout: 'app', requiresAuth: true, guestAllowed: false, adminOnly: false, title: '分享预览' }
  },
  {
    path: '/teams/partners/plans/:planId',
    name: 'partner-plan-detail',
    component: () => import('../../pages/PartnerPlans.vue'),
    meta: { title: '计划详情', requiresAuth: true, layout: 'app' }
  },
  {
    path: '/community/partners',
    name: 'partners',
    redirect: (to) => ({ name: 'teams', query: { ...to.query, mode: 'partners' }, hash: to.hash })
  },
  {
    path: '/teams/:id',
    redirect: (to) => ({ name: 'team-detail', params: { teamId: to.params.id }, query: to.query, hash: to.hash })
  },
  {
    path: '/partners/study',
    redirect: (to) => ({ name: 'partner-study', params: to.params, query: to.query, hash: to.hash })
  },
  {
    path: '/partners/plans',
    redirect: (to) => ({ name: 'partner-plans', params: to.params, query: to.query, hash: to.hash })
  },
  {
    path: '/partners/reviews',
    redirect: (to) => ({ name: 'partner-reviews', params: to.params, query: to.query, hash: to.hash })
  },
  {
    path: '/partners/shares',
    redirect: (to) => ({ name: 'partner-shares', params: to.params, query: to.query, hash: to.hash })
  },
  {
    path: '/partners/shares/preview/:id',
    redirect: (to) => ({ name: 'partner-share-preview', params: to.params, query: to.query, hash: to.hash })
  }
]
