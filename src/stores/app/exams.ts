/**
 * app store 的 exams 域模块：真题/套卷 CRUD。仅 import staging 纯函数与 services；
 * 不 import 其他 app 域模块的 actions（跨域调用一律走 this）。
 */

import type { AppStoreThis } from './this-type'
import { uid } from '../../utils/date'
import { stageDelete } from '../../services/syncOutbox'
import { touchRecord } from './staging'
import type { ExamRecord } from '../../types'

/** 显式签名（不含 this 参数）：断开 AppStoreThis 与字面量推断的类型循环，原理见 sync.ts 顶部注释 */
type ExamsActionsShape = {
  addExam(e: Omit<ExamRecord, 'id'>): void
  deleteExam(id: string): void
}

export const examsActions: ExamsActionsShape = {
  addExam(this: AppStoreThis, e: Omit<ExamRecord, 'id'>) {
    const id = uid()
    const exam: ExamRecord = { ...e, id }
    this.exams.push(exam)
    this.addPoints(20, '完成真题/套卷', id)
    touchRecord('exams', exam)
    this.save()
  },

  deleteExam(this: AppStoreThis, id: string) {
    // 删除墓碑到达后服务端自动撤销积分（设计 §5.1），本地回收即可
    this.revokePointsByRef(id)
    const e = this.exams.find((x) => x.id === id)
    this.exams = this.exams.filter((x) => x.id !== id)
    if (e) stageDelete('exams', id, Date.now())
    this.save()
  }
}
