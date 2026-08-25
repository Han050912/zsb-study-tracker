/**
 * 学习搭子提醒推送调度器：浏览器与桌面端共用。
 *
 * 搭子学习提醒由后端异步写入社区通知（type='partner'），本服务以固定间隔轮询
 * 未读的搭子通知，到点弹系统通知（复用 services/notify.ts 的两端统一通知），
 * 与「每日学习提醒」一样推送到系统，而非仅停留在通知中心。
 *
 * 去重标记持久化在 localStorage（最近 N 条已推送通知 id），因此每条提醒最多弹一次；
 * 应用未运行期间错过的提醒会在下次启动或回到前台时补发。
 */
import { sendNotification, buildAvatarIcon } from './notify'
import { communityApi, imageUrl } from '../api/community'

/** 轮询间隔 30s。后台标签页定时器会被浏览器节流，回到前台由 visibilitychange 立即补检查 */
const TICK_MS = 30_000
const STORAGE_KEY = 'partner_reminded_ids'
/** 已推送通知 id 集合上限，防止 localStorage 无限膨胀 */
const MAX_STORED = 200

export interface PartnerReminderHooks {
  /** 勿扰期间是否抑制推送（返回 true 时不弹系统通知；去重标记仍照常写入） */
  isSuppressed?: () => boolean
  /** 系统通知未弹出时的兜底提示（如浏览器未授权通知权限） */
  onFallback?: (message: string) => void
}

let timer: ReturnType<typeof setInterval> | null = null
let hooks: PartnerReminderHooks | null = null

function loadNotifiedIds(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return new Set(raw ? JSON.parse(raw) : [])
  } catch {
    return new Set()
  }
}

function saveNotifiedIds(ids: Set<string>) {
  try {
    const arr = [...ids].slice(-MAX_STORED)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(arr))
  } catch {
    /* localStorage 不可用时静默降级为仅内存去重 */
  }
}

/** 立即执行一次检查（启动、回到前台时调用） */
async function checkPartnerReminders() {
  if (!hooks) return
  try {
    // 拉取最新未读的搭子通知（含 type='partner' 过滤）
    const res = await communityApi.notifications(null, 20, 'partner')
    const notified = loadNotifiedIds()
    let changed = false
    for (const n of res.items) {
      if (n.isRead || notified.has(n.id)) continue
      notified.add(n.id)
      changed = true
      if (hooks.isSuppressed?.()) continue
      // 提醒人头像作为通知图标（未设置头像时生成首字母头像兜底）
      const icon = buildAvatarIcon(
        n.actorName || '搭',
        n.actorAvatar ? imageUrl(n.actorAvatar) : undefined
      )
      if (!sendNotification('学习搭子提醒', n.content, icon)) {
        hooks.onFallback?.(`学习搭子提醒：${n.content}`)
      }
    }
    if (changed) saveNotifiedIds(notified)
  } catch {
    /* 轮询失败静默，下个周期重试 */
  }
}

function onVisibilityChange() {
  if (document.visibilityState === 'visible') checkPartnerReminders()
}

/** 启动（或重启）调度：立即检查一次以补发错过的提醒，随后按固定间隔轮询 */
export function startPartnerReminder(h: PartnerReminderHooks) {
  stopPartnerReminder()
  hooks = h
  checkPartnerReminders()
  timer = setInterval(checkPartnerReminders, TICK_MS)
  document.addEventListener('visibilitychange', onVisibilityChange)
}

/** 停止调度（退出登录 / 页面卸载时调用） */
export function stopPartnerReminder() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  document.removeEventListener('visibilitychange', onVisibilityChange)
  hooks = null
}
