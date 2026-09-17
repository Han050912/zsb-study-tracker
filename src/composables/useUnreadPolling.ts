import { onBeforeUnmount, ref, watch } from 'vue'
import { useNotificationStore } from '../stores/community'
import { isLoggedIn } from '../services/auth'
import { messagesApi } from '../api/community/messages'

/** 未读轮询：登录后定时拉取社区未读通知数 + 消息未读数（实时红点）；切后台暂停、回前台立即补拉；退出/过期时停止轮询 */
export function useUnreadPolling() {
  const community = useNotificationStore()

  let unreadTimer: ReturnType<typeof setInterval> | null = null
  /** 本轮未读拉取的中止令牌（单飞）：新一轮发起前 abort 上一轮，旧轮结果作废不回写，
   *  保证任意时刻仅最新一轮生效且数据最新（弱网下 30s 定时器与 visibilitychange 补拉不再叠加） */
  let unreadController: AbortController | null = null
  /** 消息未读数（私信模块独立，不与通知未读混算） */
  const messageUnread = ref(0)
  function fetchUnread() {
    unreadController?.abort()
    const controller = new AbortController()
    unreadController = controller
    void Promise.allSettled([
      community.fetchUnreadCount(),
      messagesApi.messageUnreadCount().then((r) => {
        // 旧轮已被新一轮 abort：响应晚到也作废，不覆盖最新一轮的数据
        if (controller.signal.aborted) return
        // 慢网下响应可能晚于登出到达，回写前校验登录态，避免显示上一账号的未读数
        if (isLoggedIn.value) messageUnread.value = r.count
      })
    ]).finally(() => {
      // 仅当仍是本轮的令牌时才清空（新一轮可能已接管），避免误清最新一轮
      if (unreadController === controller) unreadController = null
    })
  }
  function startUnreadTimer() {
    if (unreadTimer) clearInterval(unreadTimer)
    unreadTimer = setInterval(fetchUnread, 30000)
  }
  function stopUnreadTimer() {
    if (unreadTimer) {
      clearInterval(unreadTimer)
      unreadTimer = null
    }
  }
  function onUnreadVisibilityChange() {
    if (document.visibilityState === 'visible') {
      fetchUnread()
      if (isLoggedIn.value) startUnreadTimer()
    } else {
      stopUnreadTimer()
    }
  }
  function startUnreadPolling() {
    stopUnreadPolling()
    fetchUnread()
    startUnreadTimer()
    document.addEventListener('visibilitychange', onUnreadVisibilityChange)
    window.addEventListener('message:read', onMessageRead)
  }
  function stopUnreadPolling() {
    stopUnreadTimer()
    // 登出/卸载时中止在飞轮次：旧响应即使晚到也作废
    unreadController?.abort()
    unreadController = null
    document.removeEventListener('visibilitychange', onUnreadVisibilityChange)
    window.removeEventListener('message:read', onMessageRead)
  }
  /** 打开聊天页标记已读后即时扣减消息未读数，无需等下一轮轮询 */
  function onMessageRead(e: Event) {
    const n = (e as CustomEvent<number>).detail || 0
    if (n > 0) messageUnread.value = Math.max(0, messageUnread.value - n)
  }
  watch(
    isLoggedIn,
    (v) => {
      if (v) startUnreadPolling()
      else {
        stopUnreadPolling()
        // 登出 / 会话过期（auth:expired 亦经 logout 置 isLoggedIn=false）：归零消息未读数，
        // 避免切号瞬间顶栏与下拉菜单仍显示上一账号的角标（通知未读由 community.resetState 清零）
        messageUnread.value = 0
      }
    },
    { immediate: true }
  )
  onBeforeUnmount(() => {
    stopUnreadPolling()
  })

  return { messageUnread }
}
