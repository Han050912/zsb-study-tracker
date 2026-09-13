/**
 * app store 的 staging 纯函数层（leaf）：「mutation → outbox 暂存」与拉取游标的本地读写。
 * 不依赖 store 实例（不 import 其他 app 模块的 actions/state），可被各域模块单向 import。
 */
import { stageDelete, stagePoints, stageUpsert } from '../../services/syncOutbox'
import type { AppState, PomodoroRecord, PomodoroStat, Settings } from '../../types'

/**
 * 拉取游标的 localStorage key 前缀（按用户分桶：`<前缀>:<userId>`）。
 * 语义严格按设计 §4.2：`cursor[domain] = 上次 pull 该域返回的 changes[domain].seq`（域未出现则不推进）；
 * **不得**用 `versions` 当游标（`allocateSeq` 先行提交会让 versions 高于实际可读序号）。
 */
export const CURSOR_KEY_PREFIX = 'zsb_sync_cursors_v1'

export function cursorKey(userId: string): string {
  return `${CURSOR_KEY_PREFIX}:${userId}`
}

/** 读取该账号的拉取游标（无/损坏则视为空，服务端按 0 处理） */
export function loadCursors(userId: string | null): Record<string, number> {
  if (!userId) return {}
  try {
    const raw = localStorage.getItem(cursorKey(userId))
    const parsed = raw ? JSON.parse(raw) : null
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, number>) : {}
  } catch {
    return {}
  }
}

export function saveCursors(userId: string | null, cursors: Record<string, number>): void {
  if (!userId) return
  try {
    localStorage.setItem(cursorKey(userId), JSON.stringify(cursors))
  } catch (e) {
    console.error('写入同步游标失败', e)
  }
}

export function clearCursors(userId: string | null): void {
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
export function touchRecord(domain: string, record: { id: string; updatedAt?: number }, ts = Date.now()): void {
  record.updatedAt = ts
  stageUpsert(domain, record.id, record, ts)
}

/** english 子集合字段名 → 服务端键前缀（设计 §3.3：vocab:/reading:/listening:/template:） */
export const ENGLISH_KEY_PREFIX = {
  vocab: 'vocab',
  reading: 'reading',
  listening: 'listening',
  templates: 'template'
} as const

/** english 打点：键 = `<前缀>:<id>`；无 id 的旧记录不 stage（迁移补齐 id 后才会被推送） */
export function touchEnglish(
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
export function touchSettings(settings: Settings, ts = Date.now()): void {
  settings.updatedAt = ts
  stageUpsert('settings', 'self', settings, ts)
}

/** 番茄日统计打点（`day:<date>`） */
export function touchPomodoroDay(daily: PomodoroStat['daily'], date: string, ts = Date.now()): void {
  const stat = daily[date]
  if (!stat) return
  stat.updatedAt = ts
  stageUpsert('pomodoro', `day:${date}`, stat, ts)
}

/** 番茄单条记录打点（`rec:<id>`） */
export function touchPomodoroRecord(record: PomodoroRecord, ts = Date.now()): void {
  record.updatedAt = ts
  stageUpsert('pomodoro', `rec:${record.id}`, record, ts)
}

/**
 * 整批替换场景（导入/清空）：把一份状态里的全部记录逐条 stage 为删除墓碑。
 * 记录级协议没有「整域替换」，整批覆盖 = 旧记录逐条删 + 新记录逐条写。
 * gamification/settings 不在此列：前者服务端权威（用积分事件撤销），后者只做 upsert。
 */
export function stageAllDeletes(state: AppState, ts: number): void {
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
export function stageAllUpserts(state: AppState, ts: number): void {
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
export function stageLogAwards(log: { date: string; points: number; reason: string; refId?: string }[]): void {
  for (const l of log) {
    if (!l.refId) continue
    if (!Number.isInteger(l.points) || l.points <= 0) continue
    stagePoints({ op: 'award', refId: l.refId, points: l.points, reason: l.reason, date: l.date })
  }
}
