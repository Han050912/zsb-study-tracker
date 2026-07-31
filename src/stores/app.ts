import { defineStore } from 'pinia'
import { createDefaultState, ACHIEVEMENTS, LEVELS } from '../data/defaults'
import { today, yesterday, uid, daysBetween } from '../utils/date'
import type {
  AppState, StudyRecord, ProblemSession, ErrorQuestion, ExamRecord,
  Note, DailySummary, Habit, Material, Subject, Todo
} from '../types'

const STORAGE_KEY = 'zsb-study-tracker-v1'

function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      return { ...createDefaultState(), ...parsed }
    }
  } catch (e) {
    console.error('读取本地数据失败', e)
  }
  return createDefaultState()
}

export const useAppStore = defineStore('app', {
  state: (): AppState => loadState(),

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
      const raw = localStorage.getItem(STORAGE_KEY) || ''
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
    save() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.$state))
      } catch (e: any) {
        if (e?.name === 'QuotaExceededError') {
          alert('本地存储空间不足！请导出备份后清理部分数据（如错题图片）。')
        }
        console.error(e)
      }
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
      const fresh = createDefaultState()
      this.$patch(fresh)
      localStorage.removeItem(STORAGE_KEY)
      this.save()
    }
  }
})
