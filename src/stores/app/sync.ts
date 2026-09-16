/**
 * app store 的 sync 核心模块：推送（outbox flush）与拉取（pull/hydrate）动作 + 模块级同步状态。
 * 仅 import staging 纯函数与 services/api；不 import 其他 app 域模块的 actions（跨域调用一律走 this）。
 */
import { ref } from 'vue'
import type { AppStoreThis } from './this-type'
import { clearCursors, loadCursors, saveCursors } from './staging'
import { createDefaultState } from '../../data/defaults'
import { ApiError } from '../../api/client'
import { syncApi, type PullResponse } from '../../api/sync'
import { DATA_DOMAINS, DOMAIN_SHAPES, applyChanges, serializeChanges } from '../../services/syncDomains'
import {
  ack,
  clear as clearOutbox,
  setOutboxUser,
  size as outboxSize,
  takeForFlush,
  stageUpsert
} from '../../services/syncOutbox'
import { sessionUser } from '../../services/auth'
import { clearErrorImageCache } from '../../api/errorImages'
import {
  flushPendingNoteBodies,
  hasPendingNoteBodies,
  reconcileNoteBodies,
  setNoteBodyUser,
  type NoteBodyPushFailure
} from '../../services/noteBodies'
import type { Note } from '../../types'

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

/**
 * 服务端单条记录字符串上限（与 worker/src/api/sync.ts 的 MAX_FIELD_CHARS 同值）：超限返回 413，
 * 且推送是**整批原子**的——一条非法记录会让本次推送的全部域一起失败。
 * 前端据此在入库前拦下超限内容（资料库文件上传），并据以定位已落库的超限记录。
 */
export const MAX_FIELD_CHARS = 1_000_000

/**
 * 最近一次推送失败的可展示原因（null = 没有未解决的推送失败）。
 * 4xx 是「服务端明确拒绝」，与「网络不通」语义完全不同：毒记录会让之后每一次推送都被整批拒绝，
 * 只打日志会让用户完全不知道同步已经长期停止，因此把原因留在响应式状态里供界面提示。
 */
export const syncIssue = ref<string | null>(null)

/** 本次推送载荷（域 → 变更集合），用于在失败时定位毒记录 */
type PushDomains = Record<string, ReturnType<typeof serializeChanges>>

/** 记录的可读标识：优先标题 / 文件名，便于用户一眼认出是哪条内容撑破了上限 */
function recordLabel(value: unknown, key: string): string {
  const record = (value ?? {}) as { title?: unknown; fileName?: unknown }
  if (typeof record.title === 'string' && record.title) return record.title
  if (typeof record.fileName === 'string' && record.fileName) return record.fileName
  return key
}

/**
 * 在推送载荷中定位第一条超过服务端单条上限的记录（判定口径与 worker/src/api/sync.ts 一致）。
 * 单条超限会让服务端以 413 **整批**拒绝（笔记 / 错题 / 学习记录全被连累），必须指名到具体记录，
 * 否则用户只知道「同步失败」却无从下手。
 */
function findOversizedRecord(domains: PushDomains): string | null {
  for (const [domain, changes] of Object.entries(domains)) {
    const wrapped = DOMAIN_SHAPES[domain] === 'wrapped'
    for (const raw of changes.upserts) {
      const entry = (raw ?? {}) as { key?: unknown; value?: unknown; id?: unknown }
      const key = String(wrapped ? entry.key : entry.id)
      const value = wrapped ? entry.value : entry
      if (wrapped) {
        if (JSON.stringify(value).length > MAX_FIELD_CHARS) return `${domain}「${recordLabel(value, key)}」`
        continue
      }
      for (const field of Object.values((value ?? {}) as Record<string, unknown>)) {
        if (typeof field === 'string' && field.length > MAX_FIELD_CHARS)
          return `${domain}「${recordLabel(value, key)}」`
      }
    }
  }
  return null
}

/**
 * 推送失败的可展示原因：
 * - 4xx（服务端拒绝，非超时）：给出服务端原话，413 额外指名撑破上限的记录——这类毒记录会持续
 *   让整批推送被拒，不暴露原因就等于「静默停止同步」；
 * - 其余（网络中断 / 超时 / 5xx）：提示检查网络。
 */
function describePushFailure(e: unknown, domains?: PushDomains): string {
  if (e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 408) {
    const oversize = e.status === 413 && domains ? findOversizedRecord(domains) : null
    if (oversize) return `同步被服务端拒绝：${oversize} 超过单条 1MB 上限，删除或缩小该条后即可恢复`
    return `同步被服务端拒绝（${e.status}）：${e.message}`
  }
  return '同步失败，请检查网络后重试'
}

/**
 * 正文级失败的可展示原因（null = 没有未同步正文）。
 * 正文走独立通道，其失败不会让 outbox 推送失败——若不单独写入 syncIssue，
 * 界面会显示「同步成功」而某篇正文其实从未上云（换设备就是空白正文）。
 */
