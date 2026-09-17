import { pollingDelay, type ConnectionState } from '../features/collaboration/connection'
/**
 * 双人番茄钟计时核心 store（跨路由存活）：
 * - 计时状态与 tick/poll 定时器在此管理，组件卸载不清理（仅 finishSession 清理）
 * - 后台继续 = 本 store 计时器在 SPA 内持续跑；刷新/关页 = pagehide 冻结持久化
 * - 番茄统计由前端权威，completePhase 里即时 recordPomodoro
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { partnersApi } from '../api/community/partners'
import { requestKeepalive } from '../api/client'
import { useAppStore } from './app'
import type { PartnerStudySession } from '../types'

type Phase = 'idle' | 'focus' | 'done'

type PendingChoice = 'partner_idle' | 'partner_focus' | null

/** 恢复分钟数：忠实数值（含 0 与小数），仅对非有限值兜底默认值 */
function finiteOr(v: unknown, dflt: number): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : dflt
}

export const useStudyTimerStore = defineStore('studyTimer', () => {
  const appStore = useAppStore()

  const session = ref<PartnerStudySession | null>(null)
  const phase = ref<Phase>('idle')
  const connection = ref<ConnectionState>('connecting')
  const lastSyncedAt = ref(0)
  let failures = 0,
    sessionGeneration = 0
  let syncQueue: Promise<void> = Promise.resolve()
  let pollInFlight = false
  const seconds = ref(0)
  const running = ref(false)
  const myMinutes = ref(0)
  const onlineSeconds = ref(0)
  /** 番茄完成计数（递增事件，供组件 toast，避免监听 myMinutes 时恢复会话误触发） */
  const pomodoroCompleted = ref(0)
  /** 双方均完成的开黑结束计数（递增事件，供组件 toast 庆祝） */
  const sessionCompleted = ref(0)
  /** 我方专注完成时按对方状态弹出的选择项 */
  const pendingChoice = ref<PendingChoice>(null)
  /** 开黑番茄任务描述（选填）；会话进入即自动开始计时、无开始前填写窗口，
   *  故结算时读取当前输入框内容（单人模式才是开始时锁定） */
  const taskDescription = ref('')

  /** 结算时从输入框取当前描述（trim + 50 字截断，与 maxlength 一致） */
  function currentDescription(): string {
    return taskDescription.value.trim().slice(0, 50)
  }

  let handle: ReturnType<typeof setInterval> | null = null
  let pollTimer: ReturnType<typeof setTimeout> | null = null
  let startTimestamp = 0
  let pausedElapsed = 0
  let onlineBase = 0

  const phaseSeconds = computed(() => (session.value?.focusMinutes ?? 25) * 60)

  const display = computed(() => {
    if (session.value?.mode === 'countup') {
      if (phase.value === 'idle' || phase.value === 'done') return '00:00'
      const s = seconds.value
      return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
    }
    if (phase.value === 'idle') return `${String(session.value?.focusMinutes ?? 25).padStart(2, '0')}:00`
    if (phase.value === 'done') return '00:00'
    const remain = Math.max(0, phaseSeconds.value - seconds.value)
    return `${String(Math.floor(remain / 60)).padStart(2, '0')}:${String(remain % 60).padStart(2, '0')}`
  })

  function beginTimer() {
    startTimestamp = Date.now()
    running.value = true
    handle = setInterval(tick, 1000)
  }

  function stopTimer() {
    running.value = false
    if (handle) {
      clearInterval(handle)
      handle = null
    }
    const elapsed = Math.floor((Date.now() - startTimestamp) / 1000)
    pausedElapsed += elapsed
    onlineBase += elapsed
    seconds.value = pausedElapsed
    onlineSeconds.value = onlineBase
  }

  function tick() {
    const elapsed = Math.floor((Date.now() - startTimestamp) / 1000)
    seconds.value = pausedElapsed + elapsed
    onlineSeconds.value = onlineBase + elapsed
    // 本地兜底：队友专注且正在计时时每秒推进其累计时长；暂停（partnerRunning=false）立即停止，避免虚增
    if (session.value?.partnerState === 'focus' && session.value.partnerRunning) {
      session.value.partnerOnlineSeconds++
    }
    if (session.value?.mode !== 'countup' && seconds.value >= phaseSeconds.value) completePhase()
  }

  async function start() {
    if (!session.value) return
    if (phase.value === 'idle') {
      phase.value = 'focus'
      seconds.value = 0
      pausedElapsed = 0
      beginTimer()
      await syncState('focus')
    } else {
      beginTimer()
      await syncState(phase.value)
    }
  }

  async function pause() {
    stopTimer()
    await syncState(phase.value)
  }

  async function completePhase() {
    stopTimer()
    if (!session.value) return
    if (phase.value === 'focus') {
      const minutes = session.value.mode === 'countup' ? Math.round(seconds.value / 60) : session.value.focusMinutes
      myMinutes.value += minutes
      if (minutes >= 1) {
        appStore.recordPomodoro(minutes, currentDescription(), 'party', session.value.partnerName)
        pomodoroCompleted.value++
      }
      phase.value = 'done'
      seconds.value = 0
      pausedElapsed = 0
      await syncState('done')
      if (session.value) {
        if (session.value.partnerState === 'idle') pendingChoice.value = 'partner_idle'
        else if (session.value.partnerState === 'focus') pendingChoice.value = 'partner_focus'
      }
    }
  }

  /** 正计时「完成专注」：主动结算当前已进行时长 */
  async function finishFocus() {
    if (phase.value !== 'focus') return
    await completePhase()
  }

  function syncState(_state: Phase): Promise<void> {
    const id = session.value?.id,
      generation = sessionGeneration
    if (!id) return Promise.resolve()
    const request = syncQueue
      .catch(() => {})
      .then(async () => {
        if (sessionGeneration !== generation || session.value?.id !== id) return
        const res = await partnersApi.updateStudySession(
          id,
          phase.value,
          myMinutes.value,
          onlineSeconds.value,
          seconds.value,
          running.value
        )
        if (sessionGeneration !== generation || session.value?.id !== id) return
        connection.value = 'connected'
        failures = 0
        lastSyncedAt.value = Date.now()
        Object.assign(session.value, {
          partnerState: res.session.partnerState,
          partnerMinutes: res.session.partnerMinutes,
          partnerOnlineSeconds: res.session.partnerOnlineSeconds,
          partnerElapsedSeconds: res.session.partnerElapsedSeconds,
          partnerRunning: res.session.partnerRunning
        })
        if (res.session.status === 'done') {
          if (phase.value === 'focus')
            appStore.recordPomodoro(
              Math.round(seconds.value / 60),
              currentDescription(),
              'party',
              session.value.partnerName
            )
          sessionCompleted.value++
          finishSession()
        }
      })
      .catch(() => {
        if (sessionGeneration !== generation || session.value?.id !== id) return
        failures++
        connection.value = navigator.onLine && failures < 3 ? 'reconnecting' : 'offline'
      })
    syncQueue = request
    return request
  }

  function enterSession(s: PartnerStudySession | null | undefined) {
    if (!s) return
    if (session.value && session.value.id === s.id) return
    if (session.value) finishSession()
    sessionGeneration++
    failures = 0
    connection.value = 'connecting'

    const normalized: PartnerStudySession = {
      id: s.id,
      status: s.status ?? 'active',
      partnerId: s.partnerId ?? '',
      partnerName: s.partnerName ?? '搭子',
      partnerAvatar: s.partnerAvatar,
      focusMinutes: finiteOr(s.focusMinutes, 25),
      mode: s.mode ?? 'countdown',
      myState: (s.myState as string) === 'break' ? 'done' : (s.myState ?? 'idle'),
      myMinutes: Number(s.myMinutes) || 0,
      partnerState: s.partnerState ?? 'idle',
      partnerMinutes: Number(s.partnerMinutes) || 0,
      myOnlineSeconds: Number(s.myOnlineSeconds) || 0,
      partnerOnlineSeconds: Number(s.partnerOnlineSeconds) || 0,
      myElapsedSeconds: Number(s.myElapsedSeconds) || 0,
      partnerElapsedSeconds: Number(s.partnerElapsedSeconds) || 0,
      partnerRunning: !!s.partnerRunning
    }
    session.value = normalized
    myMinutes.value = normalized.myMinutes
    onlineBase = normalized.myOnlineSeconds
    onlineSeconds.value = normalized.myOnlineSeconds
    phase.value = normalized.myState
    // 恢复会话时按已消耗秒数初始化倒计时，避免暂停态误显示完整时长（idle/done 由 display 分支兜底，不受影响）
    seconds.value = normalized.myElapsedSeconds
    pausedElapsed = normalized.myElapsedSeconds
    running.value = false

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('pagehide', onPageHide)
    window.addEventListener('online', reconnect)
    window.addEventListener('offline', markOffline)
    schedulePoll(0)

    if (phase.value === 'idle') start()
  }

  async function endSession() {
    const s = session.value
    if (!s) return
    stopTimer()
    if (phase.value === 'focus') {
      appStore.recordPomodoro(Math.round(seconds.value / 60), currentDescription(), 'party', s.partnerName)
      phase.value = 'done' // 结算后置结束态，阻断 await 间隙内 poll 对 focus 的重复结算
    }
    try {
      await partnersApi.endStudySession(s.id)
      finishSession()
    } catch {
      /* 结束失败静默 */
    }
  }

  function waitForPartner() {
    pendingChoice.value = null
  }

  async function leaveSession() {
    pendingChoice.value = null
    if (session.value) {
      try {
        await syncState('done')
      } catch {
        /* 忽略 */
      }
    }
    finishSession()
  }

  function finishSession() {
    sessionGeneration++
    pollInFlight = false
    window.removeEventListener('online', reconnect)
    window.removeEventListener('offline', markOffline)
    stopTimer()
    // 开黑输入框在鼠标移开底部后隐藏，用户可能全程未看到：会话结束必须清空，避免残留描述写入下次开黑记录
    taskDescription.value = ''
    if (pollTimer) {
      clearTimeout(pollTimer)
      pollTimer = null
    }
    document.removeEventListener('visibilitychange', handleVisibilityChange)
    window.removeEventListener('pagehide', onPageHide)
    session.value = null
    phase.value = 'idle'
    seconds.value = 0
    pausedElapsed = 0
    myMinutes.value = 0
    onlineSeconds.value = 0
    onlineBase = 0
  }

  function schedulePoll(delay = pollingDelay(failures, document.hidden)) {
    if (pollTimer) clearTimeout(pollTimer)
    if (session.value) pollTimer = setTimeout(poll, delay)
  }
  async function poll() {
    if (!session.value || pollInFlight) return
    const generation = sessionGeneration
    pollInFlight = true
    await syncState(phase.value)
    if (generation !== sessionGeneration) return
    pollInFlight = false
    schedulePoll()
  }
  function markOffline() {
    connection.value = 'offline'
    schedulePoll()
  }
  function reconnect() {
    if (!session.value) return
    failures = 0
    connection.value = 'reconnecting'
    schedulePoll(0)
  }
  function handleVisibilityChange() {
    if (!document.hidden) {
      if (running.value) tick()
      reconnect()
    } else schedulePoll()
  }

  function onPageHide() {
    if (!session.value || !running.value) return
    const runningElapsed = Math.floor((Date.now() - startTimestamp) / 1000)
    const elapsed = pausedElapsed + runningElapsed
    requestKeepalive(
      `/api/partner-study/sessions/${session.value.id}`,
      {
        state: phase.value,
        minutes: myMinutes.value,
        onlineSeconds: onlineBase + runningElapsed,
        elapsedSeconds: elapsed
      },
      'PUT'
    )
  }

  return {
    session,
    connection,
    lastSyncedAt,
    reconnect,
    phase,
    seconds,
    running,
    myMinutes,
    onlineSeconds,
    display,
    pomodoroCompleted,
    sessionCompleted,
    pendingChoice,
    taskDescription,
    start,
    pause,
    endSession,
    enterSession,
    finishSession,
    waitForPartner,
    leaveSession,
    finishFocus
  }
})
