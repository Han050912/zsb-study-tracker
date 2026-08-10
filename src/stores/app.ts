import { defineStore } from 'pinia'
import { createDefaultState, ACHIEVEMENTS, LEVELS, VOCAB_HABIT_ID, PROBLEM_HABIT_ID } from '../data/defaults'
import { today, yesterday, uid, daysBetween } from '../utils/date'
import { syncApi } from '../api/sync'
import { deletePdf, PDF_REF_PREFIX } from '../api/pdfs'
import type {
  AppState, StudyRecord, ProblemSession, ErrorQuestion, ExamRecord,
  Note, DailySummary, Habit, Material, Subject, Todo, TopicImportance
} from '../types'

/** 推送防抖计时器（合并连续操作，避免每个 action 都触发一次全量推送） */
let saveTimer: ReturnType<typeof setTimeout> | null = null
const SAVE_DEBOUNCE_MS = 800

/**
 * 是否已成功从云端拉取（hydrate）过数据。
 * 未 hydrate 前禁止一切推送：此时内存是默认空状态，全量推送会覆盖云端真实数据。
 * 退出登录/切换账号（resetState）时复位，防止脏数据推送到下一个账号。
 */
let hasHydrated = false

export const useAppStore = defineStore('app', {
  // 初始为默认空数据；登录后通过 hydrate() 从云端全量拉取该用户的数据
  state: (): AppState => createDefaultState(),

  getters: {
    subjectMap(): Record<string, Subject> {
      return Object.fromEntries(this.subjects.map(s => [s.id, s]))
    },
    todayRecords(): StudyRecord[] {
      return this.records.filter(r => r.date === today())
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
      return this.todos.filter(t => t.date === today()).sort((a, b) => a.order - b.order)
    },
    level(): { name: string; min: number; color: string; next?: { name: string; min: number } } {
      let cur = LEVELS[0]
      for (const l of LEVELS) if (this.gamification.points >= l.min) cur = l
      const idx = LEVELS.indexOf(cur)
      return { ...cur, next: LEVELS[idx + 1] }
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
    /** 异步持久化当前用户数据到云端（POST /api/data/sync 全量推送）。返回是否成功。
     *  会取消未执行的防抖任务，避免与防抖推送产生新旧快照竞态。
     *  未 hydrate 时跳过推送并视为成功：内存为默认空状态，推送会覆盖云端数据（也无本地修改需要保存）。 */
    async saveAsync(): Promise<boolean> {
      if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
      if (!hasHydrated) {
        console.warn('数据尚未从云端加载，跳过本次推送')
        return true
      }
      try {
        await syncApi.pushAll(this.$state)
        return true
      } catch (e) {
        console.error('保存数据失败', e)
        return false
      }
    },

    /** 防抖触发一次后台持久化（不阻塞，用于常规增删改）。失败时打印日志。 */
    save() {
      if (!hasHydrated) return
      if (saveTimer) clearTimeout(saveTimer)
      saveTimer = setTimeout(() => {
        saveTimer = null
        this.saveAsync().then(ok => {
          if (!ok) console.error('后台保存失败，数据可能未持久化')
        })
      }, SAVE_DEBOUNCE_MS)
    },

    /** 页面卸载前兜底：若防抖窗口内还有未推送的修改，立即以 keepalive 方式发送 */
    flushSave() {
      if (!hasHydrated || !saveTimer) return
      clearTimeout(saveTimer)
      saveTimer = null
      syncApi.pushAllBeacon(this.$state)
    },

    /** 计算当前账号数据大小（按当前状态 JSON 序列化估算）。 */
    async storageUsageText(): Promise<string> {
      const bytes = new Blob([JSON.stringify(this.$state)]).size
      if (bytes < 1024) return bytes + ' B'
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
      return (bytes / 1024 / 1024).toFixed(2) + ' MB'
    },

    /** 登录后调用：从云端全量拉取该用户的历史数据；新用户（云端无任何数据）则保留默认数据并推送一次 */
    async hydrate() {
      const data = await syncApi.pullAll()
      // 新用户判定：云端全部实体均为空（任何一类实体有数据都视为老用户，避免误判覆盖）
      const isNewUser =
        !data.subjects?.length && !data.records?.length && !data.habits?.length &&
        !data.notes?.length && !data.todos?.length && !data.materials?.length &&
        !data.problemSessions?.length && !data.errorQuestions?.length && !data.exams?.length &&
        !data.english?.vocab?.length && !data.english?.reading?.length &&
        !data.english?.listening?.length && !data.english?.templates?.length &&
        !Object.keys(data.summaries ?? {}).length &&
        !Object.keys(data.pomodoro?.daily ?? {}).length && !data.pomodoro?.interruptions?.length &&
        !data.gamification?.pointsLog?.length
      if (isNewUser) {
        // 保留启动时的默认数据（内置科目/习惯/引言），推送到云端作为初始数据
        hasHydrated = true // 先置位，允许 saveAsync 推送初始数据
        await this.saveAsync()
        return
      }
      // settings 与默认值合并：云端可能缺 quotes 等字段（default_quotes 行不存在时）
      this.$patch({
        ...createDefaultState(),
        ...data,
        settings: { ...createDefaultState().settings, ...(data.settings || {}) }
      })
      hasHydrated = true
    },

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
            if (s && !s.id) { s.id = uid(); changed = true }
            // 旧版数据无知识点重要程度字段，补齐避免空指针
            if (s && !s.topicImportance) { s.topicImportance = {}; changed = true }
          }
        }
        /** 为单条记录建立流水关联：认领一条匹配的旧流水；无法认领则补写 */
        const claim = (r: { id?: string; date: string }, points: number, reason: string) => {
          if (!r.id) { r.id = uid(); changed = true }
          if (log.some(l => l.refId === r.id)) return
          const orphan = log.find(l => !l.refId && l.reason === reason && l.date === r.date)
          if (orphan) { orphan.refId = r.id; changed = true }
          else if (points > 0) {
            log.push({ date: r.date || today(), points, reason, refId: r.id })
            changed = true
          }
        }
        if (Array.isArray(this.english.vocab)) {
          for (const v of this.english.vocab) {
            if (!v) continue
            if (!v.id) { v.id = uid(); changed = true }
            if (v.points === undefined) {
              v.points = Math.round(((Number(v.newWords) || 0) + (Number(v.reviewWords) || 0)) / 20)
              changed = true
            }
            if (log.some(l => l.refId === v.id)) continue
            // 旧模型按天合并：该日全部无 refId 的「背单词」流水统一认领给这条记录
            const orphans = log.filter(l => !l.refId && l.reason === '背单词' && l.date === v.date)
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
        if (changed) this.save()
      } catch (e) {
        console.error('迁移旧版数据失败', e)
      }
    },

    /** 退出登录/切换账号时重置为空白数据；同时复位 hydrate 标志，阻止脏数据推送到下一个账号 */
    resetState() {
      hasHydrated = false
      if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
      this.$patch(createDefaultState())
    },

    /** 增加积分并记录日志；refId 关联产生积分的原始记录 id，用于删除原始记录时回收积分 */
    addPoints(points: number, reason: string, refId?: string) {
      this.gamification.points += points
      this.gamification.pointsLog.push({ date: today(), points, reason, refId })
      this.checkAchievements()
    },

    /** 按匹配条件回收积分：总积分回滚 + 彻底删除对应积分流水（内部公共实现） */
    revokePointsWhere(match: (l: { date: string; points: number; reason: string; refId?: string }) => boolean) {
      const logs = this.gamification.pointsLog.filter(match)
      if (!logs.length) return
      const sum = logs.reduce((s, l) => s + l.points, 0)
      this.gamification.points = Math.max(0, this.gamification.points - sum)
      this.gamification.pointsLog = this.gamification.pointsLog.filter(l => !match(l))
    },

    /** 回收某条原始记录对应的全部积分：总积分回滚 + 彻底删除对应积分流水 */
    revokePointsByRef(refId: string) {
      this.revokePointsWhere(l => l.refId === refId)
    },

    /** 按 refId 前缀回收积分（用于删除习惯等聚合记录时清理其全部打卡积分） */
    revokePointsByRefPrefix(prefix: string) {
      this.revokePointsWhere(l => !!l.refId?.startsWith(prefix))
    },

    /** 打卡：更新连胜 */
    checkin() {
      const t = today()
      if (this.gamification.lastCheckin === t) return
      this.gamification.streak = this.gamification.lastCheckin === yesterday()
        ? this.gamification.streak + 1
        : 1
      this.gamification.lastCheckin = t
      this.addPoints(10, '每日打卡')
    },

    addRecord(rec: Omit<StudyRecord, 'id' | 'createdAt'>) {
      const id = uid()
      this.records.push({ ...rec, id, createdAt: Date.now() })
      this.checkin()
      this.addPoints(Math.max(1, Math.round(rec.minutes / 10)), `学习 ${rec.minutes} 分钟`, id)
      this.save()
    },
    deleteRecord(id: string) {
      this.revokePointsByRef(id)
      this.records = this.records.filter(r => r.id !== id)
      this.save()
    },

    addProblemSession(p: Omit<ProblemSession, 'id'>) {
      const id = uid()
      this.problemSessions.push({ ...p, id })
      const pts = Math.round(p.total / 5)
      if (pts > 0) this.addPoints(pts, `刷题 ${p.total} 道`, id)
      this.save()
    },
    deleteProblemSession(id: string) {
      this.revokePointsByRef(id)
      this.problemSessions = this.problemSessions.filter(p => p.id !== id)
      this.save()
    },

    addErrorQuestion(q: Omit<ErrorQuestion, 'id' | 'createdAt' | 'reviewCount' | 'mastered'>) {
      this.errorQuestions.push({ ...q, id: uid(), createdAt: Date.now(), reviewCount: 0, mastered: false })
      this.save()
    },
    reviewError(id: string) {
      const q = this.errorQuestions.find(e => e.id === id)
      if (q) {
        q.reviewCount++
        this.addPoints(2, '复习错题', `error:${id}`)
        this.save()
      }
    },
    toggleErrorMastered(id: string) {
      const q = this.errorQuestions.find(e => e.id === id)
      if (q) { q.mastered = !q.mastered; this.save() }
    },
    deleteError(id: string) {
      this.revokePointsByRef(`error:${id}`)
      this.errorQuestions = this.errorQuestions.filter(e => e.id !== id)
      this.save()
    },

    addExam(e: Omit<ExamRecord, 'id'>) {
      const id = uid()
      this.exams.push({ ...e, id })
      this.addPoints(20, '完成真题/套卷', id)
      this.save()
    },
    deleteExam(id: string) {
      this.revokePointsByRef(id)
      this.exams = this.exams.filter(e => e.id !== id)
      this.save()
    },

    setMastery(subjectId: string, topic: string, level: number) {
      const s = this.subjects.find(x => x.id === subjectId)
      if (s) { s.mastery[topic] = level; this.save() }
    },

    addSubject(s: Omit<Subject, 'id' | 'chapters' | 'mastery' | 'topicImportance' | 'builtin'>) {
      // 必须生成唯一 id，否则动态路由 /subject/:id 与导航将全部指向 /subject/undefined
      this.subjects.push({ ...s, id: uid(), builtin: false, chapters: [], mastery: {}, topicImportance: {} })
      this.save()
    },
    /** 修改任意科目的考核权重百分比 */
    updateSubjectWeight(id: string, weight: number) {
      const s = this.subjects.find(x => x.id === id)
      if (s) { s.weight = Math.min(100, Math.max(0, Math.round(weight) || 0)); this.save() }
    },
    /** 删除科目：级联删除其学习记录/刷题/真题/错题/笔记等关联数据，并逐条回收这些数据产生的积分 */
    removeSubject(id: string) {
      for (const r of this.records.filter(x => x.subjectId === id)) this.revokePointsByRef(r.id)
      for (const p of this.problemSessions.filter(x => x.subjectId === id)) this.revokePointsByRef(p.id)
      for (const e of this.exams.filter(x => x.subjectId === id)) this.revokePointsByRef(e.id)
      for (const q of this.errorQuestions.filter(x => x.subjectId === id)) this.revokePointsByRef(`error:${q.id}`)
      // 内置英语科目的专项数据（词汇/阅读/听力/模板）一并清理并回收积分
      if (id === 'english') {
        for (const v of this.english.vocab) this.revokePointsByRef(v.id)
        for (const r of this.english.reading) if (r.id) this.revokePointsByRef(r.id)
        for (const l of this.english.listening) if (l.id) this.revokePointsByRef(l.id)
        this.english = { vocab: [], reading: [], listening: [], templates: [] }
      }
      this.subjects = this.subjects.filter(s => s.id !== id)
      this.records = this.records.filter(r => r.subjectId !== id)
      this.problemSessions = this.problemSessions.filter(p => p.subjectId !== id)
      this.exams = this.exams.filter(e => e.subjectId !== id)
      this.errorQuestions = this.errorQuestions.filter(q => q.subjectId !== id)
      this.notes = this.notes.filter(n => n.subjectId !== id)
      // 资料仅解除科目关联，不删除资料本身
      for (const m of this.materials) if (m.subjectId === id) m.subjectId = undefined
      this.save()
    },
    addChapter(subjectId: string, name: string) {
      const s = this.subjects.find(x => x.id === subjectId)
      if (s) { s.chapters.push({ id: uid(), name, topics: [] }); this.save() }
    },
    /** 重命名章节标题：内容为空或章节不存在时返回 false */
    updateChapter(subjectId: string, chapterId: string, name: string): boolean {
      const s = this.subjects.find(x => x.id === subjectId)
      const ch = s?.chapters.find(c => c.id === chapterId)
      const n = name.trim()
      if (!s || !ch || !n) return false
      ch.name = n
      this.save()
      return true
    },
    /** 向章节添加知识点（小标题） */
    addTopic(subjectId: string, chapterId: string, topic: string) {
      const ch = this.subjects.find(x => x.id === subjectId)?.chapters.find(c => c.id === chapterId)
      if (ch && !ch.topics.includes(topic)) { ch.topics.push(topic); this.save() }
    },
    removeTopic(subjectId: string, chapterId: string, topic: string) {
      const s = this.subjects.find(x => x.id === subjectId)
      const ch = s?.chapters.find(c => c.id === chapterId)
      if (s && ch) {
        ch.topics = ch.topics.filter(t => t !== topic)
        delete s.mastery[topic]
        if (s.topicImportance) delete s.topicImportance[topic]
        this.save()
      }
    },
    removeChapter(subjectId: string, chapterId: string) {
      const s = this.subjects.find(x => x.id === subjectId)
      if (s) {
        const ch = s.chapters.find(c => c.id === chapterId)
        if (ch) {
          for (const t of ch.topics) {
            delete s.mastery[t]
            if (s.topicImportance) delete s.topicImportance[t]
          }
        }
        s.chapters = s.chapters.filter(c => c.id !== chapterId)
        this.save()
      }
    },
    /**
     * 编辑知识点：支持重命名 + 调整重要程度，一次持久化。
     * 重命名时同步迁移掌握度与重要程度数据；返回 false 表示内容为空或与本章节其他知识点重名。
     */
    updateTopic(subjectId: string, chapterId: string, oldTopic: string, newTopic: string, importance?: TopicImportance): boolean {
      const s = this.subjects.find(x => x.id === subjectId)
      const ch = s?.chapters.find(c => c.id === chapterId)
      if (!s || !ch) return false
      const name = newTopic.trim()
      if (!name) return false
      if (!s.topicImportance) s.topicImportance = {}
      if (name !== oldTopic) {
        if (ch.topics.includes(name)) return false
        const idx = ch.topics.indexOf(oldTopic)
        if (idx < 0) return false
        ch.topics[idx] = name
        if (s.mastery[oldTopic] !== undefined) { s.mastery[name] = s.mastery[oldTopic]; delete s.mastery[oldTopic] }
        if (s.topicImportance[oldTopic] !== undefined) { s.topicImportance[name] = s.topicImportance[oldTopic]; delete s.topicImportance[oldTopic] }
      }
      s.topicImportance[name] = importance || 'normal'
      this.save()
      return true
    },

    /** 批量导入笔记（文件上传）：一次写入一次持久化，避免多文件触发多次全量保存。
     *  PDF 笔记需传入显式 id——导入前已用该 id 将原文上传至服务端 D1，content 为 'd1:<id>' 引用 */
    importNotes(subjectId: string, items: { id?: string; title: string; content: string; tags: string[]; type?: Note['type'] }[]) {
      for (const n of items) {
        this.notes.push({ id: n.id || uid(), subjectId, title: n.title || '未命名', content: n.content, tags: n.tags, updatedAt: Date.now(), type: n.type })
      }
      this.save()
    },

    saveNote(note: Partial<Note> & { subjectId: string }) {
      if (note.id) {
        const n = this.notes.find(x => x.id === note.id)
        if (n) Object.assign(n, note, { updatedAt: Date.now() })
      } else {
        this.notes.push({
          id: uid(), subjectId: note.subjectId, title: note.title || '未命名',
          content: note.content || '', tags: note.tags || [], updatedAt: Date.now(), type: note.type
        })
      }
      this.save()
    },
    deleteNote(id: string) {
      const note = this.notes.find(n => n.id === id)
      this.notes = this.notes.filter(n => n.id !== id)
      // PDF 笔记联动删除云端原文（失败静默，由全量同步的孤儿清理兜底）
      if (note?.type === 'pdf' && note.content.startsWith(PDF_REF_PREFIX)) {
        deletePdf(note.content.slice(PDF_REF_PREFIX.length)).catch(() => {})
      }
      this.save()
    },

    saveSummary(s: DailySummary) {
      const isNew = !this.summaries[s.date]
      this.summaries[s.date] = { ...s }
      // 仅当天首次保存总结时奖励积分，重复编辑不重复加分
      if (s.date === today() && isNew) this.addPoints(5, '完成每日总结', `summary:${s.date}`)
      this.save()
    },

    addHabit(h: Omit<Habit, 'id' | 'records'>) {
      this.habits.push({ ...h, id: uid(), records: {} })
      this.save()
    },
    deleteHabit(id: string) {
      // 回收该习惯全部打卡积分并删除对应流水
      this.revokePointsByRefPrefix(`habit:${id}:`)
      this.habits = this.habits.filter(h => h.id !== id)
      this.save()
    },
    /** 记录习惯打卡；好习惯当天从「未完成」变为「完成」奖励 +2 积分，取消完成则全额回收（历史日期仅记数据，不动积分） */
    recordHabit(id: string, date: string, value: number | string) {
      const h = this.habits.find(x => x.id === id)
      if (!h) return
      const hadValue = !!h.records[date]
      h.records[date] = value
      if (!h.bad && date === today()) {
        const refId = `habit:${id}:${date}`
        if (value && !hadValue) this.addPoints(2, `完成习惯「${h.name}」`, refId)
        else if (!value && hadValue) this.revokePointsByRef(refId)
      }
      // 坏习惯发生记录与克制打卡互斥：记录发生即视为当天未克制
      if (h.bad && Number(value) > 0 && h.checkins?.[date]) delete h.checkins[date]
      this.save()
    },
    /** 坏习惯「每日克制打卡」：打卡/取消打卡；与发生次数互斥（打卡视为当天未犯，清除当天发生记录） */
    toggleBadHabitCheckin(id: string, date: string) {
      const h = this.habits.find(x => x.id === id)
      if (!h || !h.bad) return
      if (!h.checkins) h.checkins = {}
      if (h.checkins[date]) {
        delete h.checkins[date]
      } else {
        h.checkins[date] = 1
        delete h.records[date]
      }
      this.save()
    },
    /** 单独修改习惯目标；「每日背单词」「每日做题」按固定 id 与设置页每日目标双向同步 */
    updateHabitTarget(id: string, target: number) {
      const h = this.habits.find(x => x.id === id)
      if (!h) return
      const t = Math.max(1, Math.round(target) || 1)
      h.target = t
      if (id === VOCAB_HABIT_ID) this.settings.wordGoal = t
      if (id === PROBLEM_HABIT_ID) this.settings.problemGoal = t
      this.save()
    },

    addMaterial(m: Omit<Material, 'id' | 'createdAt'>) {
      this.materials.push({ ...m, id: uid(), createdAt: Date.now() })
      this.save()
    },
    updateMaterial(id: string, patch: Partial<Material>) {
      const m = this.materials.find(x => x.id === id)
      if (m) { Object.assign(m, patch); this.save() }
    },
    deleteMaterial(id: string) {
      this.materials = this.materials.filter(m => m.id !== id)
      this.save()
    },

    addTodo(text: string) {
      const maxOrder = Math.max(0, ...this.todayTodos.map(t => t.order))
      this.todos.push({ id: uid(), date: today(), text, done: false, order: maxOrder + 1 })
      this.save()
    },
    /** 切换待办完成状态；完成时记录完成时间并奖励积分，取消完成回收积分并清除完成时间 */
    toggleTodo(id: string) {
      const t = this.todos.find(x => x.id === id)
      if (!t) return
      t.done = !t.done
      if (t.done) {
        t.completedAt = Date.now()
        this.addPoints(3, '完成待办', t.id)
      } else {
        delete t.completedAt
        this.revokePointsByRef(t.id)
      }
      this.save()
    },
    deleteTodo(id: string) {
      // 删除已完成待办时回收其积分
      this.revokePointsByRef(id)
      this.todos = this.todos.filter(t => t.id !== id)
      this.save()
    },
    /**
     * 按拖拽后得到的新顺序排列今日待办：重新分配 order 并去重保存。
     * orderedIds 为拖拽结束后期望的顺序（仅今日待办 id）；未在列表中的今日待办保持原位追加在末尾。
     */
    reorderTodos(orderedIds: string[]) {
      const list = this.todayTodos
      const byId = new Map(list.map(t => [t.id, t]))
      let order = 1
      const seen = new Set<string>()
      for (const id of orderedIds) {
        const t = byId.get(id)
        if (t) { t.order = order++; seen.add(id) }
      }
      // 兜底：列表中存在但未被传入的今日待办，按原顺序追加在末尾
      for (const t of list) {
        if (!seen.has(t.id)) t.order = order++
      }
      this.save()
    },

    recordPomodoro(minutes: number) {
      const t = today()
      if (!this.pomodoro.daily[t]) this.pomodoro.daily[t] = { count: 0, minutes: 0, interruptions: 0 }
      this.pomodoro.daily[t].count++
      this.pomodoro.daily[t].minutes += minutes
      this.addPoints(5, '完成番茄钟')
      this.save()
    },
    recordInterruption(reason: string) {
      const t = today()
      if (!this.pomodoro.daily[t]) this.pomodoro.daily[t] = { count: 0, minutes: 0, interruptions: 0 }
      this.pomodoro.daily[t].interruptions++
      this.pomodoro.interruptions.push({ date: t, reason, time: Date.now() })
      this.save()
    },
    /** 记录中断/提前结束的部分时长（不增加完成次数、不加积分，但计入今日专注） */
    recordPartialSession(minutes: number) {
      const t = today()
      if (!this.pomodoro.partialSessions) this.pomodoro.partialSessions = []
      this.pomodoro.partialSessions.push({ date: t, minutes, time: Date.now() })
      // 提前结束的时长计入今日学习时长，但不算番茄数、不加积分
      if (!this.pomodoro.daily[t]) this.pomodoro.daily[t] = { count: 0, minutes: 0, interruptions: 0 }
      this.pomodoro.daily[t].minutes += minutes
      this.save()
    },

    /** 背单词逐条打卡：每次背诵单独生成一条记录 */
    addVocabRecord(newWords: number, reviewWords: number) {
      const points = Math.round((newWords + reviewWords) / 20)
      const id = uid()
      this.english.vocab.push({ id, date: today(), newWords, reviewWords, points })
      if (points > 0) this.addPoints(points, '背单词', id)
      this.save()
    },
    /** 删除单条背单词打卡记录：积分全额回收 + 删除对应积分流水 */
    deleteVocabRecord(id: string) {
      this.revokePointsByRef(id)
      this.english.vocab = this.english.vocab.filter(v => v.id !== id)
      this.save()
    },

    /** 保存阅读训练记录（+5 积分，refId 关联） */
    addReadingRecord(wpm: number, accuracy: number) {
      const id = uid()
      this.english.reading.push({ id, date: today(), wpm, accuracy })
      this.addPoints(5, '阅读训练', id)
      this.save()
    },

    /** 保存听力练习记录（每 10 分钟 +1 积分，refId 关联） */
    addListeningRecord(minutes: number, material: string, mode: '精听' | '泛听') {
      const id = uid()
      this.english.listening.push({ id, date: today(), minutes, material, mode })
      const pts = Math.round(minutes / 10)
      if (pts > 0) this.addPoints(pts, '听力练习', id)
      this.save()
    },

    updateSettings(patch: Partial<AppState['settings']>) {
      // 每日目标统一钳制为 >=1 的整数，与 updateHabitTarget 口径一致
      if (patch.wordGoal !== undefined) patch.wordGoal = Math.max(1, Math.round(patch.wordGoal) || 1)
      if (patch.problemGoal !== undefined) patch.problemGoal = Math.max(1, Math.round(patch.problemGoal) || 1)
      Object.assign(this.settings, patch)
      // 每日目标与习惯列表「每日背单词」「每日做题」按固定 id 实时双向同步
      if (patch.wordGoal !== undefined) {
        const h = this.habits.find(x => x.id === VOCAB_HABIT_ID && !x.bad)
        if (h) h.target = patch.wordGoal
      }
      if (patch.problemGoal !== undefined) {
        const h = this.habits.find(x => x.id === PROBLEM_HABIT_ID && !x.bad)
        if (h) h.target = patch.problemGoal
      }
      this.save()
    },

    /** 成就检测 */
    checkAchievements() {
      const has = (id: string) => this.gamification.achievements.includes(id)
      const unlock = (id: string) => {
        if (!has(id)) {
          this.gamification.achievements.push(id)
          const def = ACHIEVEMENTS.find(a => a.id === id)
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
      const todaySubjects = new Set(this.todayRecords.map(r => r.subjectId))
      if (this.subjects.length > 0 && this.subjects.every(s => todaySubjects.has(s.id))) unlock('all_subjects')
      const morning = this.habits.find(h => h.name.includes('晨读'))
      if (morning) {
        let cnt = 0
        for (let i = 0; i < 7; i++) {
          const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10)
          if (morning.records[d]) cnt++
        }
        if (cnt >= 7) unlock('early_bird')
      }
    },

    /** 导出/导入/清空 */
    exportJSON(): string {
      return JSON.stringify(this.$state, null, 2)
    },
    importJSON(json: string): boolean {
      try {
        const data = JSON.parse(json)
        this.$patch({ ...createDefaultState(), ...data })
        this.migrateLegacyData()
        this.save()
        return true
      } catch {
        return false
      }
    },
    clearAll() {
      this.$patch(createDefaultState())
      this.save()
    }
  }
})