function describeNoteBodyFailures(failures: NoteBodyPushFailure[], notes: Note[]): string | null {
  if (!failures.length) return null
  const [first] = failures
  const title = notes.find((n) => n.id === first.noteId)?.title || '未命名'
  const rest = failures.length > 1 ? `等 ${failures.length} 篇笔记` : ''
  return `「${title}」${rest}${first.reason}`
}

/**
 * syncActions 的显式签名（不含 this 参数）。
 * 存在原因：AppStoreThis = ReturnType<typeof useAppStore>，而 useAppStore 的 actions 又组合 syncActions——
 * 若 syncActions 的声明类型由字面量推断（携带 this: AppStoreThis），三者构成类型推理循环（TS2456/TS7022）。
 * 显式声明不含 this 的签名后，useAppStore 推断只消费该声明类型；字面量的 this 注解在赋值检查时才解析，
 * 此时 useAppStore 类型已可计算，循环解除。
 */
type SyncActionsShape = {
  save(): void
  saveAsync(): Promise<boolean>
  flushOutbox(): Promise<{ ok: boolean; applied: number; rejected: number }>
  flushSave(): void
  applyPull(res: PullResponse, resetDomains: boolean): number
  hydrate(): Promise<void>
  syncNow(): Promise<{ ok: boolean; applied: number; rejected: number; changed: number }>
  resetState(): void
  storageUsageText(): Promise<string>
}

export const syncActions: SyncActionsShape = {
  /** 触发防抖推送（800ms 合并连续操作）。推送内容完全来自 outbox 的暂存变更（T6 起 mutation 直接 stage）。 */
  save(this: AppStoreThis) {
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
  async saveAsync(this: AppStoreThis): Promise<boolean> {
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
  async flushOutbox(this: AppStoreThis): Promise<{ ok: boolean; applied: number; rejected: number }> {
    if (!hasHydrated) return { ok: true, applied: 0, rejected: 0 }
    // flushPendingNoteBodies 逐行隔离失败、从不抛错：正文级失败经 bodyIssue 常驻可见，
    // 且不阻断 outbox 推送（毒正文不该连累其余数据域长期无法上云）
    const { revisions, failures } = await flushPendingNoteBodies()
    for (const [id, revision] of revisions) {
      const note = this.notes.find((item) => item.id === id)
      if (!note || note.bodyUpdatedAt !== revision.from) continue
      note.bodyUpdatedAt = revision.to
      if (note.updatedAt === revision.from) note.updatedAt = revision.to
      stageUpsert('notes', note.id, note, note.updatedAt)
    }
    // 正文级失败常驻可见：成功推送 outbox 也不能把它清掉（它不会随 outbox 一起被确认）
    syncIssue.value = describeNoteBodyFailures(failures, this.notes)

    const snapshot = takeForFlush()
    if (!snapshot) return { ok: true, applied: 0, rejected: 0 }

    const domains: PushDomains = {}
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
      // 4xx 是服务端明确拒绝（毒记录会让整批推送长期被拒），必须把原因暴露出去，不能只打日志
      const pushIssue = describePushFailure(e, domains)
      syncIssue.value = syncIssue.value ? `${syncIssue.value}；${pushIssue}` : pushIssue
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
  flushSave(this: AppStoreThis) {
    if (!hasHydrated) return
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    // 正文不能可靠地在 unload keepalive 中上传；有**可推送**的待同步正文时保留两类 outbox 到下次启动。
    // 服务端永远不接受的正文（超过上限）不计入，否则它会永久短路这里的兜底推送。
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

  /**
   * 把 pull 结果合并进本地 state，并按设计 §4.2 的游标契约推进游标；返回本次合入条数。
   * `resetDomains = true`（老用户全量拉取）时先清空服务端权威域再重建——本地全量数据只存在于内存，
   * 冷启动的默认数据（内置科目/习惯）必须先让位给服务端数据（被删的科目由墓碑负责移除）。
   * settings 不被清空：服务端快照缺 quotes 等字段时由本地默认值兜底。
   */
  applyPull(this: AppStoreThis, res: PullResponse, resetDomains: boolean): number {
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
  async hydrate(this: AppStoreThis) {
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
  async syncNow(this: AppStoreThis): Promise<{ ok: boolean; applied: number; rejected: number; changed: number }> {
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

  /** 退出登录/切换账号时清空本地同步状态并重置为空白数据，避免串号 */
  resetState(this: AppStoreThis) {
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
    // 同步失败提示与账号绑定：换账号后不得把上一个账号的失败原因留给下一个账号
    syncIssue.value = null
    // 清空错题图片 blob 缓存：防止下一账号经 SPA 内切换复用上一账号已授权的图片
    clearErrorImageCache()
    void setNoteBodyUser(null)
    this.$patch(createDefaultState())
  },

  /** 计算当前账号数据大小（按当前状态 JSON 序列化估算）。 */
  async storageUsageText(this: AppStoreThis): Promise<string> {
    const bytes = new Blob([JSON.stringify(this.$state)]).size
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    return (bytes / 1024 / 1024).toFixed(2) + ' MB'
  }
}
