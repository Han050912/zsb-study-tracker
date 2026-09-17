/**
 * app store 的 subjects 域模块：科目/章节/知识点维护（含 removeSubject 跨域级联删除，函数体逐字保留）。
 * 仅 import staging 纯函数、静态数据与 services；不 import 其他 app 域模块的 actions（跨域调用一律走 this）。
 */

import type { AppStoreThis } from './this-type'
import { defaultSubjects } from '../../data/defaults'
import { uid } from '../../utils/date'
import { stageDelete } from '../../services/syncOutbox'
import { touchRecord } from './staging'
import type { Subject, TopicImportance } from '../../types'

/** 显式签名（不含 this 参数）：断开 AppStoreThis 与字面量推断的类型循环，原理见 sync.ts 顶部注释 */
type SubjectsActionsShape = {
  setMastery(subjectId: string, topic: string, level: number): void
  addSubject(s: Omit<Subject, 'id' | 'chapters' | 'mastery' | 'topicImportance' | 'builtin'>): void
  restoreDefaultSubjects(): number
  updateSubjectWeight(id: string, weight: number): void
  removeSubject(id: string): void
  addChapter(subjectId: string, name: string): void
  updateChapter(subjectId: string, chapterId: string, name: string): boolean
  addTopic(subjectId: string, chapterId: string, topic: string): void
  removeTopic(subjectId: string, chapterId: string, topic: string): void
  removeChapter(subjectId: string, chapterId: string): void
  updateTopic(
    subjectId: string,
    chapterId: string,
    oldTopic: string,
    newTopic: string,
    importance?: TopicImportance
  ): boolean
}

