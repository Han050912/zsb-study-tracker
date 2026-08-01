import { defineStore } from 'pinia'
import { createDefaultState, ACHIEVEMENTS, LEVELS } from '../data/defaults'
import { today, yesterday, uid, daysBetween } from '../utils/date'
import { loadCurrentUserPayload, saveCurrentUserPayload } from '../services/auth'
import type {
  AppState, StudyRecord, ProblemSession, ErrorQuestion, ExamRecord,
  Note, DailySummary, Habit, Material, Subject, Todo
} from '../types'

/** 旧版本地存储键（用于首次登录时迁移历史数据） */
const LEGACY_KEY = 'zsb-study-tracker-v1'

export const useAppStore = defineStore('app', {
  // 初始为默认空数据；登录后通过 hydrate() 从 SQLite 载入该用户的数据
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
    storageUsage(): string {
      const raw = loadCurrentUserPayload()?.payload || ''
      const bytes = new Blob([raw]).size
      if (bytes < 1024) return bytes + ' B'
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
      return (bytes / 1024 / 1024).toFixed(2) + ' MB'
    },
    /** 某科目某日期时长 */
    minutesByDate(): Record<string, number> {
      const map: Record<string, number> = {}
      for (const r of this.records) map[r.date] = (map[r.date] || 0) + r.minutes
      return map
    }
  },

  actions: {
    /** 持久化当前用户数据到 SQLite（user_data 表）。返回是否成功，失败时给出用户提示。 */
    save(): boolean {
      try {
        saveCurrentUserPayload(JSON.stringify(this.$state))
        return true
      } catch (e) {
        console.error('保存数据失败', e)
        alert('保存失败，请检查浏览器存储空间（可能为隐私模式或存储已满）')
        return false
      }
    },

    /** 登录后调用：从 SQLite 载入该用户的历史数据；无数据则尝试迁移旧版 localStorage 数据 */
    hydrate() {
      const row = loadCurrentUserPayload()
      if (row) {
        try {
          this.$patch({ ...createDefaultState(), ...(JSON.parse(row.payload) as Partial<AppState>) })
        } catch (e) {
          console.error('解析用户数据失败', e)
        }
        return
      }
      // 新用户：检测并迁移旧版本地数据
      const legacy = localStorage.getItem(LEGACY_KEY)
      if (legacy) {
        try {
          this.$patch({ ...createDefaultState(), ...(JSON.parse(legacy) as Partial<AppState>) })
          // 仅在确认保存成功后才删除旧数据，避免迁移失败导致旧数据被清空
          if (this.save()) {
            localStorage.removeItem(LEGACY_KEY)
          } else {
            console.error('历史数据迁移失败，已保留旧版本地数据')
          }
        } catch (e) {
          console.error('迁移历史数据失败', e)
        }
      }
    },

    /** 退出登录/切换账号时重置为空白数据 */
    resetState() {
      this.$patch(createDefaultState())
    },

    /** 增加积分并记录日志 */
    addPoints(points: number, reason: string) {
      this.gamification.points += points
      this.gamification.pointsLog.push({ date: today(), points, reason })
      this.checkAchievements()
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
      this.records.push({ ...rec, id: uid(), createdAt: Date.now() })
      this.checkin()
      this.addPoints(Math.max(1, Math.round(rec.minutes / 10)), `学习 ${rec.minutes} 分钟`)
      this.save()
    },
    deleteRecord(id: string) {
      this.records = this.records.filter(r => r.id !== id)
      this.save()
    },

    addProblemSession(p: Omit<ProblemSession, 'id'>) {
      this.problemSessions.push({ ...p, id: uid() })
      this.addPoints(Math.round(p.total / 5), `刷题 ${p.total} 道`)
      this.save()
    },
    deleteProblemSession(id: string) {
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
        this.addPoints(2, '复习错题')
        this.save()
      }
    },
    toggleErrorMastered(id: string) {
      const q = this.errorQuestions.find(e => e.id === id)
      if (q) { q.mastered = !q.mastered; this.save() }
    },
    deleteError(id: string) {
      this.errorQuestions = this.errorQuestions.filter(e => e.id !== id)
      this.save()
    },

    addExam(e: Omit<ExamRecord, 'id'>) {
      this.exams.push({ ...e, id: uid() })
      this.addPoints(20, '完成真题/套卷')
      this.save()
    },
    deleteExam(id: string) {
      this.exams = this.exams.filter(e => e.id !== id)
      this.save()
    },

    setMastery(subjectId: string, topic: string, level: number) {
      const s = this.subjects.find(x => x.id === subjectId)
      if (s) { s.mastery[topic] = level; this.save() }
    },

    addSubject(s: Omit<Subject, 'chapters' | 'mastery' | 'builtin'>) {
      this.subjects.push({ ...s, builtin: false, chapters: [], mastery: {} })
      this.save()
    },
    removeSubject(id: string) {
      this.subjects = this.subjects.filter(s => s.id !== id)
      this.records = this.records.filter(r => r.subjectId !== id)
      this.save()
    },
    addChapter(subjectId: string, name: string) {
      const s = this.subjects.find(x => x.id === subjectId)
      if (s) { s.chapters.push({ id: uid(), name, topics: [] }); this.save() }
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
        this.save()
      }
    },
    removeChapter(subjectId: string, chapterId: string) {
      const s = this.subjects.find(x => x.id === subjectId)
      if (s) {
        const ch = s.chapters.find(c => c.id === chapterId)
        if (ch) for (const t of ch.topics) delete s.mastery[t]
        s.chapters = s.chapters.filter(c => c.id !== chapterId)
        this.save()
      }
    },

    saveNote(note: Partial<Note> & { subjectId: string }) {
      if (note.id) {
        const n = this.notes.find(x => x.id === note.id)
        if (n) Object.assign(n, note, { updatedAt: Date.now() })
      } else {
        this.notes.push({
          id: uid(), subjectId: note.subjectId, title: note.title || '未命名',
          content: note.content || '', tags: note.tags || [], updatedAt: Date.now()
        })
      }
      this.save()
    },
    deleteNote(id: string) {
      this.notes = this.notes.filter(n => n.id !== id)
      this.save()
    },

    saveSummary(s: DailySummary) {
      const isNew = !this.summaries[s.date]
      this.summaries[s.date] = { ...s }
      // 仅当天首次保存总结时奖励积分，重复编辑不重复加分
      if (s.date === today() && isNew) this.addPoints(5, '完成每日总结')
      this.save()
    },

    addHabit(h: Omit<Habit, 'id' | 'records'>) {
      this.habits.push({ ...h, id: uid(), records: {} })
      this.save()
    },
    deleteHabit(id: string) {
      this.habits = this.habits.filter(h => h.id !== id)
      this.save()
    },
    recordHabit(id: string, date: string, value: number | string) {
      const h = this.habits.find(x => x.id === id)
      if (h) { h.records[date] = value; this.save() }
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
    toggleTodo(id: string) {
      const t = this.todos.find(x => x.id === id)
      if (t) { t.done = !t.done; if (t.done) this.addPoints(3, '完成待办'); this.save() }
    },
    deleteTodo(id: string) {
      this.todos = this.todos.filter(t => t.id !== id)
      this.save()
    },
    moveTodo(id: string, dir: -1 | 1) {
      const list = this.todayTodos
      const idx = list.findIndex(t => t.id === id)
      const swap = list[idx + dir]
      if (idx < 0 || !swap) return
      const a = list[idx]
      ;[a.order, swap.order] = [swap.order, a.order]
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

    updateSettings(patch: Partial<AppState['settings']>) {
      Object.assign(this.settings, patch)
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
