import { request, requestKeepalive } from './client'
import type { AppState, Gamification } from '../types'

/** 推送响应：服务端发放新积分（学习时长/连续打卡里程碑）时携带最新 gamification */
export interface PushResult {
  ok: boolean
  awarded?: { points: number; reason: string }[]
  gamification?: Gamification
}

/**
 * 推送前剥离服务端来源的积分流水（refId 以 'srv:' 前缀标记）：
 * 服务端会保留这些流水，回传会导致重复；本地仅做展示，推送时剔除。
 */
function stripServerLog(state: AppState): AppState {
  const log = state.gamification?.pointsLog
  if (!log?.some(l => l.refId?.startsWith('srv:'))) return state
  return {
    ...state,
    gamification: { ...state.gamification, pointsLog: log.filter(l => !l.refId?.startsWith('srv:')) }
  }
}

/** 全量数据同步：启动拉取 / 变更后防抖推送 */
export const syncApi = {
  pullAll: () => request<AppState>('/api/data/sync'),
  pushAll: (state: AppState) =>
    request<PushResult>('/api/data/sync', { method: 'POST', body: JSON.stringify(stripServerLog(state)) }),
  /** 页面卸载兜底推送（keepalive，不读响应） */
  pushAllBeacon: (state: AppState) => requestKeepalive('/api/data/sync', stripServerLog(state))
}
