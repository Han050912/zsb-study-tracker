import { request } from './client'
import type { LearningPath } from '../types'

export const learningPathApi = {
  /** 学习路径推荐：考试倒计时 + 按科目权重分配的周学习计划 */
  get: () => request<LearningPath>('/api/learning-path')
}
