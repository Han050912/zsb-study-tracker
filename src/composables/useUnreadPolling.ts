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
        messageUnread.value = r.count
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
      else stopUnreadPolling()
    },
    { immediate: true }
  )
  onBeforeUnmount(() => {
    stopUnreadPolling()
  })

  return { messageUnread }
}
