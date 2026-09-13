/**
 * app store 的 habits 域模块：习惯 CRUD 与打卡（含 updateHabitTarget 与 settings 每日目标的双向同步原逻辑）。
 * 仅 import staging 纯函数、静态数据与 services；不 import 其他 app 域模块的 actions（跨域调用一律走 this）。
 */

import type { AppStoreThis } from './this-type'
import { VOCAB_HABIT_ID, PROBLEM_HABIT_ID } from '../../data/defaults'
import { uid, today } from '../../utils/date'
import { stageDelete } from '../../services/syncOutbox'
import { touchRecord, touchSettings } from './staging'
import type { Habit } from '../../types'

/** 显式签名（不含 this 参数）：断开 AppStoreThis 与字面量推断的类型循环，原理见 sync.ts 顶部注释 */
type HabitsActionsShape = {
  addHabit(h: Omit<Habit, 'id' | 'records'>): void
  deleteHabit(id: string): void
  recordHabit(id: string, date: string, value: number | string): void
  toggleBadHabitCheckin(id: string, date: string): void
  updateHabitTarget(id: string, target: number): void
}

export const habitsActions: HabitsActionsShape = {
  addHabit(this: AppStoreThis, h: Omit<Habit, 'id' | 'records'>) {
    const habit: Habit = { ...h, id: uid(), records: {} }
    this.habits.push(habit)
    // habits 键 = habitId，值 = 单个习惯（含 records/checkins）
    touchRecord('habits', habit)
    this.save()
  },

  deleteHabit(this: AppStoreThis, id: string) {
    // 回收该习惯全部打卡积分并删除对应流水（服务端删习惯时按 habit:<key>:% 自动撤销，本地回收即可）
    this.revokePointsByRefPrefix(`habit:${id}:`)
    const h = this.habits.find((x) => x.id === id)
    this.habits = this.habits.filter((x) => x.id !== id)
    if (h) stageDelete('habits', id, Date.now())
    this.save()
  },

  /** 记录习惯打卡；好习惯当天从「未完成」变为「完成」奖励 +2 积分，取消完成则全额回收（历史日期仅记数据，不动积分） */
  recordHabit(this: AppStoreThis, id: string, date: string, value: number | string) {
    const h = this.habits.find((x) => x.id === id)
    if (!h) return
    const hadValue = !!h.records[date]
    h.records[date] = value
    if (!h.bad && date === today()) {
      const refId = `habit:${id}:${date}`
      if (value && !hadValue) this.addPoints(2, `完成习惯「${h.name}」`, refId)
      // 取消打卡为非删除场景：服务端不会自动撤销 → 必须显式发 revoke 事件
      else if (!value && hadValue) this.revokePointsByRef(refId, true)
    }
    // 坏习惯发生记录与克制打卡互斥：记录发生即视为当天未克制
    if (h.bad && Number(value) > 0 && h.checkins?.[date]) delete h.checkins[date]
    touchRecord('habits', h)
    this.save()
  },

  /** 坏习惯「每日克制打卡」：打卡/取消打卡；与发生次数互斥（打卡视为当天未犯，清除当天发生记录） */
  toggleBadHabitCheckin(this: AppStoreThis, id: string, date: string) {
    const h = this.habits.find((x) => x.id === id)
    if (!h || !h.bad) return
    if (!h.checkins) h.checkins = {}
    if (h.checkins[date]) {
      delete h.checkins[date]
    } else {
      h.checkins[date] = 1
      delete h.records[date]
    }
    // 坏习惯克制打卡不动积分
    touchRecord('habits', h)
    this.save()
  },

  /** 单独修改习惯目标；「每日背单词」「每日做题」按固定 id 与设置页每日目标双向同步 */
  updateHabitTarget(this: AppStoreThis, id: string, target: number) {
    const h = this.habits.find((x) => x.id === id)
    if (!h) return
    const t = Math.max(1, Math.round(target) || 1)
    h.target = t
    touchRecord('habits', h)
    if (id === VOCAB_HABIT_ID) {
      this.settings.wordGoal = t
      touchSettings(this.settings)
    }
    if (id === PROBLEM_HABIT_ID) {
      this.settings.problemGoal = t
      touchSettings(this.settings)
    }
    this.save()
  }
}
