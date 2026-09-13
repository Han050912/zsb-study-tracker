/**
 * app store 的 pomodoro 域模块：番茄记录、打断记录与描述编辑。
 * 仅 import staging 纯函数与 services；不 import 其他 app 域模块的 actions（跨域调用一律走 this）。
 */

import type { AppStoreThis } from './this-type'
import { uid, today } from '../../utils/date'
import { stageUpsert } from '../../services/syncOutbox'
import { touchPomodoroDay, touchPomodoroRecord } from './staging'
import type { PomodoroRecord } from '../../types'

/** 显式签名（不含 this 参数）：断开 AppStoreThis 与字面量推断的类型循环，原理见 sync.ts 顶部注释 */
type PomodoroActionsShape = {
  recordPomodoro(
    minutes: number,
    description?: string,
    source?: 'solo' | 'party',
    partnerName?: string
  ): void
  updatePomodoroRecordDescription(id: string, text: string): void
  recordInterruption(reason: string): void
}

export const pomodoroActions: PomodoroActionsShape = {
  recordPomodoro(this: AppStoreThis, minutes: number, description = '', source: 'solo' | 'party' = 'solo', partnerName?: string) {
    if (minutes < 1) return
    const t = today()
    const now = Date.now()
    if (!this.pomodoro.daily[t]) this.pomodoro.daily[t] = { count: 0, minutes: 0, interruptions: 0 }
    this.pomodoro.daily[t].count++
    this.pomodoro.daily[t].minutes += minutes
    // 旧账号云端数据可能缺 records 字段，兜底初始化
    if (!Array.isArray(this.pomodoro.records)) this.pomodoro.records = []
    const record: PomodoroRecord = { id: uid(), date: t, time: now, minutes, description, source, partnerName }
    this.pomodoro.records.push(record)
    // 积分 refId = 本次番茄记录 id（每次完成必新建记录，天然确定性幂等）
    this.addPoints(5, '完成番茄钟', record.id)
    // 涉及两个键：day:<date>（日统计）与 rec:<id>（单条记录）
    touchPomodoroDay(this.pomodoro.daily, t, now)
    touchPomodoroRecord(record, now)
    this.save()
  },

  /** 双击编辑今日番茄记录的任务描述（清空存空串，展示层回退「未命名」） */
  updatePomodoroRecordDescription(this: AppStoreThis, id: string, text: string) {
    const r = this.pomodoro.records?.find((x) => x.id === id)
    if (r && r.date === today()) {
      r.description = text.trim().slice(0, 50)
      touchPomodoroRecord(r)
      this.save()
    }
  },

  recordInterruption(this: AppStoreThis, reason: string) {
    const t = today()
    const now = Date.now()
    if (!this.pomodoro.daily[t]) this.pomodoro.daily[t] = { count: 0, minutes: 0, interruptions: 0 }
    this.pomodoro.daily[t].interruptions++
    // 打断条目在运行时打 updatedAt（T5 约定：itr:<date> 键的 LWW 时间戳 = 当日各行最大 updatedAt；类型上不声明）
    this.pomodoro.interruptions.push(Object.assign({ date: t, reason, time: now }, { updatedAt: now }))
    // itr:<date>：该日打断列表**整体** stage（值 [{reason,time}]，整体替换语义，设计 §4.2）
    const dayItems = this.pomodoro.interruptions.filter((it) => it.date === t)
    stageUpsert(
      'pomodoro',
      `itr:${t}`,
      dayItems.map((it) => ({ reason: it.reason, time: it.time })),
      now
    )
    // 日统计的 interruptions 计数同步变化 → 一并 stage day:<date>（服务端写 itr 不联动 pomodoro_daily）
    touchPomodoroDay(this.pomodoro.daily, t, now)
    this.save()
  }
}
