import { request } from './client'
import type { Gamification } from '../types'

/** gamification（积分/streak/成就）为服务端权威，客户端只读（写入走 POST /api/data/push 的 points/achievements） */
export const gamificationApi = {
  get: () => request<Gamification>('/api/gamification')
}
