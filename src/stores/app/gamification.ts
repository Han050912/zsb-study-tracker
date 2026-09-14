/**
 * app store 的 gamification 域模块：积分增发、积分流水回收（含内部公共实现 revokePointsWhere）、
 * 每日打卡与成就检测。仅 import 静态数据与 services；不 import 其他 app 域模块的 actions（跨域调用一律走 this）。
 */

import type { AppStoreThis } from './this-type'
import { ACHIEVEMENTS } from '../../data/defaults'
import { today, yesterday } from '../../utils/date'
import { stageAchievements, stagePoints } from '../../services/syncOutbox'

/** 显式签名（不含 this 参数）：断开 AppStoreThis 与字面量推断的类型循环，原理见 sync.ts 顶部注释 */
type GamificationActionsShape = {
  addPoints(points: number, reason: string, refId: string): void
  revokePointsWhere(match: (l: { date: string; points: number; reason: string; refId?: string }) => boolean): void
  revokePointsByRef(refId: string, sendEvent?: boolean): void
  revokePointsByRefPrefix(prefix: string, sendEvent?: boolean): void
  checkin(): void
  checkAchievements(): void
}

export const gamificationActions: GamificationActionsShape = {
  /**
   * 增加积分并记录日志（本地乐观展示）；refId 关联产生积分的原始记录。
   * 同时发送 award 积分事件随 push 同批上报（设计 §5.1）：服务端按 refId 幂等落账，
   * **refId 必须确定性**（同一事件重放/多设备重推不会重复加分），故为必填（编译期约束全部调用点）。
   */
  addPoints(this: AppStoreThis, points: number, reason: string, refId: string) {
    this.gamification.points += points
    this.gamification.pointsLog.push({ date: today(), points, reason, refId })
    stagePoints({ op: 'award', refId, points, reason, date: today() })
    this.checkAchievements()
  },

  /** 按匹配条件回收积分：总积分回滚 + 彻底删除对应积分流水（内部公共实现） */
  revokePointsWhere(
    this: AppStoreThis,
    match: (l: { date: string; points: number; reason: string; refId?: string }) => boolean
  ) {
    const logs = this.gamification.pointsLog.filter(match)
    if (!logs.length) return
    const sum = logs.reduce((s, l) => s + l.points, 0)
    this.gamification.points = Math.max(0, this.gamification.points - sum)
    this.gamification.pointsLog = this.gamification.pointsLog.filter((l) => !match(l))
  },

  /**
   * 回收某条原始记录对应的全部积分（本地乐观回收）。
   * `sendEvent`：是否同时发送 revoke 事件——
   * - 删除引发的回收：records/problemSessions/exams/habits 由服务端按删除墓碑自动撤销（§5.1），不发事件避免冗余；
   * - 非删除场景（取消打卡/取消完成待办）与服务端无自动撤销的域（todos/english）：必须发事件，否则他端流水不回收。
   */
  revokePointsByRef(this: AppStoreThis, refId: string, sendEvent = false) {
    this.revokePointsWhere((l) => l.refId === refId)
    if (sendEvent) stagePoints({ op: 'revoke', refId })
  },

  /** 按 refId 前缀回收积分（用于删除习惯等聚合记录；sendEvent 语义同 revokePointsByRef） */
  revokePointsByRefPrefix(this: AppStoreThis, prefix: string, sendEvent = false) {
    this.revokePointsWhere((l) => !!l.refId?.startsWith(prefix))
    if (sendEvent) stagePoints({ op: 'revoke', refPrefix: prefix })
  },

  /** 打卡：更新连胜（本地乐观值；streak/lastCheckin 以服务端快照为权威，push/pull 响应到达即覆盖） */
  checkin(this: AppStoreThis) {
    const t = today()
    if (this.gamification.lastCheckin === t) return
    this.gamification.streak = this.gamification.lastCheckin === yesterday() ? this.gamification.streak + 1 : 1
    this.gamification.lastCheckin = t
    // 确定性 refId：每日一次，跨设备/重放幂等
    this.addPoints(10, '每日打卡', `checkin:${t}`)
  },

  /** 成就检测 */
  checkAchievements(this: AppStoreThis) {
    const has = (id: string) => this.gamification.achievements.includes(id)
    const unlock = (id: string) => {
      if (!has(id)) {
        this.gamification.achievements.push(id)
        // 成就上报走 push 的 achievements 字段（服务端只增不减并集，§5.2），随下次 push 同批上报
        stageAchievements([id])
        const def = ACHIEVEMENTS.find((a) => a.id === id)
        window.dispatchEvent(new CustomEvent('achievement', { detail: def }))
      }
    }
    if (this.gamification.points > 0) unlock('first_checkin')
    if (this.gamification.streak >= 7) unlock('streak_7')
    if (this.gamification.streak >= 30) unlock('streak_30')
    if (this.totalMinutes >= 100 * 60) unlock('hours_100')
    if (this.errorQuestions.reduce((s, e) => s + e.reviewCount, 0) >= 50) unlock('error_50')
    if (this.totalProblems >= 1000) unlock('problems_1000')
    if (this.gamification.points >= 5000) unlock('points_5000')
    const totalPomo = Object.values(this.pomodoro.daily).reduce((s, d) => s + d.count, 0)
    if (totalPomo >= 50) unlock('pomodoro_50')
    const todaySubjects = new Set(this.todayRecords.map((r) => r.subjectId))
    if (this.subjects.length > 0 && this.subjects.every((s) => todaySubjects.has(s.id))) unlock('all_subjects')
    const morning = this.habits.find((h) => h.name.includes('晨读'))
    if (morning) {
      let cnt = 0
      for (let i = 0; i < 7; i++) {
        const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10)
        if (morning.records[d]) cnt++
      }
      if (cnt >= 7) unlock('early_bird')
    }
  }
}
