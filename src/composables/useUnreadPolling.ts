import { onBeforeUnmount, ref, watch } from 'vue'
import { useCommunityStore } from '../stores/community'
import { isLoggedIn } from '../services/auth'
import { communityApi } from '../api/community'

/** 未读轮询：登录后定时拉取社区未读通知数 + 消息未读数（实时红点）；切后台暂停、回前台立即补拉；退出/过期时停止轮询 */
export function useUnreadPolling() {
  const community = useCommunityStore()

  let unreadTimer: ReturnType<typeof setInterval> | null = null
  /** 本轮未读拉取是否仍在飞：弱网下 30s 定时器与 visibilitychange 补拉会叠加，已有在飞请求时直接跳过 */
  let unreadInFlight = false
  /** 消息未读数（私信模块独立，不与通知未读混算） */
  const messageUnread = ref(0)
  function fetchUnread() {
    if (unreadInFlight) return
    unreadInFlight = true
    void Promise.allSettled([
      community.fetchUnreadCount(),
      communityApi.messageUnreadCount().then((r) => {
        // 慢网下响应可能晚于登出到达，回写前校验登录态，避免显示上一账号的未读数
        if (isLoggedIn.value) messageUnread.value = r.count
      })
    ]).finally(() => {
      unreadInFlight = false
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
