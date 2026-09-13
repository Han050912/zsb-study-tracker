import { defineStore } from 'pinia'
import { createDefaultState, LEVELS, levelOf } from '../data/defaults'
import { today, uid, daysBetween } from '../utils/date'
import {
  stageAchievements,
  stageDelete,
  stagePoints,
  stageUpsert
} from '../services/syncOutbox'
import { clearAllNoteBodies, getNoteBody, queueNoteBody } from '../services/noteBodies'
import {
  stageAllDeletes,
  stageAllUpserts,
  stageLogAwards,
  touchEnglish,
  touchPomodoroDay,
  touchPomodoroRecord,
  touchRecord
} from './app/staging'
import type {
  AppState,
  StudyRecord,
  Subject,
  Todo,
  PomodoroRecord,
  VocabRecord,
  ReadingRecord,
  ListeningRecord,
  EssayTemplate
} from '../types'

import { syncActions } from './app/sync'
import { gamificationActions } from './app/gamification'
import { recordsActions } from './app/records'
import { problemsActions } from './app/problems'
import { examsActions } from './app/exams'
import { errorsActions } from './app/errors'
import { subjectsActions } from './app/subjects'
import { notesActions } from './app/notes'
import { summariesActions } from './app/summaries'
import { habitsActions } from './app/habits'
import { settingsActions } from './app/settings'

