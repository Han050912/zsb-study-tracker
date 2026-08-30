// 社区域路由注册聚合入口；共享 helper 供外部模块从 './community' 直接导入
export * from './shared'
import { registerPostsRoutes } from './posts'
import { registerLikesRoutes } from './likes'
import { registerMessagesRoutes } from './messages'
import { registerCirclesRoutes } from './circles'
import { registerUsersRoutes } from './users'
import { registerBoardsRoutes } from './boards'
import { registerReportsRoutes } from './reports'
import { registerNotificationsRoutes } from './notifications'

export function registerCommunityRoutes() {
  registerPostsRoutes()
  registerLikesRoutes()
  registerMessagesRoutes()
  registerCirclesRoutes()
  registerUsersRoutes()
  registerBoardsRoutes()
  registerReportsRoutes()
  registerNotificationsRoutes()
}
