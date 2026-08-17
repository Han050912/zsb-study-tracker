import type { Env } from '../index'
import { on, body } from '../router'
import { all, first, batch, run, uid, utc8Today, HttpError } from '../db'
import { getSubjectTree, subjectDeleteStatements, subjectInsertStatements } from './subjects'
import { getHabits, habitReplaceStatements } from './habits'
import { getGamification, gamificationReplaceStatements, serverAwardStatements } from './gamification'
import { getPomodoro, pomodoroReplaceStatements } from './pomodoro'
import { getSettings, settingsReplaceStatements } from './settings'
import { awardBadge } from './badges'
import { recordsMapping } from './records'
import { problemsMapping } from './problems'
import { errorsMapping } from './errors'
import { examsMapping } from './exams'
import { notesMapping } from './notes'
import { vocabMapping } from './vocab'
import { readingMapping, listeningMapping, templatesMapping } from './english'
import { materialsMapping } from './materials'
import { todosMapping } from './todos'

/**
 * 全量数据同步：
 * - GET /api/data/sync：拉取该用户全部数据，组装为前端 AppState 同构 JSON
 * - POST /api/data/sync：接收 AppState 全量快照，先删后插整体替换（DB.batch 原子提交）
 */

/** 简单单表（id + user_id）的拉取/替换复用各实体的 mapping */
const SIMPLE_TABLES = [
  { key: 'records', mapping: recordsMapping.mapping },
  { key: 'problemSessions', mapping: problemsMapping.mapping },
  { key: 'errorQuestions', mapping: errorsMapping.mapping },
  { key: 'exams', mapping: examsMapping.mapping },
  { key: 'notes', mapping: notesMapping.mapping },
  { key: 'materials', mapping: materialsMapping.mapping },
  { key: 'todos', mapping: todosMapping.mapping }
] as const

const ENGLISH_TABLES = [
  { key: 'vocab', mapping: vocabMapping.mapping },
  { key: 'reading', mapping: readingMapping.mapping },
  { key: 'listening', mapping: listeningMapping.mapping },
  { key: 'templates', mapping: templatesMapping.mapping }
] as const

async function pullAll(env: Env, userId: string) {
  const [subjects, habits, gamification, pomodoro, settings, summaries] = await Promise.all([
    getSubjectTree(env, userId),
    getHabits(env, userId),
    getGamification(env, userId),
    getPomodoro(env, userId),
    getSettings(env, userId),
    all(env, 'SELECT * FROM daily_summaries WHERE user_id = ?', userId)
  ])

  const state: Record<string, unknown> = { subjects, habits, gamification, pomodoro, settings }

  for (const t of SIMPLE_TABLES) {
    const rows = await all(env, `SELECT * FROM ${t.mapping.table} WHERE user_id = ?`, userId)
    state[t.key] = rows.map(t.mapping.fromRow)
  }

  const english: Record<string, unknown> = {}
  for (const t of ENGLISH_TABLES) {
    const rows = await all(env, `SELECT * FROM ${t.mapping.table} WHERE user_id = ?`, userId)
    english[t.key] = rows.map(t.mapping.fromRow)
  }
  state.english = english

  const summaryMap: Record<string, unknown> = {}
  for (const r of summaries as any[]) {
    summaryMap[r.date] = { date: r.date, mood: r.mood, harvest: r.harvest, improve: r.improve, plan: r.plan }
  }
  state.summaries = summaryMap

  return state
}

