/**
 * app store 的 errors 域模块：错题 CRUD 与存量错题图片迁移（migrateErrorImages）。
 * 仅 import staging 纯函数、services/api；不 import 其他 app 域模块的 actions（跨域调用一律走 this）。
 */

import type { AppStoreThis } from './this-type'
import { uid } from '../../utils/date'
import { stageDelete } from '../../services/syncOutbox'
import { touchRecord } from './staging'
import { ERROR_IMAGE_PREFIX, dataUrlToBytes, uploadErrorImage } from '../../api/errorImages'
import type { ErrorQuestion } from '../../types'

/** 显式签名（不含 this 参数）：断开 AppStoreThis 与字面量推断的类型循环，原理见 sync.ts 顶部注释 */
type ErrorsActionsShape = {
  addErrorQuestion(q: Omit<ErrorQuestion, 'id' | 'createdAt' | 'reviewCount' | 'mastered'>): void
  reviewError(id: string): boolean
  toggleErrorMastered(id: string): void
  deleteError(id: string): void
  migrateErrorImages(): Promise<void>
}

export const errorsActions: ErrorsActionsShape = {
  addErrorQuestion(this: AppStoreThis, q: Omit<ErrorQuestion, 'id' | 'createdAt' | 'reviewCount' | 'mastered'>) {
    const question: ErrorQuestion = { ...q, id: uid(), createdAt: Date.now(), reviewCount: 0, mastered: false }
    this.errorQuestions.push(question)
    touchRecord('errorQuestions', question)
    this.save()
  },

  /**
   * 复习一次：复习次数始终 +1（供「复习次数」统计与 error_50 成就），但**每道题只计一次复习积分**。
   * refId 保持确定性的 `error:<id>`，与服务端删除时的撤销口径（pointsRefOfDeleted → `error:<key>`）一致；
   * 只在首次复习时发放积分，避免重复复习的 award 被服务端按 ref_id 幂等过滤后，
   * 本地 +2 又被权威快照抹掉的「先跳后落」（issue #32）。
   * @returns 本次是否发放了积分（true=首次复习），供 UI 对齐提示文案使「提示 == 实际到账」。
   */
  reviewError(this: AppStoreThis, id: string): boolean {
    const q = this.errorQuestions.find((e) => e.id === id)
    if (!q) return false
    const firstReview = q.reviewCount === 0
    q.reviewCount++
    touchRecord('errorQuestions', q)
    if (firstReview) this.addPoints(2, '复习错题', `error:${id}`)
    this.save()
    return firstReview
  },

  toggleErrorMastered(this: AppStoreThis, id: string) {
    const q = this.errorQuestions.find((e) => e.id === id)
    if (q) {
      q.mastered = !q.mastered
      touchRecord('errorQuestions', q)
      this.save()
    }
  },

  deleteError(this: AppStoreThis, id: string) {
    // 服务端对 errorQuestions 的删除按 ref_id = 'error:<key>' 自动撤销积分（设计 §5.1），本地回收即可
    this.revokePointsByRef(`error:${id}`)
    const q = this.errorQuestions.find((e) => e.id === id)
    this.errorQuestions = this.errorQuestions.filter((e) => e.id !== id)
    if (q) stageDelete('errorQuestions', id, Date.now())
    this.save()
  },

  /**
   * 存量错题图片迁移：base64 dataURL → 内容寻址对象存储引用（'r2:<sha256>'）。
   * 幂等设计（第一优先级）：
   * - id 由服务端按落盘字节计算，重复执行/多设备并发只会覆盖同一对象与同一引用；
   * - 已完成（r2:）的条目直接跳过，中断后下次 hydrate 续跑；
   * - 单条失败只记日志，不影响其余条目，下次 hydrate 重试。
   */
  async migrateErrorImages(this: AppStoreThis) {
    const targets = this.errorQuestions.filter((q) => q.image?.startsWith('data:'))
    if (!targets.length) return
    let changed = false
    for (const q of targets) {
      try {
        const bytes = dataUrlToBytes(q.image!)
        const id = await uploadErrorImage(bytes)
        q.image = ERROR_IMAGE_PREFIX + id
        // 被改写的记录逐条打点进 outbox（hydrate 后随 flushOutbox 上行）
        touchRecord('errorQuestions', q)
        changed = true
      } catch (e) {
        console.error('错题图片迁移失败', q.id, e)
      }
    }
    if (changed) this.save()
  }
}