export const useAppStore = defineStore('app', {
  // 初始为默认空数据；登录后通过 hydrate() 从云端全量拉取该用户的数据
  state: (): AppState => createDefaultState(),

  getters: {
    subjectMap(): Record<string, Subject> {
      return Object.fromEntries(this.subjects.map((s) => [s.id, s]))
    },
    todayRecords(): StudyRecord[] {
      return this.records.filter((r) => r.date === today())
    },
    todayMinutes(): number {
      return this.todayRecords.reduce((s, r) => s + r.minutes, 0)
    },
    totalMinutes(): number {
      return this.records.reduce((s, r) => s + r.minutes, 0)
    },
    totalProblems(): number {
      return this.problemSessions.reduce((s, p) => s + p.total, 0)
    },
    todayPomodoro(): { count: number; minutes: number; interruptions: number } {
      return this.pomodoro.daily[today()] || { count: 0, minutes: 0, interruptions: 0 }
    },
    todayTodos(): Todo[] {
      return this.todos.filter((t) => t.date === today()).sort((a, b) => a.order - b.order)
    },
    level(): { name: string; min: number; color: string; next?: { name: string; min: number } } {
      const cur = levelOf(this.gamification.points)
      return { ...cur, next: LEVELS[LEVELS.indexOf(cur) + 1] }
    },
    examCountdown(): number | null {
      if (!this.settings.examDate) return null
      const d = daysBetween(today(), this.settings.examDate)
      return d >= 0 ? d : null
    },

    /** 某科目某日期时长 */
    minutesByDate(): Record<string, number> {
      const map: Record<string, number> = {}
      for (const r of this.records) map[r.date] = (map[r.date] || 0) + r.minutes
      return map
    }
  },

  actions: {
    ...syncActions,
    ...gamificationActions,
    ...recordsActions,
    ...problemsActions,
    ...examsActions,
    ...errorsActions,
    ...subjectsActions,
    ...notesActions,
    ...summariesActions,
    ...habitsActions,
    ...settingsActions,

    /**
     * 旧版本数据迁移：
     * 1. 背单词记录由「按天合并」升级为「逐条打卡」，补齐 id/points；
     * 2. 英语阅读/听力记录补齐 id；
     * 3. 优先「认领」旧的无 refId 积分流水（盖章关联，不新增行，避免积分流水虚增）；
     *    仅当无匹配旧流水时才补写 refId 流水，保证删除旧记录时积分可精确回收。
     */
    migrateLegacyData() {
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
    },

    /** 新增待办；可同时指定开始时间与最晚截止时间（时间戳），到点由提醒调度器弹通知 */
    addTodo(text: string, schedule?: { startAt?: number; dueAt?: number }) {
      const maxOrder = Math.max(0, ...this.todayTodos.map((t) => t.order))
      const todo: Todo = { id: uid(), date: today(), text, done: false, order: maxOrder + 1 }
      if (schedule?.startAt) todo.startAt = schedule.startAt
      if (schedule?.dueAt) todo.dueAt = schedule.dueAt
      this.todos.push(todo)
      touchRecord('todos', todo)
      this.save()
    },
    /**
     * 设置待办的开始 / 最晚截止时间（传 null 清除）。
     * 时间被改动即清除对应的提醒去重标记，使新时间到点时重新提醒。
     */
    setTodoSchedule(id: string, schedule: { startAt?: number | null; dueAt?: number | null }) {
      const t = this.todos.find((x) => x.id === id)
      if (!t) return
      if ('startAt' in schedule) {
        if (schedule.startAt) t.startAt = schedule.startAt
        else delete t.startAt
        delete t.startNotifiedAt
      }
      if ('dueAt' in schedule) {
        if (schedule.dueAt) t.dueAt = schedule.dueAt
        else delete t.dueAt
        delete t.dueNotifiedAt
      }
      touchRecord('todos', t)
      this.save()
    },
    /** 记录提醒已发出（供提醒调度器回调），避免下次轮询重复提醒 */
    markTodosNotified(ids: string[], kind: 'start' | 'due') {
      const now = Date.now()
      for (const id of ids) {
        const t = this.todos.find((x) => x.id === id)
        if (!t) continue
        if (kind === 'start') t.startNotifiedAt = now
        else t.dueNotifiedAt = now
        touchRecord('todos', t, now)
      }
      this.save()
    },
    /** 切换待办完成状态；完成时记录完成时间并奖励积分，取消完成回收积分并清除完成时间 */
    toggleTodo(id: string) {
      const t = this.todos.find((x) => x.id === id)
      if (!t) return
      t.done = !t.done
      if (t.done) {
        t.completedAt = Date.now()
        this.addPoints(3, '完成待办', t.id)
      } else {
        delete t.completedAt
        // 取消完成为非删除场景：todos 域服务端无删除自动撤销 → 必须显式发 revoke 事件
        this.revokePointsByRef(t.id, true)
      }
      touchRecord('todos', t)
      this.save()
    },
    deleteTodo(id: string) {
      // 删除已完成待办时回收其积分；todos 域服务端无删除自动撤销 → 显式发 revoke 事件
      this.revokePointsByRef(id, true)
      const t = this.todos.find((x) => x.id === id)
      this.todos = this.todos.filter((x) => x.id !== id)
      if (t) stageDelete('todos', id, Date.now())
      this.save()
    },
    /**
     * 按拖拽后得到的新顺序排列今日待办：重新分配 order 并去重保存。
     * orderedIds 为拖拽结束后期望的顺序（仅今日待办 id）；未在列表中的今日待办保持原位追加在末尾。
     */
    reorderTodos(orderedIds: string[]) {
      const list = this.todayTodos
      const byId = new Map(list.map((t) => [t.id, t]))
      let order = 1
      const seen = new Set<string>()
      const touched = new Set<string>()
      for (const id of orderedIds) {
        const t = byId.get(id)
        if (t) {
          t.order = order++
          seen.add(id)
          touched.add(id)
        }
      }
      // 兜底：列表中存在但未被传入的今日待办，按原顺序追加在末尾
      for (const t of list) {
        if (!seen.has(t.id)) {
          t.order = order++
          touched.add(t.id)
        }
      }
      // 顺序变动过的待办逐条打点
      for (const id of touched) {
        const t = this.todos.find((x) => x.id === id)
        if (t) touchRecord('todos', t)
      }
      this.save()
    },

    recordPomodoro(minutes: number, description = '', source: 'solo' | 'party' = 'solo', partnerName?: string) {
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
    updatePomodoroRecordDescription(id: string, text: string) {
      const r = this.pomodoro.records?.find((x) => x.id === id)
      if (r && r.date === today()) {
        r.description = text.trim().slice(0, 50)
        touchPomodoroRecord(r)
        this.save()
      }
    },
    recordInterruption(reason: string) {
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
    },

    /** 背单词逐条打卡：每次背诵单独生成一条记录 */
    addVocabRecord(newWords: number, reviewWords: number) {
      const points = Math.round((newWords + reviewWords) / 20)
      const record: VocabRecord = { id: uid(), date: today(), newWords, reviewWords, points }
      this.english.vocab.push(record)
      if (points > 0) this.addPoints(points, '背单词', record.id)
      touchEnglish('vocab', record)
      this.save()
    },
    /** 删除单条背单词打卡记录：积分全额回收 + 删除对应积分流水（english 域服务端无删除自动撤销 → 发 revoke 事件） */
    deleteVocabRecord(id: string) {
      this.revokePointsByRef(id, true)
      const v = this.english.vocab.find((x) => x.id === id)
      this.english.vocab = this.english.vocab.filter((x) => x.id !== id)
      if (v) stageDelete('english', `vocab:${id}`, Date.now())
      this.save()
    },

    /** 保存阅读训练记录（+5 积分，refId 关联） */
    addReadingRecord(wpm: number, accuracy: number) {
      const record: ReadingRecord = { id: uid(), date: today(), wpm, accuracy }
      this.english.reading.push(record)
      this.addPoints(5, '阅读训练', record.id!)
      touchEnglish('reading', record)
      this.save()
    },

    /** 保存听力练习记录（每 10 分钟 +1 积分，refId 关联） */
    addListeningRecord(minutes: number, material: string, mode: '精听' | '泛听') {
      const record: ListeningRecord = { id: uid(), date: today(), minutes, material, mode }
      this.english.listening.push(record)
      const pts = Math.round(minutes / 10)
      if (pts > 0) this.addPoints(pts, '听力练习', record.id!)
      touchEnglish('listening', record)
      this.save()
    },

    /** 保存作文模板（新增或编辑）；english 键 = template:<id> */
    saveEssayTemplate(tpl: Omit<EssayTemplate, 'id' | 'updatedAt'> & { id?: string }) {
      const ts = Date.now()
      if (tpl.id) {
        const t = this.english.templates.find((x) => x.id === tpl.id)
        if (!t) return
        Object.assign(t, tpl)
        touchEnglish('templates', t, ts)
      } else {
        const created: EssayTemplate = { ...tpl, id: uid() }
        this.english.templates.push(created)
        touchEnglish('templates', created, ts)
      }
      this.save()
    },
    /** 删除作文模板；english 键 = template:<id>（english 域无关联积分，删除无需积分事件） */
    deleteEssayTemplate(id: string) {
      const t = this.english.templates.find((x) => x.id === id)
      this.english.templates = this.english.templates.filter((x) => x.id !== id)
      if (t) stageDelete('english', `template:${id}`, Date.now())
      this.save()
    },

    /** 导出/导入/清空 */
    /** 导出：状态快照 + 笔记正文（正文存 IndexedDB/云端分片，不在 $state 内，需单独收集） */
    async exportJSON(): Promise<string> {
      const bodies: Record<string, { content: string; updatedAt: number }> = {}
      for (const note of this.notes) {
        if (note.type === 'pdf') continue
        const content = getNoteBody(note.id)
        if (content) bodies[note.id] = { content, updatedAt: note.bodyUpdatedAt }
      }
      return JSON.stringify({ ...this.$state, noteBodies: bodies }, null, 2)
    },
    importJSON(json: string): boolean {
      try {
        const data = JSON.parse(json) as AppState & {
          noteBodies?: Record<string, { content: string; updatedAt: number }>
        }
        const now = Date.now()
        // 记录级协议没有整域替换：旧状态中被整批覆盖的记录逐条 stage 删除墓碑
        stageAllDeletes(this.$state, now)
        // gamification 服务端权威、不可整域推送：对将被覆盖的旧流水按 refId 撤销（新流水随后以事件补齐）
        for (const l of this.gamification.pointsLog) if (l.refId) stagePoints({ op: 'revoke', refId: l.refId })
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
      } catch {
        return false
      }
    },
    clearAll() {
      const now = Date.now()
      // 旧数据逐条 stage 删除墓碑（服务端对 habits/records 等的删除会自动撤销关联积分）
      stageAllDeletes(this.$state, now)
      // 积分流水按 refId 逐条撤销 → 服务端 points = SUM(log) 归零（无 refId 的旧流水无法撤销，保持）
      for (const l of this.gamification.pointsLog) if (l.refId) stagePoints({ op: 'revoke', refId: l.refId })
      clearAllNoteBodies()
      this.$patch(createDefaultState())
      // 默认数据（内置科目/习惯/设置）作为新状态整体上行，对齐旧「整域替换」语义
      stageAllUpserts(this.$state, now)
      this.save()
    }
  }
})