/** 生成全量替换语句：先清空该用户全部数据表，再按快照逐条插入 */
function pushAllStatements(env: Env, userId: string, state: any): D1PreparedStatement[] {
  const stmts: D1PreparedStatement[] = []

  // 1. 删除：科目树与简单单表（习惯/游戏化/番茄钟由各自的替换 helper 自带删除）
  stmts.push(...subjectDeleteStatements(env, userId))
  for (const t of [...SIMPLE_TABLES, ...ENGLISH_TABLES]) {
    stmts.push(env.DB.prepare(`DELETE FROM ${t.mapping.table} WHERE user_id = ?`).bind(userId))
  }
  stmts.push(env.DB.prepare('DELETE FROM daily_summaries WHERE user_id = ?').bind(userId))

  // 2. 插入：科目树
  for (const s of state.subjects ?? []) {
    stmts.push(...subjectInsertStatements(env, userId, s))
  }

  // 3. 插入：简单单表
  for (const t of SIMPLE_TABLES) {
    for (const item of state[t.key] ?? []) {
      const row = t.mapping.toRow(userId, item, item.id || uid())
      const keys = Object.keys(row).filter(k => row[k] !== undefined)
      stmts.push(env.DB.prepare(
        `INSERT INTO ${t.mapping.table} (${keys.map(k => `"${k}"`).join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`
      ).bind(...keys.map(k => row[k])))
    }
  }
  for (const t of ENGLISH_TABLES) {
    for (const item of state.english?.[t.key] ?? []) {
      const row = t.mapping.toRow(userId, item, item.id || uid())
      const keys = Object.keys(row).filter(k => row[k] !== undefined)
      stmts.push(env.DB.prepare(
        `INSERT INTO ${t.mapping.table} (${keys.map(k => `"${k}"`).join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`
      ).bind(...keys.map(k => row[k])))
    }
  }

  // 4. 替换：习惯（含打卡记录，helper 自带删除）
  stmts.push(...habitReplaceStatements(env, userId, state.habits ?? []))

  // 5. 插入：每日总结
  for (const s of Object.values<any>(state.summaries ?? {})) {
    stmts.push(
      env.DB.prepare('INSERT INTO daily_summaries (user_id, date, mood, harvest, improve, plan) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(userId, s.date, s.mood ?? '', s.harvest ?? '', s.improve ?? '', s.plan ?? '')
    )
  }

  // 6. 替换：游戏化（upsert 单行 + 流水重写）
  if (state.gamification) {
    stmts.push(...gamificationReplaceStatements(env, userId, state.gamification))
  }

  // 7. 替换：番茄钟
  if (state.pomodoro) {
    stmts.push(...pomodoroReplaceStatements(env, userId, state.pomodoro))
  }

  // 8. 用户设置（upsert，不清空）
  if (state.settings) {
    stmts.push(...settingsReplaceStatements(env, userId, state.settings))
  }

  return stmts
}

export function registerSyncRoutes() {
  on('GET', '/api/data/sync', true, async (ctx) => {
    return Response.json(await pullAll(ctx.env, ctx.userId))
  })

  on('POST', '/api/data/sync', true, async (ctx) => {
    const state = await body(ctx.request)
    if (!state || typeof state !== 'object') throw new HttpError(400, '快照格式错误')

    // 服务端积分规则（基于推送快照检测，refId 去重保证每日/每档仅发放一次）。
    // 发放语句排在全量替换之后执行，避免被 gamification 行覆盖冲掉
    const awardStmts: D1PreparedStatement[] = []
    const awarded: { points: number; reason: string }[] = []
    const today = utc8Today()
    const award = async (points: number, reason: string, refId: string) => {
      const dup = await first(ctx.env, 'SELECT id FROM points_log WHERE user_id = ? AND ref_id = ?', ctx.userId, refId)
      if (dup) return
      awardStmts.push(...serverAwardStatements(ctx.env, ctx.userId, points, reason, refId))
      awarded.push({ points, reason })
    }
    // 每日学习时长满 60 分钟 +3
    const todayMinutes = (Array.isArray(state.records) ? state.records : [])
      .filter((r: any) => r?.date === today)
      .reduce((s: number, r: any) => s + (Number(r?.minutes) || 0), 0)
    if (todayMinutes >= 60) await award(3, '学习时长满 60 分钟', `srv:study-minutes:${today}`)
    // 连续打卡里程碑：7 天 +5 / 30 天 +10 / 100 天 +20
    const streak = Number(state.gamification?.streak) || 0
    for (const [days, pts] of [[7, 5], [30, 10], [100, 20]] as const) {
      if (streak >= days) await award(pts, `连续打卡 ${days} 天`, `srv:streak:${days}`)
    }

    // 全量替换前记录现存 PDF 笔记，替换后清理已删笔记的 D1 孤儿分片
    const before = await all(ctx.env, "SELECT id FROM notes WHERE user_id = ? AND type = 'pdf'", ctx.userId)
    await batch(ctx.env, [...pushAllStatements(ctx.env, ctx.userId, state), ...awardStmts])
    const keep = new Set(
      (state.notes ?? []).filter((n: any) => n?.type === 'pdf').map((n: any) => String(n.id))
    )
    const orphans = (before as any[])
      .filter((r) => !keep.has(String(r.id)))
      .map((r) => String(r.id))
    if (orphans.length) {
      // 单条 SQL 批量删除孤儿分片，原子性由 D1 保证
      const placeholders = orphans.map(() => '?').join(',')
      await run(ctx.env, `DELETE FROM pdf_chunks WHERE user_id = ? AND pdf_id IN (${placeholders})`, ctx.userId, ...orphans)
    }
    // 连续打卡里程碑徽章（与积分同机触发，主键去重保证仅发放一次；放在全量替换之后避免中间态）
    for (const days of [7, 30, 100] as const) {
      if (streak >= days) await awardBadge(ctx.env, ctx.userId, `streak_${days}`)
    }
    // 发放了新积分时回传最新 gamification，前端据此刷新本地，避免下次推送用旧总值覆盖
    const res: Record<string, unknown> = { ok: true }
    if (awarded.length) {
      res.awarded = awarded
      res.gamification = await getGamification(ctx.env, ctx.userId)
    }
    return Response.json(res)
  })
}