export const subjectsActions: SubjectsActionsShape = {
  setMastery(this: AppStoreThis, subjectId: string, topic: string, level: number) {
    const s = this.subjects.find((x) => x.id === subjectId)
    if (s) {
      s.mastery[topic] = level
      // subjects 键 = subjectId，值 = 科目整棵聚合（含 chapters/topics）
      touchRecord('subjects', s)
      this.save()
    }
  },

  addSubject(this: AppStoreThis, s: Omit<Subject, 'id' | 'chapters' | 'mastery' | 'topicImportance' | 'builtin'>) {
    // 必须生成唯一 id，否则动态路由 /subject/:id 与导航将全部指向 /subject/undefined
    const subject: Subject = { ...s, id: uid(), builtin: false, chapters: [], mastery: {}, topicImportance: {} }
    this.subjects.push(subject)
    touchRecord('subjects', subject)
    this.save()
  },

  /** 恢复被删除的内置科目：仅补回缺失的，不覆盖已存在（含已改名）的内置科目，不影响自定义科目与错题数据。返回恢复数量 */
  restoreDefaultSubjects(this: AppStoreThis): number {
    const existingIds = new Set(this.subjects.map((x) => x.id))
    let restored = 0
    for (const d of defaultSubjects()) {
      if (!existingIds.has(d.id)) {
        const subject: Subject = { ...d }
        this.subjects.push(subject)
        touchRecord('subjects', subject)
        restored++
      }
    }
    if (restored > 0) this.save()
    return restored
  },

  /** 修改任意科目的考核权重百分比 */
  updateSubjectWeight(this: AppStoreThis, id: string, weight: number) {
    const s = this.subjects.find((x) => x.id === id)
    if (s) {
      s.weight = Math.min(100, Math.max(0, Math.round(weight) || 0))
      touchRecord('subjects', s)
      this.save()
    }
  },

  /** 删除科目：级联删除其学习记录/刷题/真题/错题/笔记等关联数据，并逐条回收这些数据产生的积分 */
  removeSubject(this: AppStoreThis, id: string) {
    const now = Date.now()
    // 本地积分回收：records/problemSessions/exams/errorQuestions 的删除由服务端按墓碑自动撤销流水（§5.1），
    // 不发 revoke 事件（避免冗余）；english 域服务端无自动撤销 → 显式发事件
    for (const r of this.records.filter((x) => x.subjectId === id)) this.revokePointsByRef(r.id)
    for (const p of this.problemSessions.filter((x) => x.subjectId === id)) this.revokePointsByRef(p.id)
    for (const e of this.exams.filter((x) => x.subjectId === id)) this.revokePointsByRef(e.id)
    for (const q of this.errorQuestions.filter((x) => x.subjectId === id)) this.revokePointsByRef(`error:${q.id}`)
    // 内置英语科目的专项数据（词汇/阅读/听力）一并清理并回收积分
    if (id === 'english') {
      for (const v of this.english.vocab) {
        this.revokePointsByRef(v.id, true)
        stageDelete('english', `vocab:${v.id}`, now)
      }
      for (const r of this.english.reading)
        if (r.id) {
          this.revokePointsByRef(r.id, true)
          stageDelete('english', `reading:${r.id}`, now)
        }
      for (const l of this.english.listening)
        if (l.id) {
          this.revokePointsByRef(l.id, true)
          stageDelete('english', `listening:${l.id}`, now)
        }
      this.english = { vocab: [], reading: [], listening: [], templates: [] }
    }
    // 先收集受影响记录再过滤（stage 墓碑需要原对象的 id）
    const delRecords = this.records.filter((x) => x.subjectId === id)
    const delSessions = this.problemSessions.filter((x) => x.subjectId === id)
    const delExams = this.exams.filter((x) => x.subjectId === id)
    const delErrors = this.errorQuestions.filter((x) => x.subjectId === id)
    const delNotes = this.notes.filter((n) => n.subjectId === id)
    this.subjects = this.subjects.filter((s) => s.id !== id)
    this.records = this.records.filter((r) => r.subjectId !== id)
    this.problemSessions = this.problemSessions.filter((p) => p.subjectId !== id)
    this.exams = this.exams.filter((e) => e.subjectId !== id)
    this.errorQuestions = this.errorQuestions.filter((q) => q.subjectId !== id)
    this.notes = this.notes.filter((n) => n.subjectId !== id)
    // 资料仅解除科目关联，不删除资料本身
    for (const m of this.materials)
      if (m.subjectId === id) {
        m.subjectId = undefined
        touchRecord('materials', m, now)
      }
    // 逐条 stage 删除墓碑（服务端收到后清行 + 自动撤销对应积分/清理孤儿资源）
    for (const r of delRecords) stageDelete('records', r.id, now)
    for (const p of delSessions) stageDelete('problemSessions', p.id, now)
    for (const e of delExams) stageDelete('exams', e.id, now)
    for (const q of delErrors) stageDelete('errorQuestions', q.id, now)
    for (const n of delNotes) stageDelete('notes', n.id, now)
    stageDelete('subjects', id, now)
    this.save()
  },

  addChapter(this: AppStoreThis, subjectId: string, name: string) {
    const s = this.subjects.find((x) => x.id === subjectId)
    if (s) {
      s.chapters.push({ id: uid(), name, topics: [] })
      touchRecord('subjects', s)
      this.save()
    }
  },

  /** 重命名章节标题：内容为空或章节不存在时返回 false */
  updateChapter(this: AppStoreThis, subjectId: string, chapterId: string, name: string): boolean {
    const s = this.subjects.find((x) => x.id === subjectId)
    const ch = s?.chapters.find((c) => c.id === chapterId)
    const n = name.trim()
    if (!s || !ch || !n) return false
    ch.name = n
    touchRecord('subjects', s)
    this.save()
    return true
  },

  /** 向章节添加知识点（小标题） */
  addTopic(this: AppStoreThis, subjectId: string, chapterId: string, topic: string) {
    const s = this.subjects.find((x) => x.id === subjectId)
    const ch = s?.chapters.find((c) => c.id === chapterId)
    if (s && ch && !ch.topics.includes(topic)) {
      ch.topics.push(topic)
      touchRecord('subjects', s)
      this.save()
    }
  },

  removeTopic(this: AppStoreThis, subjectId: string, chapterId: string, topic: string) {
    const s = this.subjects.find((x) => x.id === subjectId)
    const ch = s?.chapters.find((c) => c.id === chapterId)
    if (s && ch) {
      ch.topics = ch.topics.filter((t) => t !== topic)
      delete s.mastery[topic]
      if (s.topicImportance) delete s.topicImportance[topic]
      touchRecord('subjects', s)
      this.save()
    }
  },

  removeChapter(this: AppStoreThis, subjectId: string, chapterId: string) {
    const s = this.subjects.find((x) => x.id === subjectId)
    if (s) {
      const ch = s.chapters.find((c) => c.id === chapterId)
      if (ch) {
        for (const t of ch.topics) {
          delete s.mastery[t]
          if (s.topicImportance) delete s.topicImportance[t]
        }
      }
      s.chapters = s.chapters.filter((c) => c.id !== chapterId)
      touchRecord('subjects', s)
      this.save()
    }
  },

  /**
   * 编辑知识点：支持重命名 + 调整重要程度，一次持久化。
   * 重命名时同步迁移掌握度与重要程度数据；返回 false 表示内容为空或与本章节其他知识点重名。
   */
  updateTopic(
    this: AppStoreThis,
    subjectId: string,
    chapterId: string,
    oldTopic: string,
    newTopic: string,
    importance?: TopicImportance
  ): boolean {
    const s = this.subjects.find((x) => x.id === subjectId)
    const ch = s?.chapters.find((c) => c.id === chapterId)
    if (!s || !ch) return false
    const name = newTopic.trim()
    if (!name) return false
    if (!s.topicImportance) s.topicImportance = {}
    if (name !== oldTopic) {
      if (ch.topics.includes(name)) return false
      const idx = ch.topics.indexOf(oldTopic)
      if (idx < 0) return false
      ch.topics[idx] = name
      if (s.mastery[oldTopic] !== undefined) {
        s.mastery[name] = s.mastery[oldTopic]
        delete s.mastery[oldTopic]
      }
      if (s.topicImportance[oldTopic] !== undefined) {
        s.topicImportance[name] = s.topicImportance[oldTopic]
        delete s.topicImportance[oldTopic]
      }
    }
    s.topicImportance[name] = importance || 'normal'
    touchRecord('subjects', s)
    this.save()
    return true
  }
}
