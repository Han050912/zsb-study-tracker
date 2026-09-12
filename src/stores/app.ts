import { defineStore } from 'pinia'
import {
  createDefaultState,
  ACHIEVEMENTS,
  LEVELS,
  levelOf,
  VOCAB_HABIT_ID,
  PROBLEM_HABIT_ID,
  defaultSubjects
} from '../data/defaults'
import { today, yesterday, uid, daysBetween } from '../utils/date'
import { syncApi, type PullResponse } from '../api/sync'
import { DATA_DOMAINS, applyChanges, serializeChanges } from '../services/syncDomains'
import {
  ack,
  clear as clearOutbox,
  setOutboxUser,
  size as outboxSize,
  takeForFlush,
  stageAchievements,
  stageDelete,
  stagePoints,
  stageUpsert
} from '../services/syncOutbox'
import { sessionUser } from '../services/auth'
import { ERROR_IMAGE_PREFIX, clearErrorImageCache, dataUrlToBytes, uploadErrorImage } from '../api/errorImages'
import {
  clearAllNoteBodies,
  flushPendingNoteBodies,
  getNoteBody,
  hasPendingNoteBodies,
  queueNoteBody,
  reconcileNoteBodies,
  removeNoteBody,
  setNoteBodyUser
} from '../services/noteBodies'
import type {
  AppState,
  StudyRecord,
  ProblemSession,
  ErrorQuestion,
  ExamRecord,
  Note,
  DailySummary,
  Habit,
  Material,
  Subject,
  Todo,
  TopicImportance,
  PomodoroRecord,
  PomodoroStat,
  Settings,
  VocabRecord,
  ReadingRecord,
  ListeningRecord,
  EssayTemplate
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

/**
 * 拉取游标的 localStorage key 前缀（按用户分桶：`<前缀>:<userId>`）。
 * 语义严格按设计 §4.2：`cursor[domain] = 上次 pull 该域返回的 changes[domain].seq`（域未出现则不推进）；
 * **不得**用 `versions` 当游标（`allocateSeq` 先行提交会让 versions 高于实际可读序号）。
 */
const CURSOR_KEY_PREFIX = 'zsb_sync_cursors_v1'

/**
 * 当前账号 id：用于 outbox / 游标分桶与登出清理。
 * 不能依赖 sessionUser（logout 先于 resetState 执行，那时已是 null）。
 */
let activeUserId: string | null = null

/**
 * 本次会话是否已完成过全量拉取。
 * 刻意只放内存、不落盘：本地全量数据只存在于内存（未持久化 state），
 * 冷启动若走增量 pull 会只拿到「上次游标之后的变更」而丢掉基础数据集，因此冷启动必须重新 full。
 */
let hasFullSynced = false

function cursorKey(userId: string): string {
  return `${CURSOR_KEY_PREFIX}:${userId}`
}

/** 读取该账号的拉取游标（无/损坏则视为空，服务端按 0 处理） */
function loadCursors(userId: string | null): Record<string, number> {
  if (!userId) return {}
  try {
    const raw = localStorage.getItem(cursorKey(userId))
    const parsed = raw ? JSON.parse(raw) : null
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, number>) : {}
  } catch {
    return {}
  }
}

function saveCursors(userId: string | null, cursors: Record<string, number>): void {
  if (!userId) return
  try {
    localStorage.setItem(cursorKey(userId), JSON.stringify(cursors))
  } catch (e) {
    console.error('写入同步游标失败', e)
  }
}

function clearCursors(userId: string | null): void {
  if (!userId) return
  try {
    localStorage.removeItem(cursorKey(userId))
  } catch (e) {
    console.error('清除同步游标失败', e)
  }
}

// ---------- 记录级打点辅助（T6：mutation → outbox 暂存） ----------

/**
 * 新增/编辑打点：给记录打 LWW 时间戳（updatedAt）并暂存到 outbox。
 * 适用于键 = 记录 id 的域（records/problemSessions/errorQuestions/exams/notes/materials/todos/
 * subjects/habits；subjects/habits 为整棵聚合整体 stage，键仍是记录 id）。
 * stage 的是响应式对象引用：推送时序列化为当时最新值（期间的重编辑必然重新 stage 覆盖同 key）。
 */
function touchRecord(domain: string, record: { id: string; updatedAt?: number }, ts = Date.now()): void {
  record.updatedAt = ts
  stageUpsert(domain, record.id, record, ts)
}

/** english 子集合字段名 → 服务端键前缀（设计 §3.3：vocab:/reading:/listening:/template:） */
const ENGLISH_KEY_PREFIX = {
  vocab: 'vocab',
  reading: 'reading',
  listening: 'listening',
  templates: 'template'
} as const

/** english 打点：键 = `<前缀>:<id>`；无 id 的旧记录不 stage（迁移补齐 id 后才会被推送） */
function touchEnglish(
  collection: keyof typeof ENGLISH_KEY_PREFIX,
  record: { id?: string; updatedAt?: number },
  ts = Date.now()
): void {
  if (!record.id) return
  record.updatedAt = ts
  stageUpsert('english', `${ENGLISH_KEY_PREFIX[collection]}:${record.id}`, record, ts)
}

