/**
 * app store 的导入导出域模块：导出/导入/清空与旧版数据迁移（全域最重的跨域动作，函数体逐字保留）。
 * 仅 import staging 纯函数、services 与静态数据；不 import 其他 app 域模块的 actions（跨域调用一律走 this）。
 */

import type { AppStoreThis } from './this-type'
import { createDefaultState } from '../../data/defaults'
import { uid, today } from '../../utils/date'
import { stageAchievements, stagePoints } from '../../services/syncOutbox'
import { getNoteBody, queueNoteBody, clearAllNoteBodies } from '../../services/noteBodies'
import { stageAllDeletes, stageAllUpserts, stageLogAwards, touchRecord } from './staging'
import type { AppState } from '../../types'

/** 显式签名（不含 this 参数）：断开 AppStoreThis 与字面量推断的类型循环，原理见 sync.ts 顶部注释 */
type ImportExportActionsShape = {
  migrateLegacyData(): void
  exportJSON(): Promise<string>
  importJSON(json: string): boolean
  clearAll(): void
}

/** 备份文本的形状：state 快照 + 笔记正文（正文不在 $state 内，导出时单独携带） */
type Backup = AppState & { noteBodies?: Record<string, { content: string; updatedAt: number }> }

/** 备份必需字段：数组域（导入会逐条打删除墓碑并逐条上行） */
const BACKUP_ARRAY_FIELDS = [
  'subjects',
  'records',
  'problemSessions',
  'errorQuestions',
  'exams',
  'notes',
  'materials',
  'todos',
  'habits'
] as const

/** 备份必需字段：对象域 */
const BACKUP_OBJECT_FIELDS = ['settings', 'summaries', 'english', 'gamification', 'pomodoro'] as const

/** 纯对象判定（数组与 null 不算），用于对象域的字段 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/** 数组域判定：元素必须是可以取字段的对象（导入逐条读 `record.id` 的运行时前提） */
function isRecordArray(value: unknown): boolean {
  return Array.isArray(value) && value.every(isPlainObject)
}

/**
 * 备份结构校验：导入是「先给全部旧记录打删除墓碑、再写入新数据」且会即时推送到云端，
 * 误判的代价是**不可恢复的数据清空**，因此只有确认「是本系统的备份」才允许进入导入流程——
 * 任意合法 JSON（`package.json`、其它软件的配置）一律拒绝。
 * 逐层校验导入流程真正消费到的形状：缺任何一层都会在打完墓碑之后才抛错，留下无法回滚的删除。
 */
export function isValidBackup(data: unknown): data is Backup {
  if (!isPlainObject(data)) return false
  if (!BACKUP_ARRAY_FIELDS.every((field) => isRecordArray(data[field]))) return false
  if (!BACKUP_OBJECT_FIELDS.every((field) => isPlainObject(data[field]))) return false
  const english = data.english as Record<string, unknown>
  const pomodoro = data.pomodoro as Record<string, unknown>
  const gamification = data.gamification as Record<string, unknown>
  return (
    ['vocab', 'reading', 'listening', 'templates'].every((field) => isRecordArray(english[field])) &&
    isPlainObject(pomodoro.daily) &&
    isRecordArray(pomodoro.interruptions) &&
    isRecordArray(pomodoro.records) &&
    Array.isArray(gamification.achievements)
  )
}

/** 解析并校验备份文本：JSON 语法错误或结构不符一律返回 null */
export function parseBackup(json: string): Backup | null {
  try {
    const parsed: unknown = JSON.parse(json)
    return isValidBackup(parsed) ? parsed : null
  } catch {
    return null
  }
}

