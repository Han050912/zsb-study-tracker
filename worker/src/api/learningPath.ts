import type { Env } from '../index'
import { on } from '../router'
import { all } from '../db'
import { getSettings } from './settings'

/**
 * 学习路径推荐（P2-4）：基于用户考试日期（user_settings.exam_date）+ 科目权重，
 * 生成周学习计划卡。计划为「建议值」而非硬约束——按每日目标时长 × 科目权重占比，
 * 把时间分配到各科目；前端可一键分享到社区求监督。
 */

/** 今日（UTC+8）的 YYYY-MM-DD，与 db.ts utc8Today 同口径 */
function utc8Today(): string {
  return new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10)
}

export function registerLearningPathRoutes() {
  on('GET', '/api/learning-path', true, async (ctx) => {
    const settings = await getSettings(ctx.env, ctx.userId)
    const subjects = await all<{ id: string; name: string; icon: string; weight: number }>(ctx.env,
      'SELECT id, name, icon, weight FROM subjects WHERE user_id = ? ORDER BY weight DESC, id ASC',
      ctx.userId)

    // 距离考试天数：未设置返回 null；已过期可为负（前端据此提示「考试已结束/临近冲刺」）
    let daysLeft: number | null = null
    if (settings.examDate) {
      const exam = new Date(settings.examDate + 'T00:00:00+08:00')
      const today = new Date(utc8Today() + 'T00:00:00+08:00')
      daysLeft = Math.floor((exam.getTime() - today.getTime()) / 86400_000)
    }

    // 按科目权重占比分配每日目标时长（无权重科目按 0 处理；全部为 0 时均分兜底）
    const totalWeight = subjects.reduce((s, x) => s + (x.weight || 0), 0)
    const dailyGoal = settings.dailyGoalMinutes || 240
    const plan = subjects.map(s => {
      const ratio = totalWeight > 0 ? (s.weight || 0) / totalWeight : 1 / Math.max(subjects.length, 1)
      return {
        id: s.id,
        name: s.name,
        icon: s.icon,
        weight: s.weight || 0,
        dailyMinutes: Math.max(Math.round(dailyGoal * ratio), totalWeight > 0 && s.weight > 0 ? 10 : 0)
      }
    })

    return Response.json({
      examDate: settings.examDate || null,
      daysLeft,
      dailyGoalMinutes: dailyGoal,
      subjects: plan,
      weeklyTotalMinutes: dailyGoal * 7
    })
  })
}