/** 设置打点：整体 stage（键固定 self）。maimemoToken：本地未填写时为 undefined，
 * 序列化后不出现于载荷，服务端保持「undefined 不覆盖」语义 → 云端凭证不会被空值冲掉（T5 报告约定） */
function touchSettings(settings: Settings, ts = Date.now()): void {
  settings.updatedAt = ts
  stageUpsert('settings', 'self', settings, ts)
}

/** 番茄日统计打点（`day:<date>`） */
function touchPomodoroDay(daily: PomodoroStat['daily'], date: string, ts = Date.now()): void {
  const stat = daily[date]
  if (!stat) return
  stat.updatedAt = ts
  stageUpsert('pomodoro', `day:${date}`, stat, ts)
}

/** 番茄单条记录打点（`rec:<id>`） */
function touchPomodoroRecord(record: PomodoroRecord, ts = Date.now()): void {
  record.updatedAt = ts
  stageUpsert('pomodoro', `rec:${record.id}`, record, ts)
}

/**
 * 整批替换场景（导入/清空）：把一份状态里的全部记录逐条 stage 为删除墓碑。
 * 记录级协议没有「整域替换」，整批覆盖 = 旧记录逐条删 + 新记录逐条写。
 * gamification/settings 不在此列：前者服务端权威（用积分事件撤销），后者只做 upsert。
 */
function stageAllDeletes(state: AppState, ts: number): void {
  for (const s of state.subjects) stageDelete('subjects', s.id, ts)
  for (const r of state.records) stageDelete('records', r.id, ts)
  for (const p of state.problemSessions) stageDelete('problemSessions', p.id, ts)
  for (const q of state.errorQuestions) stageDelete('errorQuestions', q.id, ts)
  for (const e of state.exams) stageDelete('exams', e.id, ts)
  for (const n of state.notes) stageDelete('notes', n.id, ts)
  for (const m of state.materials) stageDelete('materials', m.id, ts)
  for (const t of state.todos) stageDelete('todos', t.id, ts)
  for (const h of state.habits) stageDelete('habits', h.id, ts)
  for (const date of Object.keys(state.summaries)) stageDelete('summaries', date, ts)
  for (const v of state.english.vocab) if (v.id) stageDelete('english', `vocab:${v.id}`, ts)
  for (const r of state.english.reading) if (r.id) stageDelete('english', `reading:${r.id}`, ts)
  for (const l of state.english.listening) if (l.id) stageDelete('english', `listening:${l.id}`, ts)
  for (const t of state.english.templates) stageDelete('english', `template:${t.id}`, ts)
  for (const date of Object.keys(state.pomodoro.daily)) stageDelete('pomodoro', `day:${date}`, ts)
  for (const date of new Set(state.pomodoro.interruptions.map((it) => it.date)))
    stageDelete('pomodoro', `itr:${date}`, ts)
  for (const r of state.pomodoro.records) stageDelete('pomodoro', `rec:${r.id}`, ts)
}

/**
 * 整批替换场景（导入/清空）：把一份状态里的全部记录逐条 stage 为 upsert。
 * 缺 id 的旧记录跳过（migrateLegacyData 会补齐 id，补齐后由其自身打点上行）。
 */
function stageAllUpserts(state: AppState, ts: number): void {
  for (const s of state.subjects) {
    s.updatedAt = ts
    stageUpsert('subjects', s.id, s, ts)
  }
  for (const r of state.records) {
    r.updatedAt = ts
    stageUpsert('records', r.id, r, ts)
  }
  for (const p of state.problemSessions) {
    p.updatedAt = ts
    stageUpsert('problemSessions', p.id, p, ts)
  }
  for (const q of state.errorQuestions) {
    q.updatedAt = ts
    stageUpsert('errorQuestions', q.id, q, ts)
  }
  for (const e of state.exams) {
    e.updatedAt = ts
    stageUpsert('exams', e.id, e, ts)
  }
  for (const n of state.notes) {
    // Note.updatedAt 是业务字段（编辑时间）：保留导入值，缺省才打当前时间戳
    n.updatedAt = n.updatedAt || ts
    stageUpsert('notes', n.id, n, n.updatedAt)
  }
  for (const m of state.materials) {
    m.updatedAt = ts
    stageUpsert('materials', m.id, m, ts)
  }
  for (const t of state.todos) {
    t.updatedAt = ts
    stageUpsert('todos', t.id, t, ts)
  }
  for (const h of state.habits) {
    h.updatedAt = ts
    stageUpsert('habits', h.id, h, ts)
  }
  for (const [date, s] of Object.entries(state.summaries)) {
    s.updatedAt = ts
    stageUpsert('summaries', date, s, ts)
  }
  for (const v of state.english.vocab)
    if (v.id) {
      v.updatedAt = ts
      stageUpsert('english', `vocab:${v.id}`, v, ts)
    }
  for (const r of state.english.reading)
    if (r.id) {
      r.updatedAt = ts
      stageUpsert('english', `reading:${r.id}`, r, ts)
    }
  for (const l of state.english.listening)
    if (l.id) {
      l.updatedAt = ts
      stageUpsert('english', `listening:${l.id}`, l, ts)
    }
  for (const t of state.english.templates) {
    t.updatedAt = ts
    stageUpsert('english', `template:${t.id}`, t, ts)
  }
  for (const [date, d] of Object.entries(state.pomodoro.daily)) {
    d.updatedAt = ts
    stageUpsert('pomodoro', `day:${date}`, d, ts)
  }
  const itrByDate = new Map<string, { reason: string; time: number }[]>()
  for (const it of state.pomodoro.interruptions) {
    const list = itrByDate.get(it.date) ?? []
    list.push({ reason: it.reason, time: it.time })
    itrByDate.set(it.date, list)
  }
  for (const [date, items] of itrByDate) stageUpsert('pomodoro', `itr:${date}`, items, ts)
  for (const r of state.pomodoro.records) {
    r.updatedAt = ts
    stageUpsert('pomodoro', `rec:${r.id}`, r, ts)
  }
  // settings 整行上行（maimemoToken 空值语义见 touchSettings 注释）
  state.settings.updatedAt = ts
  stageUpsert('settings', 'self', state.settings, ts)
}

