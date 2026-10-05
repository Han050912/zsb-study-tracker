/**
 * app store 的 settings 域模块：设置更新/自定义名言/头像，以及每日总结保存（saveSummary，按拆分计划归入本模块）。
 * 仅 import staging 纯函数、静态数据与 services；不 import 其他 app 域模块的 actions（跨域调用一律走 this）。
 */

import type { AppStoreThis } from './this-type'
import type { AppState } from '../../types'
import { VOCAB_HABIT_ID, PROBLEM_HABIT_ID } from '../../data/defaults'
import { today } from '../../utils/date'
import { stageUpsert } from '../../services/syncOutbox'
import { touchRecord, touchSettings } from './staging'
import type { DailySummary } from '../../types'
import { settingsGoalError, type GoalKey } from '../../utils/settingsValidation'
import { sessionUser } from '../../services/auth'
import { restoreOnboarding } from '../../services/onboarding'

/** 显式签名（不含 this 参数）：断开 AppStoreThis 与字面量推断的类型循环，原理见 sync.ts 顶部注释 */
type SettingsActionsShape = {
  saveSummary(s: DailySummary): void
  updateSettings(patch: Partial<AppState['settings']>): void
  updateQuotes(quotes: string[]): void
  setAvatar(url: string): void
}

export const settingsActions: SettingsActionsShape = {
  saveSummary(this: AppStoreThis, s: DailySummary) {
    const isNew = !this.summaries[s.date]
    const summary: DailySummary = { ...s, updatedAt: Date.now() }
    this.summaries[s.date] = summary
    // 仅当天首次保存总结时奖励积分，重复编辑不重复加分
    if (s.date === today() && isNew) this.addPoints(5, '完成每日总结', `summary:${s.date}`)
    // summaries 键 = 日期
    stageUpsert('summaries', s.date, summary, summary.updatedAt!)
    this.save()
  },

  updateSettings(this: AppStoreThis, patch: Partial<AppState['settings']>) {
    // 校验先于本地写入和 outbox 打点，避免一项非法目标阻塞所有学习数据的同步。
    for (const key of ['dailyGoalMinutes', 'wordGoal', 'problemGoal'] as GoalKey[]) {
      if (patch[key] === undefined) continue
      const error = settingsGoalError(key, patch[key])
      if (error) throw new Error(error)
    }
    Object.assign(this.settings, patch)
    restoreOnboarding(sessionUser.value?.id ?? null, this.settings)
    // 每日目标与习惯列表「每日背单词」「每日做题」按固定 id 实时双向同步
    if (patch.wordGoal !== undefined) {
      const h = this.habits.find((x) => x.id === VOCAB_HABIT_ID && !x.bad)
      if (h) {
        h.target = patch.wordGoal
        touchRecord('habits', h)
      }
    }
    if (patch.problemGoal !== undefined) {
      const h = this.habits.find((x) => x.id === PROBLEM_HABIT_ID && !x.bad)
      if (h) {
        h.target = patch.problemGoal
        touchRecord('habits', h)
      }
    }
    // settings 键 = self（整体 stage；maimemoToken 空值语义见 touchSettings 注释）
    touchSettings(this.settings)
    this.save()
  },

  /** 替换自定义名言列表（settings 整行随 self 上行；maimemoToken 空值语义见 touchSettings 注释） */
  updateQuotes(this: AppStoreThis, quotes: string[]) {
    if (quotes.some((q) => typeof q !== 'string' || q.length > 200)) throw new Error('单条自定义引言最多 200 字')
    this.settings.quotes = quotes
    touchSettings(this.settings)
    this.save()
  },

  /** 上传端点已保存头像；本地立即更新，并让后续设置同步携带同一 URL。 */
  setAvatar(this: AppStoreThis, url: string) {
    this.settings.avatar = url
    touchSettings(this.settings)
    this.save()
  }
}