export const importExportActions: ImportExportActionsShape = {
  /** 导出/导入/清空 */
  /** 导出：状态快照 + 笔记正文（正文存 IndexedDB/云端分片，不在 $state 内，需单独收集） */
  async exportJSON(this: AppStoreThis): Promise<string> {
    const bodies: Record<string, { content: string; updatedAt: number }> = {}
    for (const note of this.notes) {
      if (note.type === 'pdf') continue
      const content = getNoteBody(note.id)
      if (content) bodies[note.id] = { content, updatedAt: note.bodyUpdatedAt }
    }
    return JSON.stringify({ ...this.$state, noteBodies: bodies }, null, 2)
  },

  importJSON(this: AppStoreThis, json: string): boolean {
    // 结构校验必须先于任何 stageAllDeletes / stagePoints：校验失败时绝不允许落下删除墓碑
    const data = parseBackup(json)
    if (!data) return false
    try {
      const now = Date.now()
      // 记录级协议没有整域替换：旧状态中被整批覆盖的记录逐条 stage 删除墓碑
      stageAllDeletes(this.$state, now)
      // gamification 服务端权威、不可整域推送：先以 all 事件一次性清空服务端流水（无 ref_id 的旧流水不可撤销，保持），
      // 导入的新流水随后由 stageLogAwards 以 award 事件补齐，服务端 points = SUM(log) 与导入结果一致
      stagePoints({ op: 'revoke', all: true })
      this.$patch({ ...createDefaultState(), ...data })
      this.migrateLegacyData()
      // 恢复笔记正文：新备份单独携带 noteBodies；旧版备份退回 Note.content 内联字段。
      // 缺少 bodyUpdatedAt 的旧笔记恢复正文时前移时间戳，保证正文上传与服务端 LWW 判定必胜
      for (const note of this.notes) {
        if (note.type === 'pdf') continue
        const body = data.noteBodies?.[note.id]
        const content = body?.content ?? (note as { content?: string }).content
        if (!content) continue
        if (!note.bodyUpdatedAt) {
          note.updatedAt = Math.max(note.updatedAt + 1, now)
          note.bodyUpdatedAt = note.updatedAt
        }
        queueNoteBody(note.id, content, note.bodyUpdatedAt)
      }
      // 导入后的全部记录逐条打点上行（migrateLegacyData 已补打其改写的记录与流水事件）
      stageAllUpserts(this.$state, now)
      // 导入的成就以只增不减并集上报（服务端成就不可移除，§5.2）
      stageAchievements([...this.gamification.achievements])
      stageLogAwards(this.gamification.pointsLog)
      this.save()
      return true
    } catch (e) {
      console.error('导入备份失败', e)
      return false
    }
  },

  clearAll(this: AppStoreThis) {
    const now = Date.now()
    // 旧数据逐条 stage 删除墓碑（服务端对 habits/records 等的删除会自动撤销关联积分）
    stageAllDeletes(this.$state, now)
    // 以 all 事件一次性撤销服务端全部有 ref_id 的流水 → 服务端 points = SUM(log) 归零
    // （无 ref_id 的旧流水按语义不可撤销，保持；不依赖回传快照是否完整）
    stagePoints({ op: 'revoke', all: true })
    clearAllNoteBodies()
    this.$patch(createDefaultState())
    // 默认数据（内置科目/习惯/设置）作为新状态整体上行，对齐旧「整域替换」语义
    stageAllUpserts(this.$state, now)
    this.save()
  },

  /**
   * 旧版本数据迁移：
   * 1. 背单词记录由「按天合并」升级为「逐条打卡」，补齐 id/points；
   * 2. 英语阅读/听力记录补齐 id；
   * 3. 优先「认领」旧的无 refId 积分流水（盖章关联，不新增行，避免积分流水虚增）；
   *    仅当无匹配旧流水时才补写 refId 流水，保证删除旧记录时积分可精确回收。
   */
  migrateLegacyData(this: AppStoreThis) {
    try {
      if (!this.english) return
      if (!Array.isArray(this.gamification.pointsLog)) this.gamification.pointsLog = []
      const log = this.gamification.pointsLog
      let changed = false
      // 回填旧版自定义科目缺失的 id（旧版 addSubject 未生成 id，JSON 序列化后字段丢失，会导致路由坍塌）
      if (Array.isArray(this.subjects)) {
        for (const s of this.subjects) {
          let subjectChanged = false
          if (s && !s.id) {
            s.id = uid()
            changed = true
            subjectChanged = true
          }
          // 旧版数据无知识点重要程度字段，补齐避免空指针
          if (s && !s.topicImportance) {
            s.topicImportance = {}
            changed = true
            subjectChanged = true
          }
          // 被改写的科目逐条打点进 outbox
          if (subjectChanged) touchRecord('subjects', s)
        }
      }
      /** 为单条记录建立流水关联：认领一条匹配的旧流水；无法认领则补写 */
      const claim = (r: { id?: string; date: string }, points: number, reason: string) => {
        if (!r.id) {
          r.id = uid()
          changed = true
        }
        if (log.some((l) => l.refId === r.id)) return
        const orphan = log.find((l) => !l.refId && l.reason === reason && l.date === r.date)
        if (orphan) {
          orphan.refId = r.id
          changed = true
        } else if (points > 0) {
          log.push({ date: r.date || today(), points, reason, refId: r.id })
          changed = true
        }
      }
      if (Array.isArray(this.english.vocab)) {
        for (const v of this.english.vocab) {
          if (!v) continue
          if (!v.id) {
            v.id = uid()
            changed = true
          }
          if (v.points === undefined) {
            v.points = Math.round(((Number(v.newWords) || 0) + (Number(v.reviewWords) || 0)) / 20)
            changed = true
          }
          if (log.some((l) => l.refId === v.id)) continue
          // 旧模型按天合并：该日全部无 refId 的「背单词」流水统一认领给这条记录
          const orphans = log.filter((l) => !l.refId && l.reason === '背单词' && l.date === v.date)
          if (orphans.length) {
            for (const o of orphans) o.refId = v.id
            changed = true
          } else if (v.points > 0) {
            log.push({ date: v.date || today(), points: v.points, reason: '背单词', refId: v.id })
            changed = true
          }
        }
      }
      if (Array.isArray(this.english.reading)) {
        for (const r of this.english.reading) if (r) claim(r, 5, '阅读训练')
      }
      if (Array.isArray(this.english.listening)) {
        for (const l of this.english.listening) if (l) claim(l, Math.round((Number(l.minutes) || 0) / 10), '听力练习')
      }
      // 迁移产生的本地流水（认领盖章 + 补写行）以 award 事件补齐服务端（设计 §5.1）：
      // 服务端按 refId 幂等去重，重复推送安全；无 refId 的旧流水无法上报（保持本地）
      if (changed) stageLogAwards(log)
      if (changed) this.save()
    } catch (e) {
      console.error('迁移旧版数据失败', e)
    }
  }
}
