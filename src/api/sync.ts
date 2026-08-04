import { request, requestKeepalive } from './client'
import type { AppState } from '../types'

/** 全量数据同步：启动拉取 / 变更后防抖推送 */
export const syncApi = {
  pullAll: () => request<AppState>('/api/data/sync'),
  pushAll: (state: AppState) =>
    request<{ ok: boolean }>('/api/data/sync', { method: 'POST', body: JSON.stringify(state) }),
  /** 页面卸载兜底推送（keepalive，不读响应） */
  pushAllBeacon: (state: AppState) => requestKeepalive('/api/data/sync', state)
}
