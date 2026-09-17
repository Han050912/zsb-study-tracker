import { request, requestKeepalive } from './client'
import type { Gamification } from '../types'

/**
 * 记录级增量同步协议层（设计 §4）：
 * - `POST /api/data/push`：提交 outbox 里全部待推送变更（各域 upserts/deletes + 积分事件 + 成就）
 * - `POST /api/data/pull`：`full: true` 全量快照 / 带游标增量（游标契约见设计 §4.2）
 *
 * 关键约束（T6 也需遵守）：
 * - 单表数组域（records/problemSessions/.../todos）upsert 项**即记录本身**（键取记录自身 id）；
 *   复杂域（subjects/habits/summaries/settings/pomodoro/english）为 `{ key, value, updatedAt }` 包装。
 * - 客户端**不推送** `gamification` 域（服务端权威，推送会 400），只读响应回传的快照。
 * - `versions` 是信息性字段（诊断/展示），**不是**游标：游标取 pull 响应里 `changes[domain].seq`
 *   （本次该域实际收到的记录/墓碑中最大的 server_seq/seq）。
 */

/** 积分事件（设计 §5.1）：award 按 refId 幂等落账；revoke 支持 refId 精确、refPrefix 前缀与 all 全量撤销 */
export interface PointsEvent {
  op: 'award' | 'revoke'
  refId?: string
  refPrefix?: string
  /** revoke：一次性撤销服务端全部有 ref_id 的流水（无 ref_id 的历史流水不可撤销）；与 refId/refPrefix 互斥 */
  all?: true
  points?: number
  reason?: string
  date?: string
}

/** 删除墓碑（推送与拉取同一形状） */
export interface SyncDeletion {
  key: string
  deletedAt: number
}

/** 单域推送载荷 */
interface DomainPushPayload {
  upserts: unknown[]
  deletes: SyncDeletion[]
}

/** push 请求体 */
interface PushPayload {
  domains: Record<string, DomainPushPayload>
  /** 积分事件（与记录变更同一 batch 原子提交） */
  points?: PointsEvent[]
  /** 本次客户端判定解锁的成就 id（服务端只做只增不减的集合并集） */
  achievements?: string[]
}

/** push 响应 */
interface PushResponse {
  ok: boolean
  /** 各域本次写入的 server_seq（信息性字段，**不得**用作拉取游标） */
  versions: Record<string, number>
  applied: Record<string, number>
  deletes: Record<string, number>
  /** 因客户端时钟超前被钳制的条数 */
  clamped: number
  /** 被 LWW 判负的条目（本地不回滚，待下次拉取覆盖） */
  rejected: { domain: string; key: string; reason: 'older' | 'deleted' }[]
  /** 本次实际新落账的积分条目（服务端已有同 refId 的不计入） */
  awarded?: { points: number; reason: string }[]
  /** 服务端权威游戏化快照（每次推送都回传） */
  gamification?: Gamification
}

/** 拉取到的单域变更；`seq` = 本次实际收到记录/墓碑的最大序号（客户端游标基准） */
export interface DomainChanges {
  seq: number
  upserts: unknown[]
  deletes: SyncDeletion[]
}

/** pull 响应（full 与增量同一形状；空域不出现） */
export interface PullResponse {
  full: boolean
  versions: Record<string, number>
  changes: Record<string, DomainChanges>
  gamification?: Gamification
}

export const syncApi = {
  /** 提交 outbox 里的全部待推送变更（记录级 upsert/delete + 积分事件 + 成就） */
  pushChanges: (payload: PushPayload) =>
    request<PushResponse>('/api/data/push', { method: 'POST', body: JSON.stringify(payload) }),

  /** 拉取变更：`full: true` 全量快照；否则按游标增量 */
  pullChanges: (options: { full?: boolean; cursors?: Record<string, number> }) =>
    request<PullResponse>('/api/data/pull', { method: 'POST', body: JSON.stringify(options) }),

  /**
   * 页面卸载兜底：keepalive 推送（不读取响应，故 outbox 必须保留到下次同步确认）。
   * 载荷超过 keepalive 上限时 client.requestKeepalive 内部跳过并告警。
   */
  pushChangesBeacon: (payload: PushPayload) => requestKeepalive('/api/data/push', payload)
}
