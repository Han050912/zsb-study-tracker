/**
 * app store 的 records 域模块：学习记录 CRUD。仅 import staging 纯函数与 services；
 * 不 import 其他 app 域模块的 actions（跨域调用一律走 this，如积分回收 this.revokePointsByRef）。
 */

import type { AppStoreThis } from './this-type'
import { uid } from '../../utils/date'
import { stageDelete } from '../../services/syncOutbox'
import { touchRecord } from './staging'
import type { StudyRecord } from '../../types'

/** 显式签名（不含 this 参数）：断开 AppStoreThis 与字面量推断的类型循环，原理见 sync.ts 顶部注释 */
type RecordsActionsShape = {
  addRecord(rec: Omit<StudyRecord, 'id' | 'createdAt'>): void
  deleteRecord(id: string): void
}

export const recordsActions: RecordsActionsShape = {
  addRecord(this: AppStoreThis, rec: Omit<StudyRecord, 'id' | 'createdAt'>) {
    const id = uid()
    const record: StudyRecord = { ...rec, id, createdAt: Date.now() }
    this.records.push(record)
    this.checkin()
    this.addPoints(Math.max(1, Math.round(rec.minutes / 10)), `学习 ${rec.minutes} 分钟`, id)
    touchRecord('records', record)
    this.save()
  },

  deleteRecord(this: AppStoreThis, id: string) {
    // 本地回收即可：删除墓碑到达后服务端自动撤销该记录积分（设计 §5.1），无需重复发 revoke 事件
    this.revokePointsByRef(id)
    const rec = this.records.find((r) => r.id === id)
    this.records = this.records.filter((r) => r.id !== id)
    if (rec) stageDelete('records', id, Date.now())
    this.save()
  }
}
