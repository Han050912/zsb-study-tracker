/**
 * app store 的 problems 域模块：刷题会话 CRUD。仅 import staging 纯函数与 services；
 * 不 import 其他 app 域模块的 actions（跨域调用一律走 this）。
 */

import type { AppStoreThis } from './this-type'
import { uid } from '../../utils/date'
import { stageDelete } from '../../services/syncOutbox'
import { touchRecord } from './staging'
import type { ProblemSession } from '../../types'

/** 显式签名（不含 this 参数）：断开 AppStoreThis 与字面量推断的类型循环，原理见 sync.ts 顶部注释 */
type ProblemsActionsShape = {
  addProblemSession(p: Omit<ProblemSession, 'id'>): void
  deleteProblemSession(id: string): void
}

export const problemsActions: ProblemsActionsShape = {
  addProblemSession(this: AppStoreThis, p: Omit<ProblemSession, 'id'>) {
    const id = uid()
    const session: ProblemSession = { ...p, id }
    this.problemSessions.push(session)
    const pts = Math.round(p.total / 5)
    if (pts > 0) this.addPoints(pts, `刷题 ${p.total} 道`, id)
    touchRecord('problemSessions', session)
    this.save()
  },

  deleteProblemSession(this: AppStoreThis, id: string) {
    // 删除墓碑到达后服务端自动撤销积分（设计 §5.1），本地回收即可
    this.revokePointsByRef(id)
    const p = this.problemSessions.find((x) => x.id === id)
    this.problemSessions = this.problemSessions.filter((x) => x.id !== id)
    if (p) stageDelete('problemSessions', id, Date.now())
    this.save()
  }
}