/** 把某份积分流水中所有带 refId 的条目以 award 事件补齐服务端（按 refId 幂等去重；脏数据跳过避免整批 400） */
function stageLogAwards(log: { date: string; points: number; reason: string; refId?: string }[]): void {
  for (const l of log) {
    if (!l.refId) continue
    if (!Number.isInteger(l.points) || l.points <= 0) continue
    stagePoints({ op: 'award', refId: l.refId, points: l.points, reason: l.reason, date: l.date })
  }
}

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
    /** 触发防抖推送（800ms 合并连续操作）。推送内容完全来自 outbox 的暂存变更（T6 起 mutation 直接 stage）。 */
    save() {
      if (!hasHydrated) return
      if (saveTimer) clearTimeout(saveTimer)
      saveTimer = setTimeout(() => {
        saveTimer = null
        void this.flushOutbox().then((r) => {
          if (!r.ok) console.error('后台同步失败：变更已落盘，待下次同步重试')
        })
      }, SAVE_DEBOUNCE_MS)
    },

    /** 立即推送（导入/清空/登出等关键路径） */
    async saveAsync(): Promise<boolean> {
      if (!hasHydrated) return true
      if (saveTimer) {
        clearTimeout(saveTimer)
        saveTimer = null
      }
      return (await this.flushOutbox()).ok
    },

    /**
     * 推送 outbox 中全部待推送变更：**一次** `POST /api/data/push` 提交所有域 + 积分事件 + 成就。
     * 成功即 `ack`（含被服务端拒绝的条目：本地**不回滚**，等下次拉取按 LWW 覆盖，仅记日志）；
     * 并按响应采纳权威 `gamification` 快照。失败时 outbox 原样保留，待下次同步重试。
     */
    async flushOutbox(): Promise<{ ok: boolean; applied: number; rejected: number }> {
      if (!hasHydrated) return { ok: true, applied: 0, rejected: 0 }
      try {
        const revisions = await flushPendingNoteBodies()
        for (const [id, revision] of revisions) {
          const note = this.notes.find((item) => item.id === id)
          if (!note || note.bodyUpdatedAt !== revision.from) continue
          note.bodyUpdatedAt = revision.to
          if (note.updatedAt === revision.from) note.updatedAt = revision.to
          stageUpsert('notes', note.id, note, note.updatedAt)
        }
      } catch (e) {
        console.error('笔记正文推送失败：正文与元数据变更均保留待重试', e)
        return { ok: false, applied: 0, rejected: 0 }
      }

      const snapshot = takeForFlush()
      if (!snapshot) return { ok: true, applied: 0, rejected: 0 }

      const domains: Record<string, ReturnType<typeof serializeChanges>> = {}
      for (const domain of new Set([...Object.keys(snapshot.upserts), ...Object.keys(snapshot.deletes)])) {
        const changes = serializeChanges(domain, snapshot.upserts[domain] ?? {}, snapshot.deletes[domain] ?? {})
        // pomodoro 的 itr: 空列表被裁掉后该域可能为空：空域不上报（服务端拒绝「无任何变更」的请求）
        if (changes.upserts.length || changes.deletes.length) domains[domain] = changes
      }
      if (!Object.keys(domains).length && !snapshot.points.length && !snapshot.achievements.length) {
        // 全部条目都被序列化裁掉（如仅剩空的 itr:）→ 直接确认，避免服务端 400
        ack(snapshot)
        return { ok: true, applied: 0, rejected: 0 }
      }

      try {
        const res = await syncApi.pushChanges({
          domains,
          points: snapshot.points,
          achievements: snapshot.achievements
        })
        ack(snapshot)
        if (res.gamification) this.$patch({ gamification: res.gamification })
        const rejected = res.rejected?.length ?? 0
        if (rejected) console.warn(`服务端按 LWW 拒绝了 ${rejected} 条变更（本地保留，待下次拉取覆盖）`, res.rejected)
        const applied = Object.values(res.applied ?? {}).reduce((s, n) => s + n, 0)
        return { ok: true, applied, rejected }
      } catch (e) {
        console.error('推送失败：变更仍在本地 outbox，待下次同步重试', e)
        return { ok: false, applied: 0, rejected: 0 }
      }
    },

    /**
     * 页面卸载前兜底：用 keepalive 一次推送 outbox 的紧凑形态。
     * **不清空 outbox**：keepalive 读不到响应，而 `ack` 必须依据响应（成功/被拒）判定；
     * outbox 已落盘，未确认的条目下次同步会重推（服务端按 LWW / refId 幂等，重复推送安全）。
     * 载荷超过 keepalive 上限时 client.requestKeepalive 内部跳过并告警，outbox 同样保留待下次同步（不丢数据）。
     */
    flushSave() {
      if (!hasHydrated) return
      if (saveTimer) {
        clearTimeout(saveTimer)
        saveTimer = null
      }
      // 正文不能可靠地在 unload keepalive 中上传；有 dirty 正文时保留两类 outbox 到下次启动。
      if (hasPendingNoteBodies()) return
      const snapshot = takeForFlush()
      if (!snapshot) return

      const domains: Record<string, ReturnType<typeof serializeChanges>> = {}
      for (const domain of new Set([...Object.keys(snapshot.upserts), ...Object.keys(snapshot.deletes)])) {
        const changes = serializeChanges(domain, snapshot.upserts[domain] ?? {}, snapshot.deletes[domain] ?? {})
        if (changes.upserts.length || changes.deletes.length) domains[domain] = changes
      }
      if (!Object.keys(domains).length && !snapshot.points.length && !snapshot.achievements.length) return
      syncApi.pushChangesBeacon({ domains, points: snapshot.points, achievements: snapshot.achievements })
    },

    /** 计算当前账号数据大小（按当前状态 JSON 序列化估算）。 */
    async storageUsageText(): Promise<string> {
      const bytes = new Blob([JSON.stringify(this.$state)]).size
      if (bytes < 1024) return bytes + ' B'
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
      return (bytes / 1024 / 1024).toFixed(2) + ' MB'
    },

    /**
     * 把 pull 结果合并进本地 state，并按设计 §4.2 的游标契约推进游标；返回本次合入条数。
     * `resetDomains = true`（老用户全量拉取）时先清空服务端权威域再重建——本地全量数据只存在于内存，
     * 冷启动的默认数据（内置科目/习惯）必须先让位给服务端数据（被删的科目由墓碑负责移除）。
     * settings 不被清空：服务端快照缺 quotes 等字段时由本地默认值兜底。
     */
    applyPull(res: PullResponse, resetDomains: boolean): number {
      if (resetDomains) {
        this.$patch({
          subjects: [],
          records: [],
          problemSessions: [],
          errorQuestions: [],
          exams: [],
          notes: [],
          materials: [],
          todos: [],
          habits: [],
          summaries: {},
          english: { vocab: [], reading: [], listening: [], templates: [] },
          pomodoro: { daily: {}, interruptions: [], records: [] }
        })
      }
      const cursors = { ...loadCursors(activeUserId) }
      let changed = 0
      for (const [domain, changes] of Object.entries(res.changes ?? {})) {
        changed += applyChanges(domain, this.$state, changes)
        // 游标 = 本次该域**实际收到**的最大 seq；域未出现则不推进（不得取 versions，见设计 §4.2）
        cursors[domain] = changes.seq
      }
      saveCursors(activeUserId, cursors)
      // gamification 为服务端权威快照：每次 push/pull 响应都整体覆盖本地
      if (res.gamification) this.$patch({ gamification: res.gamification })
      return changed
    },

    /**
     * 登录后调用（设计 §6.1/§6.3）：无全量标记 → `full: true`；本次会话已全量过 → 增量 pull。
     * 顺序固定为**先 pull 后 flush**：先把服务端变更合并到本地（LWW 保住本地更新的未推送编辑），
     * 再推送 outbox 中未确认的本地变更，避免用旧本地值覆盖服务端新值。
     * 新用户（除 settings 外无任何数据变更、且无积分流水）保留内置默认科目/习惯。
     */
    async hydrate() {
      const userId = sessionUser.value?.id ?? null
      activeUserId = userId
      setOutboxUser(userId)
      await setNoteBodyUser(userId)

      const full = !hasFullSynced
      const res = full
        ? await syncApi.pullChanges({ full: true })
        : await syncApi.pullChanges({ cursors: loadCursors(userId) })

      const isNewUser =
        full &&
        !DATA_DOMAINS.some((d) => {
          const c = res.changes?.[d]
          return !!c && (c.upserts.length > 0 || c.deletes.length > 0)
        }) &&
        !res.gamification?.pointsLog?.length

      this.applyPull(res, full && !isNewUser)
      await reconcileNoteBodies(this.notes)
      hasHydrated = true
      hasFullSynced = true

      // 先 pull 后 flush（设计 §6.1）
      await this.flushOutbox()
      // 存量 base64 错题图片外置：后台执行，不阻塞首屏；失败下次 hydrate 自动重试
      if (!isNewUser) this.migrateErrorImages()
    },

    /**
     * 设置页「立即同步」：先 flush outbox，再增量 pull，返回结果摘要。
     * 游标取本次 pull 各域实际收到的 `changes[domain].seq`（见 applyPull）。
     */
    async syncNow(): Promise<{ ok: boolean; applied: number; rejected: number; changed: number }> {
      if (!hasHydrated) return { ok: false, applied: 0, rejected: 0, changed: 0 }
      const flushed = await this.flushOutbox()
      if (!flushed.ok) return { ok: false, applied: flushed.applied, rejected: flushed.rejected, changed: 0 }
      try {
        const res = await syncApi.pullChanges({ cursors: loadCursors(activeUserId) })
        const changed = this.applyPull(res, false)
        await reconcileNoteBodies(this.notes)
        return { ok: true, applied: flushed.applied, rejected: flushed.rejected, changed }
      } catch (e) {
        console.error('增量拉取失败', e)
        return { ok: false, applied: flushed.applied, rejected: flushed.rejected, changed: 0 }
      }
    },

    /**
     * 存量错题图片迁移：base64 dataURL → 内容寻址对象存储引用（'r2:<sha256>'）。
     * 幂等设计（第一优先级）：
     * - id 由服务端按落盘字节计算，重复执行/多设备并发只会覆盖同一对象与同一引用；
     * - 已完成（r2:）的条目直接跳过，中断后下次 hydrate 续跑；
     * - 单条失败只记日志，不影响其余条目，下次 hydrate 重试。
     */
    async migrateErrorImages() {
      const targets = this.errorQuestions.filter((q) => q.image?.startsWith('data:'))
      if (!targets.length) return
      let changed = false
      for (const q of targets) {
        try {
          const bytes = dataUrlToBytes(q.image!)
          const id = await uploadErrorImage(bytes)
          q.image = ERROR_IMAGE_PREFIX + id
          // 被改写的记录逐条打点进 outbox（hydrate 后随 flushOutbox 上行）
          touchRecord('errorQuestions', q)
          changed = true
        } catch (e) {
          console.error('错题图片迁移失败', q.id, e)
        }
      }
      if (changed) this.save()
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

    /** 退出登录/切换账号时清空本地同步状态并重置为空白数据，避免串号 */
    resetState() {
      hasHydrated = false
      hasFullSynced = false
      if (saveTimer) {
        clearTimeout(saveTimer)
        saveTimer = null
      }
      // 仅当待推送队列已清空（推送成功）才删除账号分桶：推送失败时保留在 localStorage
      // （按账号分桶不串号），同账号重新登录后自动续传（服务端按 LWW/refId 幂等，重复推送安全）
      if (!outboxSize()) clearOutbox()
      clearCursors(activeUserId)
      setOutboxUser(null)
      activeUserId = null
      // 清空错题图片 blob 缓存：防止下一账号经 SPA 内切换复用上一账号已授权的图片
      clearErrorImageCache()
      void setNoteBodyUser(null)
      this.$patch(createDefaultState())
    },

    /**
     * 增加积分并记录日志（本地乐观展示）；refId 关联产生积分的原始记录。
     * 同时发送 award 积分事件随 push 同批上报（设计 §5.1）：服务端按 refId 幂等落账，
     * **refId 必须确定性**（同一事件重放/多设备重推不会重复加分），故为必填（编译期约束全部调用点）。
     */
    addPoints(points: number, reason: string, refId: string) {
      this.gamification.points += points
      this.gamification.pointsLog.push({ date: today(), points, reason, refId })
      stagePoints({ op: 'award', refId, points, reason, date: today() })
      this.checkAchievements()
    },

    /** 按匹配条件回收积分：总积分回滚 + 彻底删除对应积分流水（内部公共实现） */
    revokePointsWhere(match: (l: { date: string; points: number; reason: string; refId?: string }) => boolean) {
      const logs = this.gamification.pointsLog.filter(match)
      if (!logs.length) return
      const sum = logs.reduce((s, l) => s + l.points, 0)
      this.gamification.points = Math.max(0, this.gamification.points - sum)
      this.gamification.pointsLog = this.gamification.pointsLog.filter((l) => !match(l))
    },

    /**
     * 回收某条原始记录对应的全部积分（本地乐观回收）。
     * `sendEvent`：是否同时发送 revoke 事件——
     * - 删除引发的回收：records/problemSessions/exams/habits 由服务端按删除墓碑自动撤销（§5.1），不发事件避免冗余；
     * - 非删除场景（取消打卡/取消完成待办）与服务端无自动撤销的域（todos/english）：必须发事件，否则他端流水不回收。
     */
    revokePointsByRef(refId: string, sendEvent = false) {
      this.revokePointsWhere((l) => l.refId === refId)
      if (sendEvent) stagePoints({ op: 'revoke', refId })
    },

    /** 按 refId 前缀回收积分（用于删除习惯等聚合记录；sendEvent 语义同 revokePointsByRef） */
    revokePointsByRefPrefix(prefix: string, sendEvent = false) {
      this.revokePointsWhere((l) => !!l.refId?.startsWith(prefix))
      if (sendEvent) stagePoints({ op: 'revoke', refPrefix: prefix })
    },

    /** 打卡：更新连胜（本地乐观值；streak/lastCheckin 以服务端快照为权威，push/pull 响应到达即覆盖） */
    checkin() {
      const t = today()
      if (this.gamification.lastCheckin === t) return
      this.gamification.streak = this.gamification.lastCheckin === yesterday() ? this.gamification.streak + 1 : 1
      this.gamification.lastCheckin = t
      // 确定性 refId：每日一次，跨设备/重放幂等
      this.addPoints(10, '每日打卡', `checkin:${t}`)
    },

    addRecord(rec: Omit<StudyRecord, 'id' | 'createdAt'>) {
      const id = uid()
      const record: StudyRecord = { ...rec, id, createdAt: Date.now() }
      this.records.push(record)
      this.checkin()
      this.addPoints(Math.max(1, Math.round(rec.minutes / 10)), `学习 ${rec.minutes} 分钟`, id)
      touchRecord('records', record)
      this.save()
    },
    deleteRecord(id: string) {
      // 本地回收即可：删除墓碑到达后服务端自动撤销该记录积分（设计 §5.1），无需重复发 revoke 事件
      this.revokePointsByRef(id)
      const rec = this.records.find((r) => r.id === id)
      this.records = this.records.filter((r) => r.id !== id)
      if (rec) stageDelete('records', id, Date.now())
      this.save()
    },

    addProblemSession(p: Omit<ProblemSession, 'id'>) {
      const id = uid()
      const session: ProblemSession = { ...p, id }
      this.problemSessions.push(session)
      const pts = Math.round(p.total / 5)
      if (pts > 0) this.addPoints(pts, `刷题 ${p.total} 道`, id)
      touchRecord('problemSessions', session)
      this.save()
    },
    deleteProblemSession(id: string) {
      // 删除墓碑到达后服务端自动撤销积分（设计 §5.1），本地回收即可
      this.revokePointsByRef(id)
      const p = this.problemSessions.find((x) => x.id === id)
      this.problemSessions = this.problemSessions.filter((x) => x.id !== id)
      if (p) stageDelete('problemSessions', id, Date.now())
      this.save()
    },

    addErrorQuestion(q: Omit<ErrorQuestion, 'id' | 'createdAt' | 'reviewCount' | 'mastered'>) {
      const question: ErrorQuestion = { ...q, id: uid(), createdAt: Date.now(), reviewCount: 0, mastered: false }
      this.errorQuestions.push(question)
      touchRecord('errorQuestions', question)
      this.save()
    },
    reviewError(id: string) {
      const q = this.errorQuestions.find((e) => e.id === id)
      if (q) {
        q.reviewCount++
        touchRecord('errorQuestions', q)
        this.addPoints(2, '复习错题', `error:${id}`)
        this.save()
      }
    },
    toggleErrorMastered(id: string) {
      const q = this.errorQuestions.find((e) => e.id === id)
      if (q) {
        q.mastered = !q.mastered
        touchRecord('errorQuestions', q)
        this.save()
      }
    },
    deleteError(id: string) {
      // 服务端对 errorQuestions 的删除按 ref_id = 'error:<key>' 自动撤销积分（设计 §5.1），本地回收即可
      this.revokePointsByRef(`error:${id}`)
      const q = this.errorQuestions.find((e) => e.id === id)
      this.errorQuestions = this.errorQuestions.filter((e) => e.id !== id)
      if (q) stageDelete('errorQuestions', id, Date.now())
      this.save()
    },

    addExam(e: Omit<ExamRecord, 'id'>) {
      const id = uid()
      const exam: ExamRecord = { ...e, id }
      this.exams.push(exam)
      this.addPoints(20, '完成真题/套卷', id)
      touchRecord('exams', exam)
      this.save()
    },
    deleteExam(id: string) {
      // 删除墓碑到达后服务端自动撤销积分（设计 §5.1），本地回收即可
      this.revokePointsByRef(id)
      const e = this.exams.find((x) => x.id === id)
      this.exams = this.exams.filter((x) => x.id !== id)
      if (e) stageDelete('exams', id, Date.now())
      this.save()
    },

    setMastery(subjectId: string, topic: string, level: number) {
      const s = this.subjects.find((x) => x.id === subjectId)
      if (s) {
        s.mastery[topic] = level
        // subjects 键 = subjectId，值 = 科目整棵聚合（含 chapters/topics）
        touchRecord('subjects', s)
        this.save()
      }
    },

    addSubject(s: Omit<Subject, 'id' | 'chapters' | 'mastery' | 'topicImportance' | 'builtin'>) {
      // 必须生成唯一 id，否则动态路由 /subject/:id 与导航将全部指向 /subject/undefined
      const subject: Subject = { ...s, id: uid(), builtin: false, chapters: [], mastery: {}, topicImportance: {} }
      this.subjects.push(subject)
      touchRecord('subjects', subject)
      this.save()
    },
    /** 恢复被删除的内置科目：仅补回缺失的，不覆盖已存在（含已改名）的内置科目，不影响自定义科目与错题数据。返回恢复数量 */
    restoreDefaultSubjects(): number {
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
    updateSubjectWeight(id: string, weight: number) {
      const s = this.subjects.find((x) => x.id === id)
      if (s) {
        s.weight = Math.min(100, Math.max(0, Math.round(weight) || 0))
        touchRecord('subjects', s)
        this.save()
      }
    },
    /** 删除科目：级联删除其学习记录/刷题/真题/错题/笔记等关联数据，并逐条回收这些数据产生的积分 */
    removeSubject(id: string) {
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
    addChapter(subjectId: string, name: string) {
      const s = this.subjects.find((x) => x.id === subjectId)
      if (s) {
        s.chapters.push({ id: uid(), name, topics: [] })
        touchRecord('subjects', s)
        this.save()
      }
    },
    /** 重命名章节标题：内容为空或章节不存在时返回 false */
    updateChapter(subjectId: string, chapterId: string, name: string): boolean {
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
    addTopic(subjectId: string, chapterId: string, topic: string) {
      const s = this.subjects.find((x) => x.id === subjectId)
      const ch = s?.chapters.find((c) => c.id === chapterId)
      if (s && ch && !ch.topics.includes(topic)) {
        ch.topics.push(topic)
        touchRecord('subjects', s)
        this.save()
      }
    },
    removeTopic(subjectId: string, chapterId: string, topic: string) {
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
    removeChapter(subjectId: string, chapterId: string) {
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
    },

    /** 批量导入笔记：正文进入独立本地缓存，Pinia/outbox 只保存元数据。 */
    importNotes(
      subjectId: string,
      items: { id?: string; title: string; content: string; tags: string[]; type?: Note['type'] }[]
    ) {
      const now = Date.now()
      for (const n of items) {
        const note: Note = {
          id: n.id || uid(),
          subjectId,
          title: n.title || '未命名',
          tags: n.tags,
          updatedAt: now,
          bodyUpdatedAt: n.type === 'pdf' ? 0 : now,
          type: n.type
        }
        if (n.type !== 'pdf') queueNoteBody(note.id, n.content, now)
        this.notes.push(note)
        touchRecord('notes', note, now)
      }
      this.save()
    },

    saveNote(note: Partial<Note> & { subjectId: string; content?: string }): string | null {
      const now = Date.now()
      if (note.id) {
        const n = this.notes.find((x) => x.id === note.id)
        if (n) {
          const bodyChanged = n.type !== 'pdf' && note.content !== undefined && note.content !== getNoteBody(n.id)
          if (bodyChanged) queueNoteBody(n.id, note.content!, now)
          Object.assign(n, {
            subjectId: note.subjectId,
            title: note.title ?? n.title,
            tags: note.tags ?? n.tags,
            type: note.type,
            bodyUpdatedAt: bodyChanged ? now : n.bodyUpdatedAt
          })
          touchRecord('notes', n, now)
          this.save()
          return n.id
        }
      } else {
        const created: Note = {
          id: uid(),
          subjectId: note.subjectId,
          title: note.title || '未命名',
          tags: note.tags || [],
          updatedAt: now,
          bodyUpdatedAt: note.type === 'pdf' ? 0 : now,
          type: note.type
        }
        if (created.type !== 'pdf') queueNoteBody(created.id, note.content || '', now)
        this.notes.push(created)
        touchRecord('notes', created, created.updatedAt)
        this.save()
        return created.id
      }
      return null
    },
    deleteNote(id: string) {
      const note = this.notes.find((n) => n.id === id)
      this.notes = this.notes.filter((n) => n.id !== id)
      removeNoteBody(id)
      // Markdown/PDF 分片由服务端在墓碑被接受时于同一 batch 清理。
      if (note) stageDelete('notes', id, Date.now())
      this.save()
    },

    saveSummary(s: DailySummary) {
      const isNew = !this.summaries[s.date]
      const summary: DailySummary = { ...s, updatedAt: Date.now() }
      this.summaries[s.date] = summary
      // 仅当天首次保存总结时奖励积分，重复编辑不重复加分
      if (s.date === today() && isNew) this.addPoints(5, '完成每日总结', `summary:${s.date}`)
      // summaries 键 = 日期
      stageUpsert('summaries', s.date, summary, summary.updatedAt!)
      this.save()
    },

    addHabit(h: Omit<Habit, 'id' | 'records'>) {
      const habit: Habit = { ...h, id: uid(), records: {} }
      this.habits.push(habit)
      // habits 键 = habitId，值 = 单个习惯（含 records/checkins）
      touchRecord('habits', habit)
      this.save()
    },
    deleteHabit(id: string) {
      // 回收该习惯全部打卡积分并删除对应流水（服务端删习惯时按 habit:<key>:% 自动撤销，本地回收即可）
      this.revokePointsByRefPrefix(`habit:${id}:`)
      const h = this.habits.find((x) => x.id === id)
      this.habits = this.habits.filter((x) => x.id !== id)
      if (h) stageDelete('habits', id, Date.now())
      this.save()
    },
    /** 记录习惯打卡；好习惯当天从「未完成」变为「完成」奖励 +2 积分，取消完成则全额回收（历史日期仅记数据，不动积分） */
    recordHabit(id: string, date: string, value: number | string) {
      const h = this.habits.find((x) => x.id === id)
      if (!h) return
      const hadValue = !!h.records[date]
      h.records[date] = value
      if (!h.bad && date === today()) {
        const refId = `habit:${id}:${date}`
        if (value && !hadValue) this.addPoints(2, `完成习惯「${h.name}」`, refId)
        // 取消打卡为非删除场景：服务端不会自动撤销 → 必须显式发 revoke 事件
        else if (!value && hadValue) this.revokePointsByRef(refId, true)
      }
      // 坏习惯发生记录与克制打卡互斥：记录发生即视为当天未克制
      if (h.bad && Number(value) > 0 && h.checkins?.[date]) delete h.checkins[date]
      touchRecord('habits', h)
      this.save()
    },
    /** 坏习惯「每日克制打卡」：打卡/取消打卡；与发生次数互斥（打卡视为当天未犯，清除当天发生记录） */
    toggleBadHabitCheckin(id: string, date: string) {
      const h = this.habits.find((x) => x.id === id)
      if (!h || !h.bad) return
      if (!h.checkins) h.checkins = {}
      if (h.checkins[date]) {
        delete h.checkins[date]
      } else {
        h.checkins[date] = 1
        delete h.records[date]
      }
      // 坏习惯克制打卡不动积分
      touchRecord('habits', h)
      this.save()
    },
    /** 单独修改习惯目标；「每日背单词」「每日做题」按固定 id 与设置页每日目标双向同步 */
    updateHabitTarget(id: string, target: number) {
      const h = this.habits.find((x) => x.id === id)
      if (!h) return
      const t = Math.max(1, Math.round(target) || 1)
      h.target = t
      touchRecord('habits', h)
      if (id === VOCAB_HABIT_ID) {
        this.settings.wordGoal = t
        touchSettings(this.settings)
      }
      if (id === PROBLEM_HABIT_ID) {
        this.settings.problemGoal = t
        touchSettings(this.settings)
      }
      this.save()
    },

    addMaterial(m: Omit<Material, 'id' | 'createdAt'>) {
      const material: Material = { ...m, id: uid(), createdAt: Date.now() }
      this.materials.push(material)
      touchRecord('materials', material)
      this.save()
    },
    updateMaterial(id: string, patch: Partial<Material>) {
      const m = this.materials.find((x) => x.id === id)
      if (m) {
        Object.assign(m, patch)
        touchRecord('materials', m)
        this.save()
      }
    },
    deleteMaterial(id: string) {
      const m = this.materials.find((x) => x.id === id)
      this.materials = this.materials.filter((x) => x.id !== id)
      if (m) stageDelete('materials', id, Date.now())
      this.save()
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

    updateSettings(patch: Partial<AppState['settings']>) {
      // 每日目标统一钳制为 >=1 的整数，与 updateHabitTarget 口径一致
      if (patch.wordGoal !== undefined) patch.wordGoal = Math.max(1, Math.round(patch.wordGoal) || 1)
      if (patch.problemGoal !== undefined) patch.problemGoal = Math.max(1, Math.round(patch.problemGoal) || 1)
      Object.assign(this.settings, patch)
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
    updateQuotes(quotes: string[]) {
      this.settings.quotes = quotes
      touchSettings(this.settings)
      this.save()
    },

    /** 设置头像（上传端点只存 R2 文件并返回 URL；settings 行由同步协议写入） */
    setAvatar(url: string) {
      this.settings.avatar = url
      touchSettings(this.settings)
      this.save()
    },

    /** 成就检测 */
    checkAchievements() {
      const has = (id: string) => this.gamification.achievements.includes(id)
      const unlock = (id: string) => {
        if (!has(id)) {
          this.gamification.achievements.push(id)
          // 成就上报走 push 的 achievements 字段（服务端只增不减并集，§5.2），随下次 push 同批上报
          stageAchievements([id])
          const def = ACHIEVEMENTS.find((a) => a.id === id)
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
      const todaySubjects = new Set(this.todayRecords.map((r) => r.subjectId))
      if (this.subjects.length > 0 && this.subjects.every((s) => todaySubjects.has(s.id))) unlock('all_subjects')
      const morning = this.habits.find((h) => h.name.includes('晨读'))
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
