import { onBeforeUnmount, onMounted, watch } from 'vue'
import { useAppStore } from '../stores/app'
import { isLoggedIn } from '../services/auth'
import { restartReminder } from '../services/reminder'
import { startTodoReminder, checkTodoReminders } from '../services/todoReminder'
import { startPartnerReminder, stopPartnerReminder } from '../services/partnerReminder'
import { isDndActive } from '../utils/dnd'
import { useToast } from './useToast'

/** 提醒调度：每日学习提醒 + 待办开始/截止提醒 + 学习搭子提醒（详见各 src/services/*Reminder.ts） */
export function useReminders() {
  const store = useAppStore()
  const toast = useToast()

  // ---- 每日学习提醒（浏览器 + 桌面端共用 src/services/reminder.ts 一套逻辑） ----
  // 监听设置变更即时重调度：开关切换、时间修改均无需重启应用即可生效
  watch(
    () => [store.settings.reminderEnabled, store.settings.reminderTime] as const,
    () => {
      restartReminder(
        () => ({
          enabled: store.settings.reminderEnabled,
          time: store.settings.reminderTime,
          suppressed: isDndActive(store.settings)
        }),
        (shown) => {
          if (!shown) toast('提醒时间到！该开始学习啦')
        }
      )
    },
    { immediate: true }
  )

  // ---- 待办开始 / 最晚截止提醒（见 src/services/todoReminder.ts）----
  // 应用运行期间后台轮询，到点弹系统通知；桌面端最小化到托盘后仍可收到
  onMounted(() => {
    startTodoReminder({
      getTodos: () => store.todos,
      onNotified: (ids, kind) => store.markTodosNotified(ids, kind),
      onFallback: (msg) => toast(msg),
      isSuppressed: () => isDndActive(store.settings)
    })
  })
  // 云端数据到位、新增待办或改动时间后立即检查一次，无需等下一轮轮询
  watch(
    () => store.todos.map((t) => `${t.id}:${t.startAt ?? ''}:${t.dueAt ?? ''}:${t.done ? 1 : 0}`).join('|'),
    () => checkTodoReminders()
  )

  // ---- 学习搭子提醒推送（见 src/services/partnerReminder.ts）----
  // 登录后轮询未读的搭子通知并推系统通知（与每日学习提醒同机制），退出/过期时停止
  watch(
    isLoggedIn,
    (v) => {
      if (v) {
        startPartnerReminder({
          onFallback: (msg) => toast(msg),
          isSuppressed: () => isDndActive(store.settings)
        })
      } else {
        stopPartnerReminder()
      }
    },
    { immediate: true }
  )
  onBeforeUnmount(() => {
    stopPartnerReminder()
  })
}
