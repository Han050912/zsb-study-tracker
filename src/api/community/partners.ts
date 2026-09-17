import { request, authFetch } from '../client'
import type {
  PartnerItem,
  PartnerPlan,
  PartnerPlanDetail,
  PartnerReview,
  PartnerShareDetail,
  PartnerShareItem,
  PartnerShareNoteItem,
  PartnerStudyRecord,
  PartnerStudySession,
  PartnerSuggestion,
  PartnerWeeklyReport
} from '../../types'

export const partnersApi = {
  /** 学习搭子推荐 */
  partnerSuggestions: () => request<{ suggestions: PartnerSuggestion[] }>('/api/community/partners/suggestions'),
  /** 我的搭子 + 收到的请求 */
  partners: () => request<{ partners: PartnerItem[]; incoming: PartnerItem[] }>('/api/community/partners'),
  /** 发起搭子请求 */
  sendPartner: (userId: string) =>
    request<{ accepted: boolean }>(`/api/community/partners/${userId}`, { method: 'POST' }),
  /** 接受/拒绝请求 */
  respondPartner: (requestId: string, action: 'accept' | 'reject') =>
    request<{ ok: boolean }>(`/api/community/partners/${requestId}`, {
      method: 'PUT',
      body: JSON.stringify({ action })
    }),
  /** 一键解绑搭子（无需对方同意） */
  unbindPartner: (userId: string) =>
    request<{ ok: boolean }>(`/api/community/partners/${userId}`, { method: 'DELETE' }),
  /** 搭子周报对比（受对方隐私开关管控） */
  partnerWeeklyReport: (userId: string) =>
    request<PartnerWeeklyReport>(`/api/community/partners/${userId}/weekly-report`),
  /** 发送学习鼓励提醒 */
  partnerRemind: (userId: string) =>
    request<{ ok: boolean }>(`/api/community/partners/${userId}/remind`, { method: 'POST' }),
  // ========== 错题/笔记定向分享 ==========
  createPartnerShare: (partnerId: string, itemType: 'error' | 'note', itemId: string, force = false) =>
    request<{ id: string; duplicate?: boolean }>('/api/partner-shares', {
      method: 'POST',
      body: JSON.stringify({ partnerId, itemType, itemId, force })
    }),
  partnerShares: () =>
    request<{ received: PartnerShareItem[]; sent: PartnerShareItem[]; hasMore?: boolean; nextCursor?: string | null }>(
      '/api/partner-shares'
    ),
  partnerShare: (id: string) => request<PartnerShareDetail>(`/api/partner-shares/${id}`),
  /** 分享 PDF 原文（受分享权限保护，供预览渲染）。大文件慢网下载，给 300s 长超时，与 pdfs.ts 下载同口径 */
  partnerSharePdf: async (id: string): Promise<Uint8Array> => {
    const res = await authFetch(`/api/partner-shares/${id}/pdf`, {}, undefined, 300_000)
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: '加载 PDF 失败' }))
      throw Object.assign(new Error(err.message || `HTTP ${res.status}`), { status: res.status })
    }
    return new Uint8Array(await res.arrayBuffer())
  },
  /** 分享的错题配图（受分享权限保护，经代理返回字节）。同为二进制下载，长超时避免慢网被默认 30s 截断 */
  partnerShareImage: async (id: string): Promise<Blob> => {
    const res = await authFetch(`/api/partner-shares/${id}/image`, {}, undefined, 300_000)
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: '加载图片失败' }))
      throw Object.assign(new Error(err.message || `HTTP ${res.status}`), { status: res.status })
    }
    return res.blob()
  },
  /** 复制分享的笔记到我的笔记，返回新笔记 */
  copyPartnerShare: (id: string, subjectId: string) =>
    request<PartnerShareNoteItem & { updatedAt: number; bodyUpdatedAt: number }>(`/api/partner-shares/${id}/copy`, {
      method: 'POST',
      body: JSON.stringify({ subjectId })
    }),
  // ========== 双人番茄自习室 ==========
  createStudySession: (partnerId: string, mode: 'countdown' | 'countup', focusMinutes?: number) =>
    request<{ id: string }>('/api/partner-study/sessions', {
      method: 'POST',
      body: JSON.stringify({ partnerId, mode, focusMinutes })
    }),
  activeStudySession: () => request<{ session: PartnerStudySession | null }>('/api/partner-study/sessions/active'),
  studySession: (id: string) => request<{ session: PartnerStudySession }>(`/api/partner-study/sessions/${id}`),
  updateStudySession: (
    id: string,
    state: 'idle' | 'focus' | 'done',
    minutes: number,
    onlineSeconds: number,
    elapsedSeconds?: number,
    running?: boolean
  ) =>
    request<{ session: PartnerStudySession }>(`/api/partner-study/sessions/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ state, minutes, onlineSeconds, elapsedSeconds, running })
    }),
  endStudySession: (id: string) => request<{ ok: boolean }>(`/api/partner-study/sessions/${id}`, { method: 'DELETE' }),
  /** 历史开黑记录（我参与且已结束的会话，按结束时间倒序） */
  studyHistory: () => request<{ records: PartnerStudyRecord[] }>('/api/partner-study/sessions/history'),
  // ========== 协作备考计划 ==========
  createPartnerPlan: (partnerId: string, title: string) =>
    request<{ id: string }>('/api/partner-plans', { method: 'POST', body: JSON.stringify({ partnerId, title }) }),
  partnerPlans: () => request<{ items: PartnerPlan[] }>('/api/partner-plans'),
  partnerPlan: (id: string) => request<PartnerPlanDetail>(`/api/partner-plans/${id}`),
  updatePartnerPlan: (id: string, title: string) =>
    request<{ ok: boolean }>(`/api/partner-plans/${id}`, { method: 'PUT', body: JSON.stringify({ title }) }),
  deletePartnerPlan: (id: string) => request<{ ok: boolean }>(`/api/partner-plans/${id}`, { method: 'DELETE' }),
  addPlanTask: (planId: string, title: string, phase: string) =>
    request<{ id: string }>(`/api/partner-plans/${planId}/tasks`, {
      method: 'POST',
      body: JSON.stringify({ title, phase })
    }),
  updatePlanTask: (planId: string, taskId: string, done: boolean) =>
    request<{ ok: boolean }>(`/api/partner-plans/${planId}/tasks/${taskId}`, {
      method: 'PUT',
      body: JSON.stringify({ done })
    }),
  deletePlanTask: (planId: string, taskId: string) =>
    request<{ ok: boolean }>(`/api/partner-plans/${planId}/tasks/${taskId}`, { method: 'DELETE' }),
  // ========== 双向复盘邀约 ==========
  createPartnerReview: (partnerId: string, scheduledAt: number) =>
    request<{ id: string }>('/api/partner-reviews', {
      method: 'POST',
      body: JSON.stringify({ partnerId, scheduledAt })
    }),
  partnerReviews: () => request<{ items: PartnerReview[] }>('/api/partner-reviews'),
  updatePartnerReview: (id: string, action: 'accept' | 'done', note?: string) =>
    request<{ ok: boolean }>(`/api/partner-reviews/${id}`, { method: 'PUT', body: JSON.stringify({ action, note }) }),
  deletePartnerReview: (id: string) => request<{ ok: boolean }>(`/api/partner-reviews/${id}`, { method: 'DELETE' })
}
