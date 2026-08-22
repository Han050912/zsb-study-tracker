/**
 * 待办「开始时间 / 最晚截止时间」提醒调度器：浏览器与桌面端共用。
 *
 * 以固定间隔轮询待办列表，到点弹系统通知（复用 services/notify.ts 的两端统一通知）：
 * - 到达开始时间 → 提醒任务已开始；
 * - 到达最晚截止时间且仍未完成 → 提醒未完成，并在正文中列出具体待办名称；
 *   已被用户标记完成的待办不触发任何截止提醒。
 *
 * 去重标记写在待办自身（startNotifiedAt / dueNotifiedAt）并随云端同步持久化，
 * 因此每条提醒最多只弹一次；应用未运行期间错过的提醒会在下次启动或回到前台时补发。
 */
import { sendNotification } from './notify'
import type { Todo } from '../types'

/** 轮询间隔 30s。后台标签页的定时器会被浏览器节流，回到前台时由 visibilitychange 立即补检查 */
const TICK_MS = 30_000

export interface TodoReminderHooks {
  /** 读取待检查的待办列表 */
  getTodos: () => Todo[]
  /** 提醒已发出：持久化去重标记 */
  onNotified: (ids: string[], kind: 'start' | 'due') => void
  /** 系统通知未弹出时的兜底提示（如浏览器未授权通知权限） */
  onFallback?: (message: string) => void
}

let timer: ReturnType<typeof setInterval> | null = null
let hooks: TodoReminderHooks | null = null

/** 待办名称拼接，用于在通知正文中明确列出是哪些待办 */
function joinNames(list: Todo[]): string {
  return list.map(t => `「${t.text}」`).join('、')
}

function deliver(title: string, body: string) {
  if (!sendNotification(title, body)) hooks?.onFallback?.(`${title}：${body}`)
}

function onVisibilityChange() {
  if (document.visibilityState === 'visible') checkTodoReminders()
}

/** 立即执行一次检查（启动、回到前台、待办时间变更后调用） */
export function checkTodoReminders() {
  if (!hooks) return
  const now = Date.now()
  const todos = hooks.getTodos()

  const started = todos.filter(t => t.startAt && t.startAt <= now && !t.done && !t.startNotifiedAt)
  if (started.length) {
    deliver(
      '待办已到开始时间',
      started.length === 1
        ? `${joinNames(started)}该开始啦，现在就动手 💪`
        : `${started.length} 个待办已到开始时间：${joinNames(started)}`
    )
    hooks.onNotified(started.map(t => t.id), 'start')
  }

  const overdue = todos.filter(t => t.dueAt && t.dueAt <= now && !t.done && !t.dueNotifiedAt)
  if (overdue.length) {
    deliver('待办未完成提醒', `已到最晚截止时间仍未完成：${joinNames(overdue)}`)
    hooks.onNotified(overdue.map(t => t.id), 'due')
  }
}

/** 启动（或重启）调度：立即检查一次以补发错过的提醒，随后按固定间隔轮询 */
export function startTodoReminder(h: TodoReminderHooks) {
  stopTodoReminder()
  hooks = h
  checkTodoReminders()
  timer = setInterval(checkTodoReminders, TICK_MS)
  document.addEventListener('visibilitychange', onVisibilityChange)
}

/** 停止调度（退出登录 / 页面卸载时调用） */
export function stopTodoReminder() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  document.removeEventListener('visibilitychange', onVisibilityChange)
  hooks = null
}
