import type { RouteRecordRaw } from 'vue-router'
export const communityRoutes: RouteRecordRaw[] = [
  {
    path: '/community',
    name: 'community',
    component: () => import('../../pages/Community.vue'),
    meta: { layout: 'app', requiresAuth: true, guestAllowed: true, adminOnly: false, title: '社区广场' }
  },
  {
    path: '/community/circles',
    name: 'circles',
    component: () => import('../../pages/Circles.vue'),
    meta: { layout: 'app', requiresAuth: true, guestAllowed: false, adminOnly: false, title: '话题圈子' }
  },
  {
    path: '/community/circles/:id',
    name: 'circle-detail',
    component: () => import('../../pages/CircleDetail.vue'),
    meta: { layout: 'app', requiresAuth: true, guestAllowed: false, adminOnly: false, title: '圈子详情' }
  },
  {
    path: '/community/topic/:subjectId',
    name: 'topic-discussion',
    component: () => import('../../pages/TopicDiscussion.vue'),
    meta: { layout: 'app', requiresAuth: true, guestAllowed: false, adminOnly: false, title: '知识点讨论' }
  },
  {
    path: '/community/post/:id',
    name: 'community-post',
    component: () => import('../../pages/CommunityPost.vue'),
    meta: { layout: 'app', requiresAuth: true, guestAllowed: true, adminOnly: false, title: '帖子详情' }
  },
  {
    path: '/community/notifications',
    name: 'community-notifications',
    component: () => import('../../pages/CommunityNotifications.vue'),
    meta: { layout: 'app', requiresAuth: true, guestAllowed: false, adminOnly: false, title: '通知中心' }
  }
]
