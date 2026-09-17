// 组队挑战域路由注册聚合入口：16 条小组路由（teams.ts）+ 6 条挑战路由（challenges.ts）
import { registerTeamsRoutes } from './teams'
import { registerChallengeRoutes } from './challenges'

export function registerTeamRoutes() {
  registerTeamsRoutes()
  registerChallengeRoutes()
}
